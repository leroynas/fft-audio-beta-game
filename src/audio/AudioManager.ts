/**
 * AudioManager.ts — Central audio controller.
 *
 * Owns the PerformerState, AdaptiveMixer, and the current AudioMode.
 * All mode output routes through a shared bus into the AdaptiveMixer,
 * which performs real-time FFT analysis, dynamic EQ, and adaptive
 * compression — then sends to Tone.getDestination().
 *
 * Phase 5 additions:
 *  - Session seed system (deterministic randomness per session)
 *  - Shared zone-based Tone.Reverb with floor-driven wet lerp
 *  - Tone.Panner for spatial stereo positioning
 *  - Loudness normalization via Tone.Limiter on master out
 *
 * Signal chain:
 *   [Mode] → modeBus → panner → reverbSend (dry+wet) → AdaptiveMixer → limiter → destination
 */
import * as Tone from 'tone';
import { AudioMode, FloorType, PropType } from '../types';
import { ClassicMode } from './modes/ClassicMode';
import { LiveDriftMode } from './modes/LiveDriftMode';
import { PerformerState } from './PerformerState';
import { AdaptiveMixer, MixerSnapshot } from './AdaptiveMixer';

/** Interface every audio mode must implement */
export interface IAudioMode {
    /** Called once after Tone.js context is started */
    init(): Promise<void>;
    /** Play a footstep sound for the given surface */
    playFootstep(floor: FloorType): void;
    /** Play the interaction sound for the given prop */
    playPropInteract(prop: PropType): void;
    /** Clean up resources */
    dispose(): void;
}

