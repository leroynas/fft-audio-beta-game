/**
 * AdaptiveMixer.ts — Phase 4: The "live FOH engineer" brain.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  THESIS: Proactive, Context-Sensitive Mixing                        │
 * │                                                                     │
 * │  Traditional game audio fires sounds and forgets. A live FOH        │
 * │  engineer does the opposite: they CONTINUOUSLY monitor the          │
 * │  frequency spectrum (via a spectrum analyser on their desk),        │
 * │  detect masking, and make real-time EQ/compression decisions.       │
 * │                                                                     │
 * │  AdaptiveMixer replicates this workflow in code:                    │
 * │    1. FFT captures the current spectral energy every few frames.   │
 * │    2. The spectrum is divided into Low / Mid / High bands.         │
 * │    3. Context flags (footsteps active, prop active) inform         │
 * │       ducking and dynamic EQ rules — the same decisions a human    │
 * │       FOH engineer would make proactively.                         │
 * │    4. Three parametric EQ nodes (LowShelf, Peaking, HighShelf)    │
 * │       and an adaptive compressor shape the output in real time.    │
 * │    5. A debug ring buffer smooths FFT data to prevent visual       │
 * │       and sonic jumping — just as a real desk VU meter has         │
 * │       ballistics.                                                  │
 * │                                                                     │
 * │  This is the proactive, context-sensitive adjustment that was       │
 * │  missing in traditional game audio.                                 │
 * └─────────────────────────────────────────────────────────────────────┘
 */
import * as Tone from 'tone';

// ── Band boundary frequencies ────────────────────────────────
const LOW_UPPER  = 300;   // Hz — everything below this is "Low"
const MID_UPPER  = 4000;  // Hz — 300–4k is "Mid"
                           // Above 4k is "High"

// ── FFT / analysis config ────────────────────────────────────
const FFT_SIZE   = 64;    // Good balance: 64 bins, ~344 Hz/bin at 44.1k
const RING_SIZE  = 10;    // Smooth over the last 10 readings
const UPDATE_INTERVAL_FRAMES = 2; // Only analyse every N frames for perf

// ── Threshold constants (dB) ─────────────────────────────────
// Mirrors an FOH engineer's mental rules:
//   "If the lows are above -20 dB and a prop just fired, duck the lows."
//   "If mids dominate by >8 dB over highs during footsteps, cut a mid notch."
const LOW_LOUD_THRESHOLD   = -20;  // dB — "lows are too present"
const MID_DOMINANCE_DB     = 8;    // dB above high band to count as "dominating"

// ── EQ adjustment ranges ─────────────────────────────────────
const LOW_DUCK_DB    = -6;   // How much to shelf-cut lows when ducking
const MID_CUT_DB     = -5;   // Mid peaking cut when mid dominates
const MID_CUT_FREQ   = 1500; // Center frequency for mid scoop (Hz)
const MID_CUT_Q      = 1.5;  // Q width of the mid scoop
const HIGH_LIFT_DB   = 3;    // Subtle high-shelf lift to preserve clarity

// ── Compressor adaptive ranges ───────────────────────────────
const COMP_THRESHOLD_QUIET = -18; // Threshold when mix is quiet
const COMP_THRESHOLD_LOUD  = -8;  // Threshold when mix is loud
const COMP_RATIO_MIN       = 1.5;
const COMP_RATIO_MAX       = 6;
const LOUD_METER_DB        = -10;  // Meter level above which mix counts as "loud"
const QUIET_METER_DB       = -30;  // Below this the mix is "quiet"

// ── Smoothing factor for EQ gain changes (prevents clicks) ──
const EQ_LERP = 0.12;

// ── Helper ───────────────────────────────────────────────────
function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

// ── Public snapshot for the UI to display ────────────────────
export interface MixerSnapshot {
    /** Smoothed band levels in dB */
    lowDb:  number;
    midDb:  number;
    highDb: number;
    /** Current actions the mixer is taking */
    lowDucking: boolean;
    midCutting: boolean;
    compressorEngaged: boolean;
    /** Current EQ gain values (for display) */
    lowGainDb:  number;
    midGainDb:  number;
    highGainDb: number;
    /** Compressor gain reduction (dB) */
    compReduction: number;
    /** Descriptive status string for the HUD */
    statusText: string;
    /** Raw FFT bin values (dB) for spectrogram display — length = FFT_SIZE */
    fftBins: Float32Array;
}

// ──────────────────────────────────────────────────────────────
export class AdaptiveMixer {
    // ── Analysis nodes ────────────────────────────────────────
    private fft: Tone.FFT;
    private meter: Tone.Meter;

    // ── EQ nodes (3-band parametric, mirrors a desk channel strip) ─
    private lowShelf:  Tone.Filter;
    private midPeak:   Tone.Filter;
    private highShelf: Tone.Filter;

    // ── Dynamics ──────────────────────────────────────────────
    private compressor: Tone.Compressor;

    // ── Routing ───────────────────────────────────────────────
    /** The node that mode outputs should connect INTO */
    public readonly input: Tone.Gain;
    /** Final output (connects to Tone.getDestination() or external chain) */
    public readonly output: Tone.Gain;

