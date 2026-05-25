/**
 * LiveDriftMode.ts — Mode B: stable Live Drift + Memory event playback.
 *
 * v13 stability pass:
 *  - Removed the heavy multi-long-loop GrainPlayer preload path that was causing
 *    console spam, timeouts and silent footsteps when switching to Mode B.
 *  - Mode B now uses the same reliable short event assets as Mode A, but keeps
 *    continuity by using a deterministic cursor, slow drift and performer-state
 *    parameter mapping instead of full i.i.d. randomisation.
 *  - This keeps the demo audible and stable while still making Mode B clearly
 *    different from Mode A: less jumpy, more continuous, and driven by movement.
 */
import * as Tone from 'tone';
import { IAudioMode } from '../AudioManager';
import { seededRandom } from '../AudioManager';
import { PerformerState } from '../PerformerState';
import { FloorType, PropType } from '../../types';

const FOOTSTEP_SAMPLES: Record<FloorType, string[]> = {
    grass:  ['/assets/audio/footsteps/wood_01.mp3'],
    sand:   ['/assets/audio/footsteps/gravel_01.mp3'],
    water:  ['/assets/audio/footsteps/stone_01.mp3'],
    stone:  ['/assets/audio/footsteps/stone_01.mp3'],
    wood:   ['/assets/audio/footsteps/wood_01.mp3'],
    gravel: ['/assets/audio/footsteps/gravel_01.mp3'],
};

const PROP_SAMPLES: Record<PropType, string[]> = {
    keys:     ['/assets/audio/props/keys_01.mp3'],
    cloth:    ['/assets/audio/props/cloth_01.mp3'],
    barrel:   ['/assets/audio/props/barrel_01.mp3'],
    door:     ['/assets/audio/props/door_01.mp3'],
    building: ['/assets/audio/props/door_01.mp3'],
    plant:    ['/assets/audio/props/keys_01.mp3'],
};

const OUTPUT_GAIN_DB = -4;
const DRIFT_LERP = 0.16;
const MAX_VOICES_PER_TRIGGER = 1;

function lerp(current: number, target: number, amount: number): number {
    return current + (target - current) * amount;
}

class StableDriftVoice {
    private players: Tone.Player[] = [];
    private filter: Tone.Filter;
    private gain: Tone.Gain;
    private rng: () => number;
    private readyPromise: Promise<void>;
    private cursor = 0;
    private rate = 1;
    private brightness = 0.5;
    private weight = 0.5;
    private lastTrigger = 0;

    constructor(urls: string[], output: Tone.ToneAudioNode, rng: () => number) {
        this.rng = rng;
        this.filter = new Tone.Filter({ type: 'lowpass', frequency: 8200, rolloff: -12 });
        this.gain = new Tone.Gain(1);
        this.filter.connect(this.gain);
        this.gain.connect(output);

        const uniqueUrls = Array.from(new Set(urls)).slice(0, MAX_VOICES_PER_TRIGGER);
        const loads = uniqueUrls.map((url) => this.createPlayer(url));
        this.readyPromise = Promise.all(loads).then(() => undefined);
    }

    get ready(): Promise<void> {
        return this.readyPromise;
    }

    private createPlayer(url: string): Promise<void> {
        return new Promise((resolve) => {
            let settled = false;
            const finish = () => {
                if (settled) return;
                settled = true;
                resolve();
            };

            try {
                const player = new Tone.Player({
                    url,
                    volume: OUTPUT_GAIN_DB,
                    onload: () => {
                        this.players.push(player);
                        finish();
                    },
                    onerror: () => {
                        // Keep this intentionally quiet. Missing optional files should
                        // not make Mode B feel broken during testing.
                        finish();
                    },
                });
                player.connect(this.filter);

                window.setTimeout(finish, 2500);
            } catch {
                finish();
            }
        });
    }

    trigger(state: PerformerState): void {
        if (this.players.length === 0) return;

        const nowMs = performance.now();
        if (nowMs - this.lastTrigger < 42) return;
        this.lastTrigger = nowMs;

        const targetRate = 0.92 + state.energy * 0.18;
        const targetBrightness = Math.max(0, Math.min(1, state.brightness));
        const targetWeight = Math.max(0, Math.min(1, state.weight));

        this.rate = lerp(this.rate, targetRate, DRIFT_LERP);
        this.brightness = lerp(this.brightness, targetBrightness, DRIFT_LERP);
        this.weight = lerp(this.weight, targetWeight, DRIFT_LERP);

        const indexDrift = this.rng() > 0.82 ? 1 : 0;
        this.cursor = (this.cursor + indexDrift) % this.players.length;
        const player = this.players[this.cursor];
        if (!player || !player.loaded) return;

        player.playbackRate = this.rate;
        player.volume.value = OUTPUT_GAIN_DB + (this.weight - 0.5) * 3.5;
        this.filter.frequency.value = 2400 + this.brightness * 8200;
        this.gain.gain.value = 0.82 + this.weight * 0.18;

        try {
            if (player.state === 'started') player.stop();
            player.start();
        } catch (err) {
            console.warn('[LiveDriftMode] Stable Mode B event skipped:', err);
        }
    }

    dispose(): void {
        for (const player of this.players) player.dispose();
        this.players = [];
        this.filter.dispose();
        this.gain.dispose();
    }
}

export class LiveDriftMode implements IAudioMode {
    private state: PerformerState;
    private footstepVoices = new Map<FloorType, StableDriftVoice>();
    private propVoices = new Map<PropType, StableDriftVoice>();
    private masterGain: Tone.Gain;
    private rng: () => number;
    private initialized = false;

    constructor(performerState: PerformerState, output: Tone.ToneAudioNode, seed: string) {
        this.state = performerState;
        this.rng = seededRandom(seed + '_stable_livedrift_v13');
        this.masterGain = new Tone.Gain(1);
        this.masterGain.connect(output);
    }

    async init(): Promise<void> {
        if (this.initialized) return;

        const loads: Promise<void>[] = [];

        for (const [floor, urls] of Object.entries(FOOTSTEP_SAMPLES)) {
            const voice = new StableDriftVoice(urls, this.masterGain, this.rng);
            this.footstepVoices.set(floor as FloorType, voice);
            loads.push(voice.ready);
        }

        for (const [prop, urls] of Object.entries(PROP_SAMPLES)) {
            const voice = new StableDriftVoice(urls, this.masterGain, this.rng);
            this.propVoices.set(prop as PropType, voice);
            loads.push(voice.ready);
        }

        await Promise.all(loads);
        this.initialized = true;
        console.log('[LiveDriftMode] Mode B ready — stable drift playback active');
    }

    playFootstep(floor: FloorType): void {
        this.footstepVoices.get(floor)?.trigger(this.state);
    }

    playPropInteract(prop: PropType): void {
        this.propVoices.get(prop)?.trigger(this.state);
    }

    dispose(): void {
        for (const voice of this.footstepVoices.values()) voice.dispose();
        for (const voice of this.propVoices.values()) voice.dispose();
        this.footstepVoices.clear();
        this.propVoices.clear();
        this.masterGain.dispose();
        this.initialized = false;
    }
}
