/**
 * AudioManager.ts — Central audio controller.
 *
 * Owns the PerformerState, AdaptiveMixer, current AudioMode, and a small
 * optional background-music hook. Gameplay is never blocked while audio loads.
 */
import * as Tone from 'tone';
import { AudioMode, FloorType, PlantGrowthStage, PlantVariant, PropType, ToolType } from '../types';
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
const FIXED_SESSION_SEED = 'livedrift-v13';

function generateSeed(): string {
    // Fixed seed for repeatable audio behaviour while testing.
    // Rerolling was removed so Mode A/Mode B comparisons stay stable.
    return FIXED_SESSION_SEED;
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
    grass:  0.16,
    sand:   0.10,
    water:  0.42,
    stone:  0.34,
    wood:   0.15,
    gravel: 0.08,
};
const REVERB_LERP = 0.05; // smooth wet changes over ~0.5s at 60fps

/** Optional background music. Gameplay never waits for this to load. */
const MUSIC_CANDIDATE_URLS = [
    // v13: try the working WAV first so missing/invalid MP3/OGG files do not
    // spam the console before the actual farm music starts.
    '/assets/audio/Music/Mus_Farm.wav',
    '/assets/audio/Music/Mus_Farm.mp3',
    '/assets/audio/Music/Mus_Farm.ogg',
    // Backward-compatible fallbacks in case older test projects still use them.
    '/assets/audio/Music/music.mp3',
    '/assets/audio/Music/Music.mp3',
    '/assets/audio/Music/background.mp3',
    '/assets/audio/Music/background_loop.mp3',
    '/assets/audio/Music/main_theme.mp3',
    '/assets/audio/Music/theme.mp3',
];
const MUSIC_VOLUME_DB = -16;


/**
 * Future plant-growth samples.
 *
 * Add your files here later:
 *   public/assets/audio/plants/vinyl-vine_1.mp3
 *   public/assets/audio/plants/vinyl-vine_2.mp3
 *   public/assets/audio/plants/beat-beet_1.mp3
 *   etc.
 *
 * The code also accepts .ogg and .wav, and both /plants/ and /Plants/ folders.
 * Until those files exist, it falls back to existing stock/demo one-shots.
 */
const PLANT_AUDIO_EXTENSIONS = ['mp3', 'ogg', 'wav'];
const PLANT_STAGE_FALLBACKS: Record<PlantGrowthStage, string[]> = {
    1: ['/assets/audio/props/cloth_01.mp3'],
    2: ['/assets/audio/props/keys_01.mp3'],
    3: ['/assets/audio/props/barrel_01.mp3'],
    4: ['/assets/audio/props/door_01.mp3'],
};
const PLANT_HARVEST_FALLBACKS = [
    '/assets/audio/props/barrel_01.mp3',
    '/assets/audio/props/keys_01.mp3',
];
const PLANT_STAGE_VOLUME_DB = -7;
const PLANT_HARVEST_VOLUME_DB = -4;

type ToolActionType = ToolType | 'harvest';
const TOOL_AUDIO_VOLUME_DB: Record<ToolActionType, number> = {
    pickaxe: -5,
    axe: -5,
    hoe: -6,
    watering_can: -7,
    harvest: -4,
};

const TOOL_ACTION_FALLBACKS: Record<ToolActionType, string[]> = {
    pickaxe: [
        '/assets/audio/tools/pickaxe.mp3',
        '/assets/audio/props/barrel_01.mp3',
        '/assets/audio/footsteps/stone_01.mp3',
    ],
    axe: [
        '/assets/audio/tools/axe.mp3',
        '/assets/audio/props/barrel_01.mp3',
        '/assets/audio/props/door_01.mp3',
    ],
    hoe: [
        '/assets/audio/tools/hoe.mp3',
        '/assets/audio/footsteps/gravel_01.mp3',
        '/assets/audio/footsteps/stone_01.mp3',
    ],
    watering_can: [
        '/assets/audio/tools/watering_can.mp3',
        '/assets/audio/props/cloth_01.mp3',
        '/assets/audio/props/keys_01.mp3',
    ],
    harvest: [
        '/assets/audio/tools/harvest.mp3',
        '/assets/audio/props/keys_01.mp3',
        '/assets/audio/props/cloth_01.mp3',
    ],
};

