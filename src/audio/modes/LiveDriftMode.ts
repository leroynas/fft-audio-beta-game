/**
 * LiveDriftMode.ts — Mode B: safe adaptive short-sample playback.
 *
 * This version intentionally avoids long loops, granular voices, pooled Tone
 * Players and fallback synths. It uses the same small one-shot sample set as
 * Mode A, but chooses and shapes playback with short-term memory and movement
 * state. The important rule: Mode B must never be able to block the music loop
 * or stall Phaser's frame update.
 */
import * as Tone from 'tone';
import { IAudioMode, seededRandom } from '../AudioManager';
import { PerformerState } from '../PerformerState';
import { FloorType, PropType } from '../../types';

const FOOTSTEP_SAMPLES: Record<FloorType, string[]> = {
    grass: ['/assets/audio/footsteps/wood_01.mp3'],
    sand: ['/assets/audio/footsteps/gravel_01.mp3'],
    water: ['/assets/audio/footsteps/stone_01.mp3'],
    stone: ['/assets/audio/footsteps/stone_01.mp3'],
    wood: ['/assets/audio/footsteps/wood_01.mp3'],
    gravel: ['/assets/audio/footsteps/gravel_01.mp3'],
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
const MIN_RETRIGGER_MS = 52;

function clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
}

function midiToRate(semitones: number): number {
    return Math.pow(2, semitones / 12);
}

type SampleGroup = FloorType | PropType;

export class LiveDriftMode implements IAudioMode {
    private players = new Map<string, Tone.Player>();
    private rng: () => number;
    private initialized = false;
    private disposed = false;
    private memory = new Map<SampleGroup, { index: number; pitch: number; volume: number; brightness: number; lastMs: number; count: number }>();

    constructor(private readonly state: PerformerState, private readonly output: Tone.ToneAudioNode, seed: string) {
        this.rng = seededRandom(seed + '_safe_mode_b_v21');
    }

    async init(): Promise<void> {
        if (this.initialized) return;
        const urls = new Set<string>();
        for (const list of Object.values(FOOTSTEP_SAMPLES)) list.forEach((url) => urls.add(url));
        for (const list of Object.values(PROP_SAMPLES)) list.forEach((url) => urls.add(url));

        const loads: Promise<void>[] = [];
        for (const url of urls) {
            loads.push(new Promise<void>((resolve) => {
                try {
                    const player = new Tone.Player({
                        url,
                        volume: BASE_VOLUME_DB,
                        fadeOut: 0.008,
                        onload: () => {
                            if (!this.disposed) this.players.set(url, player);
                            resolve();
                        },
                        onerror: () => resolve(),
                    });
                    player.connect(this.output);
                } catch {
                    resolve();
                }
            }));
        }

        await Promise.all(loads);
        this.initialized = true;
        console.log(`[LiveDriftMode] Mode B ready — ${this.players.size} short samples loaded`);
    }

    playFootstep(floor: FloorType): void {
        this.playAdaptive(floor, FOOTSTEP_SAMPLES[floor], 'footstep');
    }

    playPropInteract(prop: PropType): void {
        this.playAdaptive(prop, PROP_SAMPLES[prop], 'prop');
    }

    private playAdaptive(group: SampleGroup, urls: string[], kind: 'footstep' | 'prop'): void {
        if (this.disposed || !this.initialized || urls.length === 0) return;

        const now = performance.now();
        const prev = this.memory.get(group) ?? {
            index: Math.floor(this.rng() * urls.length),
            pitch: 0,
            volume: BASE_VOLUME_DB,
            brightness: 0.5,
            lastMs: -Infinity,
            count: 0,
        };
        if (now - prev.lastMs < MIN_RETRIGGER_MS) return;

        const energy = clamp(this.state.energy, 0, 1);
        const weight = clamp(this.state.weight, 0, 1);
        const brightness = clamp(this.state.brightness, 0, 1);
        const continuity = clamp(this.state.tightness, 0, 1);
        const randomBend = (this.rng() * 2 - 1);
        const phrase = Math.sin(prev.count * 0.31 + energy * 2.2);

        // Mode B still changes, but it changes through drift: neighbouring
        // choices and smooth parameter movement instead of hard unrelated jumps.
        const jumpChance = kind === 'footstep'
            ? clamp(0.18 + energy * 0.22 - continuity * 0.10, 0.10, 0.44)
            : 0.36;
        const nextIndex = this.rng() < jumpChance
            ? Math.floor(this.rng() * urls.length)
            : (prev.index + 1) % urls.length;
        const url = urls[nextIndex];
        const player = this.players.get(url);
        if (!player || !player.loaded) return;

        const targetPitch = clamp(
            (energy - 0.45) * 2.1 +
            (brightness - 0.5) * 1.35 +
            phrase * 0.85 +
            randomBend * 0.55,
            -4.2,
            4.2
        );
        const targetVolume = clamp(
            BASE_VOLUME_DB - 2.5 +
            weight * 4.0 +
            energy * 1.4 +
            randomBend * 1.2,
            -10,
            1.5
        );

        const pitch = prev.pitch * 0.52 + targetPitch * 0.48;
        const volume = prev.volume * 0.48 + targetVolume * 0.52;

        try {
            player.playbackRate = midiToRate(pitch);
            player.volume.value = volume;

            // Rewind only this one-shot. This mirrors the stable Mode A path and
            // avoids overlapping long voices or stopping global/music players.
            if (player.state === 'started') player.stop();
            player.start(undefined, 0);
        } catch (err) {
            console.warn('[LiveDriftMode] Ignored one-shot playback race:', err);
        }

        this.memory.set(group, {
            index: nextIndex,
            pitch,
            volume,
            brightness,
            lastMs: now,
            count: prev.count + 1,
        });
    }

    dispose(): void {
        this.disposed = true;
        for (const player of this.players.values()) player.dispose();
        this.players.clear();
        this.memory.clear();
        this.initialized = false;
    }
}
