/**
 * LiveDriftMode.ts — Mode B: Granular (v30.3 - Improved Overlap)
 *
 * Belangrijkste wijzigingen:
 * - Herziene overlap berekening voor betere balans tussen smoothheid en definitie
 * - Dynamische overlap reductie bij snelle triggers
 * - Betere relatie tussen grainSize en overlap
 * - Polyphony behouden voor snelle triggering
 */

import * as Tone from 'tone';
import { IAudioMode, seededRandom } from '../AudioManager';
import { PerformerState } from '../PerformerState';
import { FloorType, PropType } from '../../types';

const FOOTSTEP_SAMPLES: Record<FloorType, string[]> = {
    grass: ['/assets/audio/footsteps/wood/wood_01.mp3'],
    sand: ['/assets/audio/footsteps/gravel/gravel_01.mp3'],
    water: ['/assets/audio/footsteps/stone/stone_01.mp3'],
    stone: ['/assets/audio/footsteps/stone/stone_01.mp3'],
    wood: ['/assets/audio/footsteps/wood/wood_01.mp3'],
    gravel: ['/assets/audio/footsteps/gravel/gravel_01.mp3'],
};

const PROP_SAMPLES: Record<PropType, string[]> = {
    keys: ['/assets/audio/props/keys_01.mp3'],
    cloth: ['/assets/audio/props/cloth_01.mp3'],
    barrel: ['/assets/audio/props/barrel_01.mp3'],
    door: ['/assets/audio/props/door_01.mp3'],
    building: ['/assets/audio/props/door_01.mp3'],
    plant: ['/assets/audio/props/keys_01.mp3'],
};

const BASE_VOLUME_DB = -4;
const MIN_RETRIGGER_MS = 28;

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

type SampleGroup = FloorType | PropType;