// ── Seed utilities ───────────────────────────────────────────
/** Generate a random 6-character hex seed */
function generateSeed(): string {
    const bytes = new Uint8Array(3);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Simple seeded PRNG (mulberry32) — returns a function that produces 0–1 */
export function seededRandom(seed: string): () => number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
        h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
    }
    return () => {
        h |= 0; h = h + 0x6D2B79F5 | 0;
        let t = Math.imul(h ^ h >>> 15, 1 | h);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// ── Zone reverb wet targets ──────────────────────────────────
const REVERB_WET_TARGETS: Record<FloorType, number> = {
    wood:   0.15,
    gravel: 0.08,
    stone:  0.35,
};
const REVERB_LERP = 0.05; // smooth wet changes over ~0.5s at 60fps

export class AudioManager {
    private currentMode: IAudioMode;
    private currentModeName: AudioMode = 'classic';

    /** The virtual performer that drives Live Drift Mode (Mode B) */
    private performerState = new PerformerState();

    /** The adaptive live mixer (Phase 4 FFT + EQ + compression) */
    private adaptiveMixer = new AdaptiveMixer();

    /**
     * Shared bus node that all mode outputs connect to.
     * This feeds into the spatial/reverb chain → AdaptiveMixer.
     */
    private modeBus: Tone.Gain;

    /** Stereo panner — positioned by player movement direction */
    private panner: Tone.Panner;

    /** Shared zone-based reverb */
    private reverb: Tone.Reverb;
    private reverbWet = 0.15;

    /** Master limiter for loudness normalization */
    private limiter: Tone.Limiter;

    /** True once the Tone.js AudioContext has been resumed */
    private started = false;

    /** Timestamp (ms) of the last prop interaction — used for context flag */
    private lastPropTime = 0;

    /** Session seed for deterministic randomness */
    private _seed: string;

    constructor() {
        this._seed = generateSeed();

        // Create the signal chain: modeBus → panner → reverb → mixer → limiter → dest
        this.modeBus = new Tone.Gain(1);
        this.panner = new Tone.Panner(0);
        this.reverb = new Tone.Reverb({ decay: 2.5, wet: 0.15 });
        this.limiter = new Tone.Limiter(-1);

        // Wire: modeBus → panner → reverb → mixer input
        this.modeBus.connect(this.panner);
        this.panner.connect(this.reverb);
        this.reverb.connect(this.adaptiveMixer.input);

        // Rewire mixer output through limiter
        this.adaptiveMixer.output.disconnect();
        this.adaptiveMixer.output.connect(this.limiter);
        this.limiter.toDestination();

        // Default mode: ClassicMode routed through the bus
        this.currentMode = new ClassicMode(this.modeBus, this._seed);
    }

    // ── Public API ────────────────────────────────────────────

    /** Must be called from a user gesture (click / keypress) to unlock Web Audio */
    async ensureStarted(): Promise<void> {
        if (this.started) return;
        await Tone.start();
        await this.currentMode.init();
        this.started = true;
        console.log('[AudioManager] Tone.js context started');
    }

    /**
     * Per-frame update: advance PerformerState + AdaptiveMixer + zone reverb.
     *
     * @param deltaSec  Frame delta in seconds.
     * @param speed     Player physics speed (px/frame).
     * @param floor     Current floor surface.
     */
    updatePerformer(deltaSec: number, speed: number, floor: FloorType): void {
        this.performerState.update(deltaSec, speed, floor);

        // Set context flags for the mixer so it knows what's happening
        this.adaptiveMixer.footstepsActive = speed > 20;
        // Prop interaction decays after 400 ms
        this.adaptiveMixer.propActive = (performance.now() - this.lastPropTime) < 400;

        // Zone-based reverb wet lerp
        const targetWet = REVERB_WET_TARGETS[floor];
        this.reverbWet += (targetWet - this.reverbWet) * REVERB_LERP;
        this.reverb.wet.value = this.reverbWet;

        // Run the adaptive mixer analysis + EQ/comp adjustment
        this.adaptiveMixer.update();
    }

    /**
     * Update stereo panner based on player velocity direction.
     * @param vx Horizontal velocity (-MAX_SPEED to +MAX_SPEED)
     * @param maxSpeed Maximum player speed for normalization
     */
    updatePanning(vx: number, maxSpeed: number): void {
        // Map velocity to -1..1 panning. Subtle: clamp to ±0.6
        const pan = Math.max(-0.6, Math.min(0.6, vx / maxSpeed));
        this.panner.pan.value = pan;
    }

    /** Switch between audio modes */
    async switchMode(mode: AudioMode): Promise<void> {
        if (mode === this.currentModeName) return;

        // Dispose old mode
        this.currentMode.dispose();

        // Instantiate new mode — both connect to the same bus
        if (mode === 'classic') {
            this.currentMode = new ClassicMode(this.modeBus, this._seed);
        } else {
            this.currentMode = new LiveDriftMode(this.performerState, this.modeBus, this._seed);
        }

        this.currentModeName = mode;

        if (this.started) {
            await this.currentMode.init();
        }

        console.log(`[AudioManager] Switched to mode: ${mode}`);
    }

    /** Generate a new session seed and re-init the current mode */
    async newSeed(): Promise<void> {
        this._seed = generateSeed();
        console.log(`[AudioManager] New seed: ${this._seed}`);
        // Re-create current mode with new seed
        this.currentMode.dispose();
        if (this.currentModeName === 'classic') {
            this.currentMode = new ClassicMode(this.modeBus, this._seed);
        } else {
            this.currentMode = new LiveDriftMode(this.performerState, this.modeBus, this._seed);
        }
        if (this.started) {
            await this.currentMode.init();
        }
    }

    /** Get current session seed */
    get seed(): string {
        return this._seed;
    }

    /** Get current mode name (for UI display) */
    getModeName(): AudioMode {
        return this.currentModeName;
    }

    /** Get the current mixer snapshot for UI visualisation */
    getMixerSnapshot(): MixerSnapshot {
        return this.adaptiveMixer.getSnapshot();
    }

    /** Trigger a footstep sound */
    playFootstep(floor: FloorType): void {
        if (!this.started) return;
        this.currentMode.playFootstep(floor);
    }

    /** Trigger a prop interaction sound */
    playPropInteract(prop: PropType): void {
        if (!this.started) return;
        this.lastPropTime = performance.now();
        this.currentMode.playPropInteract(prop);
    }
}