    // ── State ─────────────────────────────────────────────────
    /** Ring buffer of recent FFT snapshots for smoothing */
    private fftRing: Float32Array[] = [];
    /** Smoothed band energies (dB) */
    private smoothLow  = -60;
    private smoothMid  = -60;
    private smoothHigh = -60;

    /** Current EQ gain values (smoothed via lerp to prevent clicks) */
    private currentLowGain  = 0;
    private currentMidGain  = 0;
    private currentHighGain = 0;

    /** Context flags — set by AudioManager before each update */
    public footstepsActive = false;
    public propActive      = false;

    /** Frame counter for throttled updates */
    private frameCount = 0;

    /** The sample rate we're running at (cached once) */
    private sampleRate = 44100;

    constructor() {
        // ── Build the signal chain ───────────────────────────
        //   [mode output] → input → lowShelf → midPeak → highShelf
        //                         → compressor → output → destination
        //
        //   FFT + Meter tap off input for analysis (read-only).

        this.input  = new Tone.Gain(1);
        this.output = new Tone.Gain(1);

        // Analysis (connected in parallel — does not alter the signal)
        this.fft   = new Tone.FFT(FFT_SIZE);
        this.meter = new Tone.Meter({ smoothing: 0.8 });

        // 3-band parametric EQ
        this.lowShelf = new Tone.Filter({
            type: 'lowshelf',
            frequency: LOW_UPPER,
            gain: 0,
            rolloff: -12,
        });
        this.midPeak = new Tone.Filter({
            type: 'peaking',
            frequency: MID_CUT_FREQ,
            gain: 0,
            Q: MID_CUT_Q,
            rolloff: -12,
        });
        this.highShelf = new Tone.Filter({
            type: 'highshelf',
            frequency: MID_UPPER,
            gain: 0,
            rolloff: -12,
        });

        // Adaptive compressor
        this.compressor = new Tone.Compressor({
            threshold: -12,
            ratio: 3,
            attack: 0.01,
            release: 0.15,
            knee: 6,
        });

        // ── Wiring ──────────────────────────────────────────
        // Analysis taps (parallel, non-destructive)
        this.input.connect(this.fft);
        this.input.connect(this.meter);

        // Main signal path
        this.input.connect(this.lowShelf);
        this.lowShelf.connect(this.midPeak);
        this.midPeak.connect(this.highShelf);
        this.highShelf.connect(this.compressor);
        this.compressor.connect(this.output);
        this.output.toDestination();
    }

    // ── Frame update (called from AudioManager) ──────────────

    /**
     * Analyse the current spectrum and adjust EQ + compression.
     * Throttled to every UPDATE_INTERVAL_FRAMES frames for performance.
     *
     * This is the core loop that mirrors a human FOH engineer's workflow:
     *   1. Look at the spectrum analyser
     *   2. Identify problems (masking, imbalance, excessive dynamics)
     *   3. Make a small, smooth correction
     *   4. Repeat
     */
    update(): void {
        this.frameCount++;
        if (this.frameCount % UPDATE_INTERVAL_FRAMES !== 0) return;

        // Cache sample rate on first call
        if (this.sampleRate === 44100 && Tone.getContext().sampleRate) {
            this.sampleRate = Tone.getContext().sampleRate;
        }

        // ── 1. Capture FFT data ─────────────────────────────
        const fftValues = this.fft.getValue(); // Float32Array of dB values
        this.pushRing(fftValues as Float32Array);

        // ── 2. Compute smoothed band energies ───────────────
        const smoothed = this.getSmoothedFFT();
        const { low, mid, high } = this.bandEnergies(smoothed);
        this.smoothLow  = lerp(this.smoothLow,  low,  0.15);
        this.smoothMid  = lerp(this.smoothMid,  mid,  0.15);
        this.smoothHigh = lerp(this.smoothHigh, high, 0.15);

        // ── 3. FOH decisions ────────────────────────────────

        // Decision A: Low ducking during prop interactions
        // "If the subs are booming AND a prop sound just fired,
        //  pull down the low shelf to make room — exactly what a
        //  FOH engineer does when a bass-heavy SFX hits."
        let targetLowGain = 0;
        if (this.smoothLow > LOW_LOUD_THRESHOLD && this.propActive) {
            targetLowGain = LOW_DUCK_DB;
        }

        // Decision B: Mid scoop when footsteps are masking
        // "If the mids dominate by >8 dB over the highs while the
        //  player is walking, carve a notch so the footstep detail
        //  (transient, high-freq content) isn't buried by mud."
        let targetMidGain = 0;
        if (this.footstepsActive && (this.smoothMid - this.smoothHigh) > MID_DOMINANCE_DB) {
            targetMidGain = MID_CUT_DB;
        }

        // Decision C: High-shelf lift when highs are weak
        // "Keep the 'air' in the mix — a live engineer often
        //  adds a gentle high-shelf to maintain clarity."
        let targetHighGain = 0;
        if (this.smoothHigh < this.smoothMid - 6) {
            targetHighGain = HIGH_LIFT_DB;
        }

        // ── 4. Apply EQ smoothly (lerp to prevent clicks) ──
        this.currentLowGain  = lerp(this.currentLowGain,  targetLowGain,  EQ_LERP);
        this.currentMidGain  = lerp(this.currentMidGain,  targetMidGain,  EQ_LERP);
        this.currentHighGain = lerp(this.currentHighGain, targetHighGain, EQ_LERP);

        this.lowShelf.gain.value  = this.currentLowGain;
        this.midPeak.gain.value   = this.currentMidGain;
        this.highShelf.gain.value = this.currentHighGain;

        // ── 5. Adaptive compressor ──────────────────────────
        // A human FOH engineer rides the compressor threshold depending
        // on how loud the overall mix gets.  Quiet passage? Lower the
        // threshold to keep things present.  Loud passage? Back off so
        // transients still punch through.
        const meterDb = this.meter.getValue() as number;
        const loudness01 = Math.max(0, Math.min(1,
            (meterDb - QUIET_METER_DB) / (LOUD_METER_DB - QUIET_METER_DB)
        ));
        this.compressor.threshold.value = lerp(
            COMP_THRESHOLD_QUIET, COMP_THRESHOLD_LOUD, loudness01
        );
        this.compressor.ratio.value = lerp(
            COMP_RATIO_MIN, COMP_RATIO_MAX, loudness01
        );
    }