function plantSlug(variant: PlantVariant): string {
    return variant.replace(/_/g, '-');
}

function plantStageCandidateUrls(variant: PlantVariant, stage: PlantGrowthStage): string[] {
    const slug = plantSlug(variant);
    const snake = variant;
    const urls: string[] = [];

    for (const folder of ['plants', 'Plants']) {
        for (const name of [`${slug}_${stage}`, `${snake}_${stage}`]) {
            for (const ext of PLANT_AUDIO_EXTENSIONS) {
                urls.push(`/assets/audio/${folder}/${name}.${ext}`);
            }
        }
    }

    return urls;
}

function plantHarvestCandidateUrls(variant: PlantVariant): string[] {
    const slug = plantSlug(variant);
    const snake = variant;
    const urls: string[] = [];

    for (const folder of ['plants', 'Plants']) {
        for (const name of [`${slug}_harvest`, `${slug}_5`, `${snake}_harvest`, `${snake}_5`]) {
            for (const ext of PLANT_AUDIO_EXTENSIONS) {
                urls.push(`/assets/audio/${folder}/${name}.${ext}`);
            }
        }
    }

    return urls;
}

function toolActionCandidateUrls(action: ToolActionType): string[] {
    const names = [action, action.replace(/_/g, '-')];
    const urls: string[] = [];

    for (const folder of ['tools', 'Tools']) {
        for (const name of names) {
            for (const ext of PLANT_AUDIO_EXTENSIONS) {
                urls.push(`/assets/audio/${folder}/${name}.${ext}`);
            }
        }
    }

    urls.push(...TOOL_ACTION_FALLBACKS[action]);
    return Array.from(new Set(urls));
}

export class AudioManager {
    private currentMode: IAudioMode;
    private currentModeName: AudioMode = 'classic';

    private performerState = new PerformerState();
    private adaptiveMixer = new AdaptiveMixer();

    private modeBus: Tone.Gain;
    private panner: Tone.Panner;
    private reverb: Tone.Reverb;
    private reverbWet = 0.15;
    private limiter: Tone.Limiter;

    private started = false;
    private lastPropTime = 0;
    private _seed: string;

    /** Start loading Mode A buffers immediately so first input has less audio delay. */
    private currentModeInitPromise: Promise<void> | null = null;

    /** Static music state so the loop can continue across scene switches. */
    private static musicPlayer: Tone.Player | null = null;
    private static musicLoadingPromise: Promise<void> | null = null;

    /** Cached one-shot players for plant-growth and harvest sounds. */
    private plantOneShotPlayers = new Map<string, Tone.Player>();
    private plantCandidateCache = new Map<string, string | null>();

    constructor() {
        this._seed = generateSeed();

        // Create the signal chain: modeBus → panner → reverb → mixer → limiter → dest
        this.modeBus = new Tone.Gain(1);
        this.panner = new Tone.Panner(0);
        this.reverb = new Tone.Reverb({ decay: 2.5, wet: 0.15 });
        this.limiter = new Tone.Limiter(-1);

        this.modeBus.connect(this.panner);
        this.panner.connect(this.reverb);
        this.reverb.connect(this.adaptiveMixer.input);

        this.adaptiveMixer.output.disconnect();
        this.adaptiveMixer.output.connect(this.limiter);
        this.limiter.toDestination();

        this.currentMode = new ClassicMode(this.modeBus, this._seed);
        this.currentModeInitPromise = this.currentMode.init().catch((err) => {
            console.warn('[AudioManager] Initial audio preload failed:', err);
        });
    }

    /** Must be called from a user gesture (click / keypress) to unlock Web Audio */
    async ensureStarted(): Promise<void> {
        if (this.started) return;

        await Tone.start();
        this.started = true;

        // Do not block gameplay on music lookup/loading.
        void this.startMusicLoop();

        if (this.currentModeInitPromise) {
            await this.currentModeInitPromise;
        } else {
            await this.currentMode.init();
        }

        console.log('[AudioManager] Tone.js context started');
    }

