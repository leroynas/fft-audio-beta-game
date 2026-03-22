/**
 * LiveDriftMode.ts — Mode B: Live Drift + Memory granular audio.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  THESIS HEART                                                       │
 * │                                                                     │
 * │  Instead of picking one random short sample per event (Mode A),     │
 * │  Live Drift reads grains from a LONG continuous recording using     │
 * │  Tone.GrainPlayer.  The playback position maintains MEMORY:         │
 * │  each new grain starts near where the previous grain ended,         │
 * │  giving the listener the impression of one performer continuing     │
 * │  a session rather than a library of disconnected one-shots.         │
 * │                                                                     │
 * │  Grain parameters (rate, detune, size, overlap, volume) are not     │
 * │  i.i.d. random — they are DERIVED from the slowly drifting          │
 * │  PerformerState, which itself responds to gameplay input via         │
 * │  exponential lerp.  The result: smooth, organic, human-feeling      │
 * │  sound that evolves with the player's movement.                     │
 * └─────────────────────────────────────────────────────────────────────┘
 */
import * as Tone from 'tone';
import { IAudioMode } from '../AudioManager';
import { seededRandom } from '../AudioManager';
import { PerformerState } from '../PerformerState';
import { FloorType, PropType } from '../../types';

// ── Long-loop sample paths ───────────────────────────────────
// These are continuous recordings (60–180 s) of a performer walking
// on each surface / interacting with each prop, recorded in one take.
// Place them in  public/assets/audio/long_loops/

const FOOTSTEP_LOOPS: Record<FloorType, string> = {
    wood:   '/assets/audio/long_loops/wood_long.mp3',
    gravel: '/assets/audio/long_loops/gravel_long.mp3',
    stone:  '/assets/audio/long_loops/stone_long.mp3',
};

const PROP_LOOPS: Record<PropType, string> = {
    keys:   '/assets/audio/long_loops/keys_long.mp3',
    cloth:  '/assets/audio/long_loops/cloth_long.mp3',
    barrel: '/assets/audio/long_loops/barrel_long.mp3',
    door:   '/assets/audio/long_loops/door_long.mp3',
};

// ── Gain compensation ────────────────────────────────────────
// Both modes should output at equal perceived loudness.
// Adjust this if Mode B is louder/quieter than Mode A in testing.
const OUTPUT_GAIN_DB = -3;

// ── Memory nudge range (seconds) ─────────────────────────────
// When choosing the next grain start, we pick within ±NUDGE of the
// previous position. This is the "memory" — the performer continues
// roughly where they left off instead of jumping to a random spot.
const POSITION_NUDGE_SEC = 2.0;

// ──────────────────────────────────────────────────────────────

/**
 * Wraps a single Tone.GrainPlayer + processing chain for one
 * long recording. Maintains a "cursor" position for memory.
 */
class GrainVoice {
    player: Tone.GrainPlayer;
    filter: Tone.Filter;
    reverb: Tone.Reverb;
    reverbGain: Tone.Gain;
    dryGain: Tone.Gain;
    limiter: Tone.Limiter;

    /** Remembered playback cursor — the "memory" of this voice */
    cursor = 0;

    /** Duration of the loaded buffer (seconds), set after load */
    duration = 0;

    loaded = false;

    /** Seeded PRNG for deterministic cursor nudge */
    private rng: () => number;

    constructor(url: string, output: Tone.ToneAudioNode, rng: () => number) {
        this.rng = rng;
        // GrainPlayer: the core granular engine
        this.player = new Tone.GrainPlayer({
            url,
            loop: true,
            grainSize: 0.2,
            overlap: 0.1,
            playbackRate: 1,
            onload: () => {
                this.loaded = true;
                this.duration = this.player.buffer.duration;
                console.log(`[GrainVoice] Loaded ${url}  (${this.duration.toFixed(1)}s)`);
            },
            onerror: () => {
                console.warn(`[GrainVoice] Failed to load: ${url}`);
            },
        });

        // Per-grain processing chain:
        //   GrainPlayer → Filter → dry/wet split → Limiter → output
        this.filter = new Tone.Filter({ type: 'lowpass', frequency: 8000, rolloff: -12 });
        this.dryGain = new Tone.Gain(1);
        this.reverbGain = new Tone.Gain(0);
        this.reverb = new Tone.Reverb({ decay: 2.5, wet: 1 });
        this.limiter = new Tone.Limiter(-1);

        // Wiring
        this.player.connect(this.filter);
        this.filter.connect(this.dryGain);
        this.filter.connect(this.reverb);
        this.reverb.connect(this.reverbGain);
        this.dryGain.connect(this.limiter);
        this.reverbGain.connect(this.limiter);
        this.limiter.connect(output);
    }

