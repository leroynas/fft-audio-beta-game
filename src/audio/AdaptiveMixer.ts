/**
 * AdaptiveMixer.ts — Phase 4: The "live FOH engineer" brain (v3 — Modes Independent)
 *
 * Aangepast voor volledige onafhankelijkheid:
 * - Compressor veel milder → Mode B beïnvloedt Mode A vrijwel niet meer
 * - FFT-visualisatie blijft sterk en duidelijk
 * - EQ en ducking-logica behouden
 */

import * as Tone from 'tone';

// ── Band boundary frequencies ────────────────────────────────
const LOW_UPPER  = 300;   // Hz
const MID_UPPER  = 4000;  // Hz

// ── FFT / analysis config ────────────────────────────────────
const FFT_SIZE   = 64;
const RING_SIZE  = 10;
const UPDATE_INTERVAL_FRAMES = 2;

// ── Threshold constants (dB) ─────────────────────────────────
const LOW_LOUD_THRESHOLD   = -20;
const MID_DOMINANCE_DB     = 8;

// ── EQ adjustment ranges ─────────────────────────────────────
const LOW_DUCK_DB    = -6;
const MID_CUT_DB     = -5;
const MID_CUT_FREQ   = 1500;
const MID_CUT_Q      = 1.5;
const HIGH_LIFT_DB   = 3;

// ── Compressor adaptive ranges (milder voor onafhankelijkheid) ────────
const COMP_THRESHOLD_QUIET = -22;
const COMP_THRESHOLD_LOUD  = -10;
const COMP_RATIO_MIN       = 1.8;
const COMP_RATIO_MAX       = 4.0;
const LOUD_METER_DB        = -9;
const QUIET_METER_DB       = -32;

const EQ_LERP = 0.12;

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export interface MixerSnapshot {
    lowDb:  number;
    midDb:  number;
    highDb: number;
    lowDucking: boolean;
    midCutting: boolean;
    compressorEngaged: boolean;
    lowGainDb:  number;
    midGainDb:  number;
    highGainDb: number;
    compReduction: number;
    statusText: string;
    fftBins: Float32Array;
}

export class AdaptiveMixer {
    private fft: Tone.FFT;
    private meter: Tone.Meter;

    private lowShelf:  Tone.Filter;
    private midPeak:   Tone.Filter;
    private highShelf: Tone.Filter;
    private compressor: Tone.Compressor;

    public readonly input: Tone.Gain;
    public readonly output: Tone.Gain;

    private fftRing: Float32Array[] = [];

    private smoothLow  = -60;
    private smoothMid  = -60;
    private smoothHigh = -60;

    private currentLowGain  = 0;
    private currentMidGain  = 0;
    private currentHighGain = 0;

    public footstepsActive = false;
    public propActive      = false;

    private frameCount = 0;
    private displayPhase = 0;

    private eventPulse = 0;
    private eventLow = 0.25;
    private eventMid = 0.45;
    private eventHigh = 0.35;

    private sampleRate = 44100;

    constructor() {
        this.input  = new Tone.Gain(1);
        this.output = new Tone.Gain(1);

        this.fft   = new Tone.FFT(FFT_SIZE);
        this.meter = new Tone.Meter({ smoothing: 0.75 });

        this.lowShelf = new Tone.Filter({ type: 'lowshelf', frequency: LOW_UPPER, gain: 0, rolloff: -12 });
        this.midPeak  = new Tone.Filter({ type: 'peaking',  frequency: MID_CUT_FREQ, gain: 0, Q: MID_CUT_Q, rolloff: -12 });
        this.highShelf = new Tone.Filter({ type: 'highshelf', frequency: MID_UPPER, gain: 0, rolloff: -12 });

        // Mildere compressor → Mode A en Mode B beïnvloeden elkaar veel minder
        this.compressor = new Tone.Compressor({
            threshold: -14,
            ratio: 3,
            attack: 0.012,
            release: 0.25,
            knee: 10,
        });

        // Signal chain
        this.input.connect(this.lowShelf);
        this.lowShelf.connect(this.midPeak);
        this.midPeak.connect(this.highShelf);
        this.highShelf.connect(this.compressor);
        this.compressor.connect(this.output);

        // Analyse na compressor (wat de speler echt hoort)
        this.compressor.connect(this.fft);
        this.compressor.connect(this.meter);
    }

    notifyEvent(kind: 'footstep' | 'prop' | 'tool' | 'plant', surfaceOrProfile = ''): void {
        const profile = `${kind}:${surfaceOrProfile}`;
        if (profile.includes('stone') || profile.includes('pickaxe')) {
            this.eventLow = 0.42; this.eventMid = 0.72; this.eventHigh = 0.66;
        } else if (profile.includes('wood') || profile.includes('axe')) {
            this.eventLow = 0.62; this.eventMid = 0.58; this.eventHigh = 0.34;
        } else if (profile.includes('gravel') || profile.includes('sand') || profile.includes('hoe')) {
            this.eventLow = 0.36; this.eventMid = 0.66; this.eventHigh = 0.78;
        } else if (profile.includes('water') || profile.includes('watering')) {
            this.eventLow = 0.28; this.eventMid = 0.42; this.eventHigh = 0.86;
        } else if (kind === 'prop' || kind === 'plant') {
            this.eventLow = 0.50; this.eventMid = 0.70; this.eventHigh = 0.52;
        } else {
            this.eventLow = 0.40; this.eventMid = 0.56; this.eventHigh = 0.50;
        }
        this.eventPulse = Math.min(1, Math.max(this.eventPulse, kind === 'footstep' ? 0.78 : 1));
    }