export class LiveDriftMode implements IAudioMode {
    private grainPlayers = new Map<string, Tone.GrainPlayer[]>();
    private filter?: Tone.Filter;
    private eq?: Tone.EQ3;
    private dynamicHigh?: Tone.Filter;
    private masterComp?: Tone.Compressor;
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
        driftOffset: number;
        lastMs: number;
        count: number;
        playerIndex: number;
    }>();

    private globalDrift = 0;

    constructor(
        private readonly state: PerformerState,
        private readonly output: Tone.ToneAudioNode,
        seed: string
    ) {
        this.rng = seededRandom(seed + '_granular_mode_b_v30_3');
    }

    async init(): Promise<void> {
        if (this.initialized) return;

        this.eq = new Tone.EQ3({ low: -1.8, mid: 0, high: 1.8 });
        this.filter = new Tone.Filter({ frequency: 4800, type: 'lowpass', rolloff: -12, Q: 0.6 });
        this.dynamicHigh = new Tone.Filter({ type: 'highshelf', frequency: 6200, Q: 0.7, rolloff: -12 });
        this.masterComp = new Tone.Compressor({ threshold: -22, ratio: 4, attack: 0.008, release: 0.18, knee: 8 });
        this.analyser = new Tone.Analyser('fft', 128);

        this.eq.connect(this.filter);
        this.filter.connect(this.dynamicHigh);
        this.dynamicHigh.connect(this.masterComp);
        this.masterComp.connect(this.analyser);
        this.analyser.connect(this.output);

        const urls = new Set<string>();
        Object.values(FOOTSTEP_SAMPLES).forEach(list => list.forEach(u => urls.add(u)));
        Object.values(PROP_SAMPLES).forEach(list => list.forEach(u => urls.add(u)));

        const loads: Promise<void>[] = [];
        for (const url of urls) {
            this.grainPlayers.set(url, []);
            for (let i = 0; i < 2; i++) {
                loads.push(new Promise<void>((resolve) => {
                    const gp = new Tone.GrainPlayer({
                        url,
                        volume: BASE_VOLUME_DB,
                        grainSize: 0.18,
                        overlap: 0.68,
                        loop: true,
                        onload: () => {
                            if (!this.disposed) {
                                this.grainPlayers.get(url)!.push(gp);
                                gp.connect(this.eq!);
                            }
                            resolve();
                        },
                    });
                }));
            }
        }

        await Promise.all(loads);
        this.initialized = true;
        console.log(`[LiveDriftMode v30.3] Herziene Overlap + Polyphony`);
    }

    playFootstep(floor: FloorType): void { this.playGranular(floor, FOOTSTEP_SAMPLES[floor], 'footstep'); }
    playPropInteract(prop: PropType): void { this.playGranular(prop, PROP_SAMPLES[prop], 'prop'); }

    private playGranular(group: SampleGroup, urls: string[], kind: 'footstep' | 'prop'): void {
        if (this.disposed || !this.initialized || !this.eq || !this.filter || !this.analyser) return;

        const now = performance.now();
        let prev = this.memory.get(group) ?? {
            index: Math.floor(this.rng() * urls.length),
            pitch: 0,
            volume: BASE_VOLUME_DB,
            cutoff: 4800,
            grainSize: 0.18,
            overlap: 0.68,
            driftOffset: 0,
            lastMs: -Infinity,
            count: 0,
            playerIndex: 0,
        };

        if (now - prev.lastMs < MIN_RETRIGGER_MS) return;

        const energy = clamp(this.state.energy, 0, 1);
        const weight = clamp(this.state.weight, 0, 1);
        const brightness = clamp(this.state.brightness, 0, 1);
        const tightness = clamp(this.state.tightness, 0, 1);
        const wetness = clamp((this.state as any).wetness ?? 0.35, 0, 1);

        this.globalDrift += 0.0045 + energy * 0.0065;

        const randomBend = this.rng() * 2 - 1;
        const phrase = Math.sin(prev.count * 0.22 + this.globalDrift * 2.3);

        const jumpChance = kind === 'footstep'
            ? clamp(0.14 + energy * 0.26 - tightness * 0.14, 0.07, 0.38)
            : 0.32;

        const nextIndex = this.rng() < jumpChance
            ? Math.floor(this.rng() * urls.length)
            : (prev.index + 1) % urls.length;

        const url = urls[nextIndex];
        const players = this.grainPlayers.get(url);
        if (!players || players.length === 0) return;

        const playerIndex = (prev.playerIndex + 1) % players.length;
        const gp = players[playerIndex];
        if (!gp || !gp.loaded || !gp.buffer) return;

        // === HERZIENE OVERLAP BEREKENING ===
        const timeSinceLast = now - prev.lastMs;
        const isFastTrigger = timeSinceLast < 55;

        const baseOverlap = 0.59;
        const tightnessInfluence = tightness * 0.36;     // meer tightness = meer smooth
        const energyInfluence = energy * 0.26;
        const wetnessInfluence = wetness * 0.24;

        let targetOverlap = baseOverlap + tightnessInfluence + energyInfluence + wetnessInfluence;

        // Dynamische reductie bij snelle triggers (voorkomt moddiness)
        if (isFastTrigger) {
            targetOverlap -= 0.14;
        }

        // Extra reductie bij hoge energy + lage tightness (snelle, lichte stappen)
        if (energy > 0.75 && tightness < 0.4) {
            targetOverlap -= 0.09;
        }

        targetOverlap = clamp(targetOverlap, 0.51, 0.89);

        // === GrainSize (goed afgestemd op overlap) ===
        const targetGrainSize = clamp(
            0.13 + (1 - tightness) * 0.36 + wetness * 0.14 - energy * 0.05,
            0.09,
            0.53
        );

        // === Overige targets ===
        const targetPitch = clamp(
            (energy - 0.5) * 2.4 + (brightness - 0.5) * 1.6 + (wetness - 0.5) * -0.8 +
            phrase * 0.75 + randomBend * 0.65,
            -4.0, 4.0
        );

        const targetVolume = clamp(
            BASE_VOLUME_DB + weight * 3.8 + energy * 2.2 + randomBend * 0.9 - wetness * 2.0,
            -16, 1.5
        );

        const targetCutoff = clamp(1250 + brightness * 4800 + wetness * 950 + energy * 750, 1000, 10200);

        // Smoothing
        const pitch = prev.pitch * 0.74 + targetPitch * 0.26;
        const volume = prev.volume * 0.71 + targetVolume * 0.29;
        const grainSize = prev.grainSize * 0.76 + targetGrainSize * 0.24;
        const overlap = prev.overlap * 0.69 + targetOverlap * 0.31;   // soepele overgang
        const cutoff = prev.cutoff * 0.72 + targetCutoff * 0.28;

        // Spectral Analysis
        const fft = this.analyser.getValue() as Float32Array;
        const low = fft.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
        const mid = fft.slice(14, 42).reduce((a, b) => a + b, 0) / 28;
        const spectralDensity = clamp(low * 1.2 + mid * 0.8 - 3.2, 0, 2.1);

        const adaptiveVolume = volume - spectralDensity * 2.8;

        // Dynamic EQ
        this.eq.high.value = (brightness * 3.5) - 1.8;
        this.eq.low.value = wetness * -4.5;

        if (this.dynamicHigh) {
            this.dynamicHigh.frequency.setTargetAtTime(5200 + brightness * 3400, Tone.now(), 0.11);
            this.dynamicHigh.gain.value = -3.5;
        }

        // Apply parameters
        gp.playbackRate = Math.pow(2, pitch / 12);
        gp.detune = (pitch % 1) * 70;
        gp.grainSize = grainSize;
        gp.overlap = overlap;

        this.filter.frequency.setTargetAtTime(cutoff, Tone.now(), 0.075);
        this.filter.Q.value = 0.55 + tightness * 1.1;

        // Burst
        const burstDuration = clamp(0.20 + energy * 0.35 - tightness * 0.22, 0.16, 0.72);
        const randomOffset = gp.buffer.duration * (0.03 + this.rng() * 0.52);

        if (gp.state === 'started') gp.stop();

        gp.start(Tone.now(), randomOffset);

        gp.volume.cancelScheduledValues(Tone.now());
        gp.volume.setValueAtTime(adaptiveVolume - 12, Tone.now());
        gp.volume.rampTo(adaptiveVolume, 0.022);
        gp.volume.rampTo(adaptiveVolume - 2.8, burstDuration * 0.65);
        gp.volume.rampTo(adaptiveVolume - 8, burstDuration * 0.95);

        this.memory.set(group, {
            index: nextIndex,
            pitch,
            volume: adaptiveVolume,
            cutoff,
            grainSize,
            overlap,
            driftOffset: this.globalDrift,
            lastMs: now,
            count: prev.count + 1,
            playerIndex,
        });
    }

    dispose(): void {
        this.disposed = true;
        this.filter?.dispose();
        this.eq?.dispose();
        this.dynamicHigh?.dispose();
        this.masterComp?.dispose();
        this.analyser?.dispose();

        for (const players of this.grainPlayers.values()) {
            players.forEach(p => p.dispose());
        }
        this.grainPlayers.clear();
        this.memory.clear();
        this.initialized = false;
    }
}