    updatePerformer(deltaSec: number, speed: number, floor: FloorType): void {
        this.performerState.update(deltaSec, speed, floor);

        this.adaptiveMixer.footstepsActive = speed > 20;
        this.adaptiveMixer.propActive = (performance.now() - this.lastPropTime) < 400;

        const targetWet = REVERB_WET_TARGETS[floor] ?? 0.15;
        this.reverbWet += (targetWet - this.reverbWet) * REVERB_LERP;
        this.reverb.wet.value = this.reverbWet;

        this.adaptiveMixer.update();
    }

    updatePanning(vx: number, maxSpeed: number): void {
        const pan = Math.max(-0.6, Math.min(0.6, vx / maxSpeed));
        this.panner.pan.value = pan;
    }

    async switchMode(mode: AudioMode): Promise<void> {
        if (mode === this.currentModeName) return;

        this.currentMode.dispose();

        if (mode === 'classic') {
            this.currentMode = new ClassicMode(this.modeBus, this._seed);
        } else {
            this.currentMode = new LiveDriftMode(this.performerState, this.modeBus, this._seed);
        }

        this.currentModeName = mode;
        this.currentModeInitPromise = this.currentMode.init().catch((err) => {
            console.warn(`[AudioManager] Could not init mode ${mode}:`, err);
        });

        if (this.started && this.currentModeInitPromise) {
            await this.currentModeInitPromise;
            void this.startMusicLoop();
        }

        console.log(`[AudioManager] Switched to mode: ${mode}`);
    }

    async newSeed(): Promise<void> {
        // Intentional no-op: the demo now uses one fixed seed so testing stays repeatable.
        console.log(`[AudioManager] Fixed seed retained: ${this._seed}`);
    }

    get seed(): string {
        return this._seed;
    }

    getModeName(): AudioMode {
        return this.currentModeName;
    }

    getMixerSnapshot(): MixerSnapshot {
        return this.adaptiveMixer.getSnapshot();
    }

    playFootstep(floor: FloorType): void {
        if (!this.started) return;
        try {
            this.currentMode.playFootstep(floor);
        } catch (err) {
            console.warn('[AudioManager] Footstep playback failed but gameplay/audio loop will continue:', err);
        }
    }

    playPropInteract(prop: PropType): void {
        if (!this.started) return;
        this.lastPropTime = performance.now();
        try {
            this.currentMode.playPropInteract(prop);
        } catch (err) {
            console.warn('[AudioManager] Prop playback failed but gameplay/audio loop will continue:', err);
        }
    }

    /** Play the sound that belongs to a specific plant entering a growth stage. */
    playPlantGrowthStage(variant: PlantVariant, stage: PlantGrowthStage): void {
        if (!this.started) return;
        this.lastPropTime = performance.now();

        const candidates = [
            ...plantStageCandidateUrls(variant, stage),
            ...PLANT_STAGE_FALLBACKS[stage],
        ];

        void this.playPlantOneShot(
            `plant-stage:${variant}:${stage}`,
            candidates,
            PLANT_STAGE_VOLUME_DB,
            0.92 + stage * 0.035
        );
    }

    /** Play the optional mature-plant harvest sound. */
    playPlantHarvest(variant: PlantVariant): void {
        if (!this.started) return;
        this.lastPropTime = performance.now();

        const candidates = [
            ...plantHarvestCandidateUrls(variant),
            ...PLANT_HARVEST_FALLBACKS,
        ];

        void this.playPlantOneShot(
            `plant-harvest:${variant}`,
            candidates,
            PLANT_HARVEST_VOLUME_DB,
            1
        );
    }

    /** Play a one-shot action sound for tool use, watering and harvesting. */
    playToolAction(action: ToolActionType): void {
        if (!this.started) return;
        this.lastPropTime = performance.now();

        const candidates = toolActionCandidateUrls(action);
        const pitchByAction: Record<ToolActionType, number> = {
            pickaxe: 0.92,
            axe: 0.84,
            hoe: 1.02,
            watering_can: 1.16,
            harvest: 1.0,
        };

        void this.playPlantOneShot(
            `tool-action:${action}`,
            candidates,
            TOOL_AUDIO_VOLUME_DB[action],
            pitchByAction[action]
        );
    }