    update(): void {
        this.frameCount++;
        this.eventPulse *= 0.88;
        if (this.eventPulse < 0.005) this.eventPulse = 0;

        if (this.frameCount % UPDATE_INTERVAL_FRAMES !== 0) return;

        if (this.sampleRate === 44100 && Tone.getContext().sampleRate) {
            this.sampleRate = Tone.getContext().sampleRate;
        }

        const fftValues = this.fft.getValue() as Float32Array;
        this.pushRing(fftValues);

        const smoothed = this.getSmoothedFFT();
        const { low, mid, high } = this.bandEnergies(smoothed);

        this.smoothLow  = lerp(this.smoothLow,  low,  0.22);
        this.smoothMid  = lerp(this.smoothMid,  mid,  0.22);
        this.smoothHigh = lerp(this.smoothHigh, high, 0.22);

        let targetLowGain = 0;
        if (this.smoothLow > LOW_LOUD_THRESHOLD && this.propActive) {
            targetLowGain = LOW_DUCK_DB;
        }

        let targetMidGain = 0;
        if (this.footstepsActive && (this.smoothMid - this.smoothHigh) > MID_DOMINANCE_DB) {
            targetMidGain = MID_CUT_DB;
        }

        let targetHighGain = 0;
        if (this.smoothHigh < this.smoothMid - 6) {
            targetHighGain = HIGH_LIFT_DB;
        }

        this.currentLowGain  = lerp(this.currentLowGain,  targetLowGain,  EQ_LERP);
        this.currentMidGain  = lerp(this.currentMidGain,  targetMidGain,  EQ_LERP);
        this.currentHighGain = lerp(this.currentHighGain, targetHighGain, EQ_LERP);

        this.lowShelf.gain.value  = this.currentLowGain;
        this.midPeak.gain.value   = this.currentMidGain;
        this.highShelf.gain.value = this.currentHighGain;

        const meterDb = this.meter.getValue() as number;
        const loudness01 = Math.max(0, Math.min(1,
            (meterDb - QUIET_METER_DB) / (LOUD_METER_DB - QUIET_METER_DB)
        ));
        this.compressor.threshold.value = lerp(COMP_THRESHOLD_QUIET, COMP_THRESHOLD_LOUD, loudness01);
        this.compressor.ratio.value = lerp(COMP_RATIO_MIN, COMP_RATIO_MAX, loudness01);
    }

    getSnapshot(): MixerSnapshot {
        const lowDucking = this.currentLowGain < -1;
        const midCutting = this.currentMidGain < -1;
        const compReduction = (this.compressor as any).reduction ?? 0;
        const compressorEngaged = compReduction < -2;

        const rawBins = this.fft.getValue() as Float32Array;
        const fftBins = new Float32Array(rawBins.length);

        for (let i = 0; i < rawBins.length; i++) {
            const v = Number.isFinite(rawBins[i]) && rawBins[i] > -100 ? rawBins[i] : -100;
            fftBins[i] = Math.max(-60, Math.min(0, v));
        }

        this.displayPhase += 0.22;
        const pulse = this.eventPulse * 1.35;

        if (pulse > 0.02) {
            for (let i = 0; i < fftBins.length; i++) {
                const pos = i / Math.max(1, fftBins.length - 1);
                const profile = pos < 0.22 ? this.eventLow : pos < 0.62 ? this.eventMid : this.eventHigh;
                const ripple = 0.7 + 0.3 * Math.sin(i * 1.3 + this.displayPhase * 7);
                const boost = pulse * profile * 58 * ripple;
                fftBins[i] = Math.max(fftBins[i], Math.max(-60, Math.min(0, fftBins[i] + boost)));
            }
        }

        const pulseLow  = -60 + pulse * this.eventLow * 52;
        const pulseMid  = -60 + pulse * this.eventMid * 52;
        const pulseHigh = -60 + pulse * this.eventHigh * 52;

        const displayLow  = Math.max(this.smoothLow, pulseLow);
        const displayMid  = Math.max(this.smoothMid, pulseMid);
        const displayHigh = Math.max(this.smoothHigh, pulseHigh);

        const parts: string[] = [];
        if (this.footstepsActive) parts.push('walk');
        if (this.propActive) parts.push('prop');
        if (lowDucking) parts.push(`low↓${this.currentLowGain.toFixed(0)}`);
        if (midCutting) parts.push(`mid↓${this.currentMidGain.toFixed(0)}`);
        if (compressorEngaged) parts.push(`comp↓${compReduction.toFixed(0)}`);

        return {
            lowDb: displayLow,
            midDb: displayMid,
            highDb: displayHigh,
            lowDucking,
            midCutting,
            compressorEngaged,
            lowGainDb: this.currentLowGain,
            midGainDb: this.currentMidGain,
            highGainDb: this.currentHighGain,
            compReduction,
            statusText: parts.length ? parts.join(' | ') : 'stable',
            fftBins,
        };
    }

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

    private pushRing(values: Float32Array): void {
        this.fftRing.push(new Float32Array(values));
        if (this.fftRing.length > RING_SIZE) this.fftRing.shift();
    }

    private getSmoothedFFT(): Float32Array {
        if (this.fftRing.length === 0) return new Float32Array(FFT_SIZE);
        const len = this.fftRing[0].length;
        const avg = new Float32Array(len);
        for (const frame of this.fftRing) {
            for (let i = 0; i < len; i++) avg[i] += frame[i];
        }
        const n = this.fftRing.length;
        for (let i = 0; i < len; i++) avg[i] /= n;
        return avg;
    }

    private bandEnergies(fft: Float32Array): { low: number; mid: number; high: number } {
        const binHz = this.sampleRate / FFT_SIZE;
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