    // ── Snapshot for UI ──────────────────────────────────────

    /** Returns a read-only snapshot of the mixer's current state for the HUD */
    getSnapshot(): MixerSnapshot {
        const lowDucking = this.currentLowGain < -1;
        const midCutting = this.currentMidGain < -1;
        const compReduction = (this.compressor as Tone.Compressor).reduction ?? 0;
        const compressorEngaged = compReduction < -2;

        // Raw FFT bins for spectrogram
        const fftBins = this.fft.getValue() as Float32Array;

        // Build human-readable status
        const parts: string[] = [];
        if (lowDucking)        parts.push(`Low duck ${this.currentLowGain.toFixed(1)} dB`);
        if (midCutting)        parts.push(`Mid cut @ ${MID_CUT_FREQ} Hz`);
        if (compressorEngaged) parts.push(`Comp ${compReduction.toFixed(1)} dB`);
        const statusText = parts.length > 0
            ? parts.join('  |  ')
            : 'Monitoring…';

        return {
            lowDb:  this.smoothLow,
            midDb:  this.smoothMid,
            highDb: this.smoothHigh,
            lowDucking,
            midCutting,
            compressorEngaged,
            lowGainDb:  this.currentLowGain,
            midGainDb:  this.currentMidGain,
            highGainDb: this.currentHighGain,
            compReduction,
            statusText,
            fftBins: new Float32Array(fftBins),
        };
    }

    // ── Cleanup ──────────────────────────────────────────────

    dispose(): void {
        this.fft.dispose();
        this.meter.dispose();
        this.lowShelf.dispose();
        this.midPeak.dispose();
        this.highShelf.dispose();
        this.compressor.dispose();
        this.input.dispose();
        this.output.dispose();
    }

    // ── Internal helpers ─────────────────────────────────────

    /** Push an FFT frame into the ring buffer */
    private pushRing(values: Float32Array): void {
        // Store a copy (FFT reuses its internal array)
        this.fftRing.push(new Float32Array(values));
        if (this.fftRing.length > RING_SIZE) {
            this.fftRing.shift();
        }
    }

    /** Average the ring buffer for smooth spectrum values */
    private getSmoothedFFT(): Float32Array {
        if (this.fftRing.length === 0) return new Float32Array(FFT_SIZE);
        const len = this.fftRing[0].length;
        const avg = new Float32Array(len);
        for (const frame of this.fftRing) {
            for (let i = 0; i < len; i++) {
                avg[i] += frame[i];
            }
        }
        const n = this.fftRing.length;
        for (let i = 0; i < len; i++) {
            avg[i] /= n;
        }
        return avg;
    }

    /**
     * Compute average dB energy in three bands from the FFT data.
     *
     * Each FFT bin covers  sampleRate / FFT_SIZE  Hz.
     * We sum the bins that fall into each band and average.
     */
    private bandEnergies(fft: Float32Array): { low: number; mid: number; high: number } {
        const binHz = this.sampleRate / FFT_SIZE;
        // Only the first half of FFT bins represent unique frequencies
        const nyquistBin = FFT_SIZE / 2;

        let lowSum = 0, lowCount = 0;
        let midSum = 0, midCount = 0;
        let highSum = 0, highCount = 0;

        for (let i = 0; i < nyquistBin; i++) {
            const freq = i * binHz;
            const db = fft[i];

            if (freq < LOW_UPPER) {
                lowSum += db; lowCount++;
            } else if (freq < MID_UPPER) {
                midSum += db; midCount++;
            } else {
                highSum += db; highCount++;
            }
        }

        return {
            low:  lowCount  > 0 ? lowSum  / lowCount  : -100,
            mid:  midCount  > 0 ? midSum  / midCount  : -100,
            high: highCount > 0 ? highSum / highCount : -100,
        };
    }
}
