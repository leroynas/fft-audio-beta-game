/**
 * LiveDriftMode.ts — Mode B: ECHTE Granular Synthesis (v27 — Anti-Repetition)
 *
 * Volledig herzien voor VARIATIE:
 * - Sterke multi-timescale drift (short + medium + long term)
 * - Langzamere parameter evolutie + subtiele random walk
 * - Meer variatie in grain position, detune en burst timing
 * - Herkenbaar maar nooit repetitief
 */

import * as Tone from 'tone';
import { IAudioMode, seededRandom } from '../AudioManager';
import { PerformerState } from '../PerformerState';
import { FloorType, PropType } from '../../types';

const FOOTSTEP_SAMPLES: Record<FloorType, string[]> = { /* ongewijzigd */ };
const PROP_SAMPLES: Record<PropType, string[]> = { /* ongewijzigd */ };

const BASE_VOLUME_DB = 3.2;
const MIN_RETRIGGER_MS = 36;

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

type SampleGroup = FloorType | PropType;

export class LiveDriftMode implements IAudioMode {
    private grainPlayers = new Map<string, Tone.GrainPlayer>();
    private filter?: Tone.Filter;
    private compressor?: Tone.Compressor;
    private analyser?: Tone.Analyser;
    private rng: () => number;
    private initialized = false;
    private disposed = false;

    private memory = new Map<SampleGroup, {
        index: number;
        pitch: number;
        volume: number;
        cutoff: number;
        grainSize: number;
        overlap: number;
        driftOffset: number;     // extra lange-termijn drift
        lastMs: number;
        count: number;
    }>();

    private globalDrift = 0;     // langzaam stijgende drift voor hele mode

    constructor(private readonly state: PerformerState, private readonly output: Tone.ToneAudioNode, seed: string) {
        this.rng = seededRandom(seed + '_granular_mode_b_v27');
    }

    async init(): Promise<void> {
        if (this.initialized) return;

        this.filter = new Tone.Filter({ frequency: 2600, type: 'lowpass', rolloff: -24, Q: 1.0 });
        this.compressor = new Tone.Compressor({ threshold: -26, ratio: 7, attack: 0.003, release: 0.14, knee: 12 });
        this.analyser = new Tone.Analyser('fft', 64);

        this.filter.connect(this.compressor);
        this.compressor.connect(this.analyser);
        this.analyser.connect(this.output);

        // ... (zelfde sample loading als v25)

        const urls = new Set<string>();
        Object.values(FOOTSTEP_SAMPLES).forEach(list => list.forEach(u => urls.add(u)));
        Object.values(PROP_SAMPLES).forEach(list => list.forEach(u => urls.add(u)));

        const loads: Promise<void>[] = [];
        for (const url of urls) {
            loads.push(new Promise<void>((resolve) => {
                try {
                    const gp = new Tone.GrainPlayer({
                        url, volume: BASE_VOLUME_DB, grainSize: 0.22, overlap: 0.65,
                        onload: () => {
                            if (!this.disposed) {
                                this.grainPlayers.set(url, gp);
                                gp.connect(this.filter!);
                            }
                            resolve();
                        }
                    });
                } catch { resolve(); }
            }));
        }

        await Promise.all(loads);
        this.initialized = true;
        console.log(`[LiveDriftMode v27] Granular Mode B — anti-repetition & sterke drift`);
    }

    playFootstep(floor: FloorType): void { this.playGranular(floor, FOOTSTEP_SAMPLES[floor], 'footstep'); }
    playPropInteract(prop: PropType): void { this.playGranular(prop, PROP_SAMPLES[prop], 'prop'); }