    private async playPlantOneShot(
        cacheKey: string,
        candidateUrls: string[],
        volumeDb: number,
        playbackRate: number
    ): Promise<void> {
        const url = await this.resolveFirstExistingUrl(cacheKey, candidateUrls);
        if (!url) return;

        let player = this.plantOneShotPlayers.get(url);

        if (!player) {
            player = new Tone.Player({
                url,
                volume: volumeDb,
                onload: () => {
                    if (!this.started) return;
                    player!.playbackRate = playbackRate;
                    player!.volume.value = volumeDb;
                    player!.start();
                },
                onerror: () => {
                    console.warn(`[AudioManager] Could not load one-shot sound: ${url}`);
                    this.plantCandidateCache.set(cacheKey, null);
                },
            });
            player.connect(this.modeBus);
            this.plantOneShotPlayers.set(url, player);
            return;
        }

        if (!player.loaded) return;

        player.playbackRate = playbackRate;
        player.volume.value = volumeDb;
        player.stop();
        player.start();
    }

    private async resolveFirstExistingUrl(cacheKey: string, candidateUrls: string[]): Promise<string | null> {
        if (this.plantCandidateCache.has(cacheKey)) {
            return this.plantCandidateCache.get(cacheKey) ?? null;
        }

        // v13: do not probe every candidate with fetch(HEAD). Browser consoles show
        // those expected misses as scary network failures. The first candidates are
        // the files this patch ships with; if the user later replaces them using the
        // same names, they continue to resolve without extra console noise.
        const first = candidateUrls[0] ?? null;
        this.plantCandidateCache.set(cacheKey, first);
        return first;
    }

    private async startMusicLoop(): Promise<void> {
        if (AudioManager.musicPlayer?.loaded) {
            this.safeStartMusicPlayer();
            return;
        }

        // Multiple scenes can call ensureStarted() during transitions. Reuse the
        // in-flight load instead of calling start() on an unloaded Tone.Player.
        if (AudioManager.musicLoadingPromise) {
            return AudioManager.musicLoadingPromise;
        }

        AudioManager.musicLoadingPromise = this.loadAndStartFirstMusicCandidate()
            .finally(() => {
                AudioManager.musicLoadingPromise = null;
            });

        return AudioManager.musicLoadingPromise;
    }

    private async loadAndStartFirstMusicCandidate(): Promise<void> {
        for (const url of MUSIC_CANDIDATE_URLS) {
            const player = await this.createLoadedMusicPlayer(url);
            if (!player) continue;

            AudioManager.musicPlayer?.dispose();
            AudioManager.musicPlayer = player;
            this.safeStartMusicPlayer();
            console.log(`[AudioManager] Music loop started: ${url}`);
            return;
        }

        console.warn(
            '[AudioManager] No playable music file found. Add a valid Mus_Farm.wav, Mus_Farm.mp3 or Mus_Farm.ogg in public/assets/audio/Music.'
        );
    }

    private createLoadedMusicPlayer(url: string): Promise<Tone.Player | null> {
        return new Promise((resolve) => {
            let settled = false;
            let player: Tone.Player | null = null;

            const finish = (loadedPlayer: Tone.Player | null): void => {
                if (settled) return;
                settled = true;
                resolve(loadedPlayer);
            };

            try {
                player = new Tone.Player({
                    url,
                    loop: true,
                    volume: MUSIC_VOLUME_DB,
                    onload: () => finish(player),
                    onerror: () => {
                        if (!url.endsWith('Mus_Farm.mp3') && !url.endsWith('Mus_Farm.ogg')) {
                            console.warn(`[AudioManager] Music candidate failed, trying next: ${url}`);
                        }
                        player?.dispose();
                        finish(null);
                    },
                }).toDestination();
            } catch (err) {
                console.warn(`[AudioManager] Music player could not be created for ${url}:`, err);
                player?.dispose();
                finish(null);
            }

            window.setTimeout(() => {
                if (settled) return;
                console.warn(`[AudioManager] Music load timed out, trying next candidate: ${url}`);
                player?.dispose();
                finish(null);
            }, 8000);
        });
    }

    private safeStartMusicPlayer(): void {
        const player = AudioManager.musicPlayer;
        if (!player || !player.loaded || player.state === 'started') return;

        try {
            player.start();
        } catch (err) {
            console.warn('[AudioManager] Music player could not be started. It will be skipped instead of crashing the game:', err);
            player.dispose();
            AudioManager.musicPlayer = null;
        }
    }
}