    /**
     * Trigger a grain burst shaped by PerformerState.
     *
     * MEMORY: The cursor advances by a small random nudge instead of
     * jumping to a totally random position.  This is the key difference
     * from i.i.d. random: the performer "continues" their take.
     */
    trigger(state: PerformerState): void {
        if (!this.loaded || this.duration === 0) return;

        // ── Memory-based cursor advance ──────────────────────
        // Nudge the cursor forward/backward by a small random offset.
        // Wraps around so we never go out of bounds.
        const nudge = (this.rng() * 2 - 1) * POSITION_NUDGE_SEC;
        this.cursor = ((this.cursor + nudge) % this.duration + this.duration) % this.duration;

        // ── Derive grain parameters from PerformerState ──────
        // (These formulas map the 0–1 state dimensions into audio params)
        this.player.playbackRate = 0.9 + state.energy * 0.3;
        this.player.detune       = -200 + state.brightness * 400;
        this.player.grainSize    = 0.15 + state.weight * 0.25;
        this.player.overlap      = 0.08 + state.tightness * 0.12;

        // Volume: heavier weight → slightly louder, normalised around OUTPUT_GAIN_DB
        const weightVol = OUTPUT_GAIN_DB + (state.weight - 0.5) * 4;
        this.player.volume.value = weightVol;

        // ── Filter: brightness controls cutoff ───────────────
        // Low brightness → muffled (2 kHz), high → open (12 kHz)
        this.filter.frequency.value = 2000 + state.brightness * 10000;

        // ── Reverb send: wetness controls dry/wet balance ────
        this.dryGain.gain.value    = 1 - state.wetness * 0.5;
        this.reverbGain.gain.value = state.wetness * 0.6;

        // ── Set the loop start to our cursor position ────────
        this.player.loopStart = this.cursor;
        this.player.loopEnd   = Math.min(this.cursor + this.player.grainSize * 4, this.duration);

        // Restart the grain player from the cursor
        if (this.player.state === 'started') {
            this.player.stop();
        }
        // Play a short burst (grainSize * 3) — enough for the footstep/prop event
        this.player.start(undefined, this.cursor);

        // Schedule stop after a short window so grains don't run forever
        const burstDuration = this.player.grainSize * 4;
        this.player.stop(`+${burstDuration}`);
    }

    dispose(): void {
        this.player.dispose();
        this.filter.dispose();
        this.reverb.dispose();
        this.reverbGain.dispose();
        this.dryGain.dispose();
        this.limiter.dispose();
    }
}

// ──────────────────────────────────────────────────────────────
export class LiveDriftMode implements IAudioMode {
    private state: PerformerState;

    /** One GrainVoice per floor type */
    private footstepVoices = new Map<FloorType, GrainVoice>();
    /** One GrainVoice per prop type */
    private propVoices = new Map<PropType, GrainVoice>();

    /** Master output gain shared with ClassicMode for equal loudness */
    private masterGain: Tone.Gain;

    private initialized = false;

    /** External output node (shared bus from AudioManager) */
    private externalOutput: Tone.ToneAudioNode;

    /** Seeded PRNG */
    private rng: () => number;

    constructor(performerState: PerformerState, output: Tone.ToneAudioNode, seed: string) {
        this.state = performerState;
        this.externalOutput = output;
        this.rng = seededRandom(seed + '_livedrift');
        this.masterGain = new Tone.Gain(1);
        this.masterGain.connect(this.externalOutput);
    }

    // ── Lifecycle ─────────────────────────────────────────────

    async init(): Promise<void> {
        if (this.initialized) return;

        // Create GrainVoice for each footstep loop
        for (const [floor, url] of Object.entries(FOOTSTEP_LOOPS)) {
            this.footstepVoices.set(floor as FloorType, new GrainVoice(url, this.masterGain, this.rng));
        }

        // Create GrainVoice for each prop loop
        for (const [prop, url] of Object.entries(PROP_LOOPS)) {
            this.propVoices.set(prop as PropType, new GrainVoice(url, this.masterGain, this.rng));
        }

        // Wait for all buffers to attempt loading (non-blocking on failure)
        await new Promise<void>((resolve) => {
            const check = () => {
                const allVoices = [...this.footstepVoices.values(), ...this.propVoices.values()];
                const allSettled = allVoices.every((v) => v.loaded || v.duration === 0);
                if (allSettled) {
                    resolve();
                } else {
                    setTimeout(check, 100);
                }
            };
            // Start checking after a short delay to give Tone time to fetch
            setTimeout(check, 200);
        });

        this.initialized = true;
        console.log('[LiveDriftMode] Initialized — grain voices ready');
    }

    dispose(): void {
        for (const v of this.footstepVoices.values()) v.dispose();
        for (const v of this.propVoices.values()) v.dispose();
        this.footstepVoices.clear();
        this.propVoices.clear();
        this.masterGain.dispose();
        this.initialized = false;
    }

    // ── Sound triggers ────────────────────────────────────────

    /**
     * Trigger a granular footstep.
     *
     * Unlike ClassicMode which picks a random 0.3s sample each time,
     * this reads grains from a long continuous recording.  The grain
     * position has MEMORY (cursor) and the parameters DRIFT with the
     * PerformerState — no two footsteps sound the same yet they all
     * feel connected, as if one person is walking in one take.
     */
    playFootstep(floor: FloorType): void {
        const voice = this.footstepVoices.get(floor);
        if (!voice) return;
        voice.trigger(this.state);
    }

    /**
     * Trigger a granular prop interaction sound.
     * Same memory + drift logic as footsteps.
     */
    playPropInteract(prop: PropType): void {
        const voice = this.propVoices.get(prop);
        if (!voice) return;
        voice.trigger(this.state);
    }
}