    private playGranular(group: SampleGroup, urls: string[], kind: 'footstep' | 'prop'): void {
        if (this.disposed || !this.initialized || !this.filter || urls.length === 0) return;

        const now = performance.now();
        let prev = this.memory.get(group) ?? {
            index: Math.floor(this.rng() * urls.length),
            pitch: 0, volume: BASE_VOLUME_DB, cutoff: 2600,
            grainSize: 0.22, overlap: 0.65, driftOffset: 0,
            lastMs: -Infinity, count: 0
        };

        if (now - prev.lastMs < MIN_RETRIGGER_MS) return;

        const energy = clamp(this.state.energy, 0, 1);
        const weight = clamp(this.state.weight, 0, 1);
        const brightness = clamp(this.state.brightness, 0, 1);
        const tightness = clamp(this.state.tightness, 0, 1);
        const wetness = clamp((this.state as any).wetness ?? 0.35, 0, 1);

        this.globalDrift += 0.004 + energy * 0.006;   // langzame globale evolutie

        const randomBend = this.rng() * 2 - 1;
        const phrase = Math.sin(prev.count * 0.27 + this.globalDrift * 1.8);

        // Drift + variatie
        const jumpChance = kind === 'footstep' ? clamp(0.18 + energy * 0.22 - tightness * 0.12, 0.09, 0.45) : 0.35;
        const nextIndex = this.rng() < jumpChance ? Math.floor(this.rng() * urls.length) : (prev.index + 1) % urls.length;

        const url = urls[nextIndex];
        const gp = this.grainPlayers.get(url);
        if (!gp?.loaded || !gp.buffer) return;

        // === Sterke multi-scale targets + extra drift ===
        const targetPitch = clamp(
            (energy - 0.45) * 2.4 + (brightness - 0.5) * 1.65 + (wetness - 0.5) * -1.1 +
            phrase * 1.2 + randomBend * 0.9 + this.globalDrift * 0.8,
            -6, 6
        );

        const targetVolume = clamp(BASE_VOLUME_DB + weight * 6.0 + energy * 3.1 + randomBend * 1.7 - wetness * 2.0, -11, 9);

        const targetGrainSize = clamp(0.13 + (1 - tightness) * 0.39 + wetness * 0.11 + Math.sin(this.globalDrift) * 0.07, 0.10, 0.60);
        const targetOverlap = clamp(0.50 + tightness * 0.40 + energy * 0.25 + wetness * 0.16, 0.42, 0.94);

        const targetCutoff = clamp(680 + brightness * 5300 + wetness * 1450 + energy * 1150 + this.globalDrift * 300, 550, 9900);

        // Langzame smoothing (voorkomt herhaling)
        const pitch = prev.pitch * 0.58 + targetPitch * 0.42;
        const volume = prev.volume * 0.55 + targetVolume * 0.45;
        const grainSize = prev.grainSize * 0.65 + targetGrainSize * 0.35;
        const overlap = prev.overlap * 0.62 + targetOverlap * 0.38;
        const cutoff = prev.cutoff * 0.70 + targetCutoff * 0.30;

        // FFT adaptive mixing (zoals voorheen)
        const fft = this.analyser!.getValue() as Float32Array;
        let low = 0, mid = 0;
        for (let i = 0; i < 14; i++) low += fft[i];
        for (let i = 14; i < 38; i++) mid += fft[i];
        const spectralConflict = clamp((low * 1.4 + mid * 0.85) / 22 - 1.15, 0, 1.8);

        try {
            gp.playbackRate = Math.pow(2, pitch / 12);
            gp.detune = (pitch % 1) * 100 + randomBend * 40;   // extra detune variatie
            gp.grainSize = grainSize;
            gp.overlap = overlap;
            gp.volume.value = volume - spectralConflict * 3.8;

            this.filter.frequency.setTargetAtTime(cutoff, Tone.now(), 0.09);
            this.filter.Q.value = 0.9 + tightness * 2.3;

            const burstDuration = clamp(0.24 + energy * 0.45 + (1 - tightness) * 0.36, 0.24, 0.95);
            // Extra variatie in offset
            const randomOffset = gp.buffer.duration * (0.03 + this.rng() * 0.48 + Math.sin(this.globalDrift) * 0.15);

            if (gp.state === 'started') gp.stop();
            gp.start(Tone.now(), randomOffset, burstDuration);

        } catch (err) {
            console.warn('[LiveDriftMode v27] granular burst:', err);
        }

        this.memory.set(group, { index: nextIndex, pitch, volume, cutoff, grainSize, overlap, driftOffset: this.globalDrift, lastMs: now, count: prev.count + 1 });
    }
    
    dispose(): void {
        this.disposed = true;
        this.filter?.dispose();
        this.compressor?.dispose();
        this.analyser?.dispose();
        for (const gp of this.grainPlayers.values()) gp.dispose();
        this.grainPlayers.clear();
        this.memory.clear();
        this.initialized = false;
    }
}