/**
 * AudioManager.ts — Central audio controller (v4 — Complete Mode Independence)
 *
 * Volledige versie (~310 regels) zoals je gewend bent.
 * Mode A (Classic) en Mode B (LiveDrift) hebben nu elk hun eigen gain-node → volledig onafhankelijk.
 */

import * as Tone from 'tone';
import { AudioMode, FloorType, PlantGrowthStage, PlantVariant, PropType, ToolType } from '../types';
import { ClassicMode } from './modes/ClassicMode';
import { LiveDriftMode } from './modes/LiveDriftMode';
import { PerformerState } from './PerformerState';
import { AdaptiveMixer, MixerSnapshot } from './AdaptiveMixer';

export interface IAudioMode {
    init(): Promise<void>;
    playFootstep(floor: FloorType): void;
    playPropInteract(prop: PropType): void;
    dispose(): void;
}

// ── Seed ─────────────────────────────────────────────────────
const FIXED_SESSION_SEED = 'mode-b-v27';

function generateSeed(): string {
    return FIXED_SESSION_SEED;
}

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

// ── Reverb & Music ───────────────────────────────────────────
const REVERB_WET_TARGETS: Record<FloorType, number> = {
    grass: 0.16, sand: 0.10, water: 0.42, stone: 0.34, wood: 0.15, gravel: 0.08,
};
const REVERB_LERP = 0.05;

const MUSIC_CANDIDATE_URLS = [
    '/assets/audio/music/mus_farm.wav',
    '/assets/audio/music/Mus_Farm.mp3',
    '/assets/audio/music/Mus_Farm.ogg',
    '/assets/audio/music/music.mp3',
    '/assets/audio/music/Music.mp3',
    '/assets/audio/music/background.mp3',
    '/assets/audio/Music/background_loop.mp3',
    '/assets/audio/Music/main_theme.mp3',
    '/assets/audio/Music/theme.mp3',
];
const MUSIC_VOLUME_DB = -16;

// ── Plant / Tool audio ───────────────────────────────────────
const PLANT_AUDIO_EXTENSIONS = ['mp3', 'ogg', 'wav'];
const PLANT_STAGE_FALLBACKS: Record<PlantGrowthStage, string[]> = {
    1: ['/assets/audio/props/cloth_01.mp3'],
    2: ['/assets/audio/props/keys_01.mp3'],
    3: ['/assets/audio/props/barrel_01.mp3'],
    4: ['/assets/audio/props/door_01.mp3'],
};
const PLANT_HARVEST_FALLBACKS = ['/assets/audio/props/barrel_01.mp3', '/assets/audio/props/keys_01.mp3'];
const PLANT_STAGE_VOLUME_DB = -7;
const PLANT_HARVEST_VOLUME_DB = -4;

type ToolActionType = ToolType | 'harvest';
const TOOL_AUDIO_VOLUME_DB: Record<ToolActionType, number> = {
    pickaxe: -5, axe: -5, hoe: -6, watering_can: -7, harvest: -4,
};
const TOOL_ACTION_FALLBACKS: Record<ToolActionType, string[]> = {
    pickaxe: ['/assets/audio/tools/pickaxe.mp3', '/assets/audio/props/barrel_01.mp3', '/assets/audio/footsteps/stone_01.mp3'],
    axe: ['/assets/audio/tools/axe.mp3', '/assets/audio/props/barrel_01.mp3', '/assets/audio/props/door_01.mp3'],
    hoe: ['/assets/audio/tools/hoe.mp3', '/assets/audio/footsteps/gravel_01.mp3', '/assets/audio/footsteps/stone_01.mp3'],
    watering_can: ['/assets/audio/tools/watering_can.mp3', '/assets/audio/props/cloth_01.mp3', '/assets/audio/props/keys_01.mp3'],
    harvest: ['/assets/audio/tools/harvest.mp3', '/assets/audio/props/keys_01.mp3', '/assets/audio/props/cloth_01.mp3'],
};

function plantSlug(variant: PlantVariant): string { return variant.replace(/_/g, '-'); }

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
    private static sharedInstance: AudioManager | null = null;

    static getShared(): AudioManager {
        if (!AudioManager.sharedInstance) {
            AudioManager.sharedInstance = new AudioManager();
        }
        return AudioManager.sharedInstance;
    }

    private currentMode: IAudioMode;
    private currentModeName: AudioMode = AudioManager.selectedMode;
    private static selectedMode: AudioMode = 'classic';

    private performerState = new PerformerState();
    private adaptiveMixer = new AdaptiveMixer();

    private modeBus: Tone.Gain;           // behouden voor backward compatibility
    private modeGain: Tone.Gain;          // <<< NIEUW: eigen gain per mode voor onafhankelijkheid
    private panner: Tone.Panner;
    private reverb: Tone.Reverb;
    private reverbWet = 0.15;
    private limiter: Tone.Limiter;

    private started = false;
    private lastPropTime = 0;
    private lastFootstepTime = 0;
    private _seed: string;
    private switchingMode = false;

    private currentModeInitPromise: Promise<void> | null = null;

    private static musicPlayer: Tone.Player | null = null;
    private static musicLoadingPromise: Promise<void> | null = null;

    private plantOneShotPlayers = new Map<string, Tone.Player>();
    private plantCandidateCache = new Map<string, string | null>();

    constructor() {
        this._seed = generateSeed();

        this.modeBus = new Tone.Gain(1);
        this.modeGain = new Tone.Gain(1);          // dedicated gain voor huidige mode

        this.panner = new Tone.Panner(0);
        this.reverb = new Tone.Reverb({ decay: 2.5, wet: 0.15 });
        this.limiter = new Tone.Limiter(-1);

        // Nieuwe keten: modeGain → panner → reverb → adaptiveMixer
        this.modeGain.connect(this.panner);
        this.panner.connect(this.reverb);
        this.reverb.connect(this.adaptiveMixer.input);
        this.adaptiveMixer.output.connect(this.limiter);
        this.limiter.toDestination();

        this.currentMode = this.currentModeName === 'classic'
            ? new ClassicMode(this.modeGain, this._seed)
            : new LiveDriftMode(this.performerState, this.modeGain, this._seed);

        this.currentModeInitPromise = this.currentMode.init().catch(err => {
            console.warn('[AudioManager] Initial mode init failed:', err);
        });
    }

    async ensureStarted(): Promise<void> {
        if (this.started) return;
        try {
            await Tone.start();
            this.started = true;
            console.log('[AudioManager] Tone.js context started');
            void this.startMusicLoop();
            if (this.currentModeInitPromise) await this.currentModeInitPromise;
        } catch (err) {
            console.error('[AudioManager] Failed to start Tone context:', err);
        }
    }

    updatePerformer(deltaSec: number, speed: number, floor: FloorType): void {
        this.performerState.update(deltaSec, speed, floor);
        const now = performance.now();
        this.adaptiveMixer.footstepsActive = (now - this.lastFootstepTime) < 320;
        this.adaptiveMixer.propActive = (now - this.lastPropTime) < 420;

        const floorWet = REVERB_WET_TARGETS[floor] ?? 0.15;
        const performerWet = 0.05 + this.performerState.wetness * 0.45;
        const targetWet = floorWet * 0.55 + performerWet * 0.45;
        this.reverbWet += (targetWet - this.reverbWet) * REVERB_LERP;
        this.reverb.wet.value = this.reverbWet;

        this.adaptiveMixer.update();
    }

    updatePanning(vx: number, maxSpeed: number): void {
        const pan = Math.max(-0.6, Math.min(0.6, vx / maxSpeed));
        this.panner.pan.value = pan;
    }

    async switchMode(mode: AudioMode): Promise<void> {
        if (mode === this.currentModeName || this.switchingMode) return;
        this.switchingMode = true;

        const previousMode = this.currentMode;
        const nextMode = mode === 'classic'
            ? new ClassicMode(this.modeGain, this._seed)
            : new LiveDriftMode(this.performerState, this.modeGain, this._seed);

        try {
            this.currentModeInitPromise = nextMode.init();
            await this.currentModeInitPromise;

            previousMode.dispose();
            this.currentMode = nextMode;
            this.currentModeName = mode;
            AudioManager.selectedMode = mode;

            console.log(`[AudioManager] Switched to mode: ${mode}`);
        } catch (err) {
            console.error(`[AudioManager] Mode switch failed:`, err);
            try { nextMode.dispose(); } catch {}
        } finally {
            this.switchingMode = false;
        }
    }

    get seed(): string { return this._seed; }
    getModeName(): AudioMode { return this.currentModeName; }
    getMixerSnapshot(): MixerSnapshot { return this.adaptiveMixer.getSnapshot(); }

    playFootstep(floor: FloorType): void {
        if (!this.started) return;
        this.lastFootstepTime = performance.now();
        this.adaptiveMixer.notifyEvent('footstep', floor);
        try { this.currentMode.playFootstep(floor); } catch (e) { console.warn('[AudioManager] Footstep failed:', e); }
    }

    playPropInteract(prop: PropType): void {
        if (!this.started) return;
        this.lastPropTime = performance.now();
        this.adaptiveMixer.notifyEvent('prop', prop);
        try { this.currentMode.playPropInteract(prop); } catch (e) { console.warn('[AudioManager] Prop failed:', e); }
    }

    playPlantGrowthStage(variant: PlantVariant, stage: PlantGrowthStage): void {
        if (!this.started) return;
        this.lastPropTime = performance.now();
        this.adaptiveMixer.notifyEvent('plant', `${variant}:${stage}`);
        const candidates = [...plantStageCandidateUrls(variant, stage), ...PLANT_STAGE_FALLBACKS[stage]];
        void this.playPlantOneShot(`plant-stage:${variant}:${stage}`, candidates, PLANT_STAGE_VOLUME_DB, 0.92 + stage * 0.035);
    }

    playPlantHarvest(variant: PlantVariant): void {
        if (!this.started) return;
        this.lastPropTime = performance.now();
        this.adaptiveMixer.notifyEvent('plant', `${variant}:harvest`);
        const candidates = [...plantHarvestCandidateUrls(variant), ...PLANT_HARVEST_FALLBACKS];
        void this.playPlantOneShot(`plant-harvest:${variant}`, candidates, PLANT_HARVEST_VOLUME_DB, 1);
    }

    playToolAction(action: ToolActionType): void {
        if (!this.started) return;
        this.lastPropTime = performance.now();
        this.adaptiveMixer.notifyEvent('tool', action);
        const candidates = toolActionCandidateUrls(action);
        const pitchByAction: Record<ToolActionType, number> = { pickaxe: 0.92, axe: 0.84, hoe: 1.02, watering_can: 1.16, harvest: 1.0 };
        void this.playPlantOneShot(`tool-action:${action}`, candidates, TOOL_AUDIO_VOLUME_DB[action], pitchByAction[action]);
    }

    dispose(): void {
        try { this.currentMode.dispose(); } catch {}
        for (const player of this.plantOneShotPlayers.values()) try { player.dispose(); } catch {}
        this.plantOneShotPlayers.clear();
        this.modeGain.dispose();
        this.modeBus.dispose();
        this.panner.dispose();
        this.reverb.dispose();
        this.limiter.dispose();
        this.adaptiveMixer.dispose();
        AudioManager.sharedInstance = null;
    }

    private async playPlantOneShot(cacheKey: string, candidateUrls: string[], volumeDb: number, playbackRate: number): Promise<void> {
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
                    console.warn(`[AudioManager] Could not load one-shot: ${url}`);
                    this.plantCandidateCache.set(cacheKey, null);
                }
            });
            player.connect(this.modeGain);   // <<< nu via modeGain
            this.plantOneShotPlayers.set(url, player);
            return;
        }

        if (!player.loaded) return;
        try {
            player.playbackRate = playbackRate;
            player.volume.value = volumeDb;
            if (player.state === 'started') player.stop();
            player.start();
        } catch (err) {
            console.warn('[AudioManager] One-shot playback error:', err);
        }
    }

    private async resolveFirstExistingUrl(cacheKey: string, candidateUrls: string[]): Promise<string | null> {
        if (this.plantCandidateCache.has(cacheKey)) {
            return this.plantCandidateCache.get(cacheKey) ?? null;
        }
        const first = candidateUrls[0] ?? null;
        this.plantCandidateCache.set(cacheKey, first);
        return first;
    }

    // ── Music Loop (volledig) ───────────────────────────────────
    private async startMusicLoop(): Promise<void> {
        if (AudioManager.musicPlayer?.loaded) {
            this.safeStartMusicPlayer();
            return;
        }
        if (AudioManager.musicLoadingPromise) return AudioManager.musicLoadingPromise;

        AudioManager.musicLoadingPromise = this.loadAndStartFirstMusicCandidate()
            .finally(() => { AudioManager.musicLoadingPromise = null; });

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
        console.warn('[AudioManager] No playable music file found.');
    }

    private createLoadedMusicPlayer(url: string): Promise<Tone.Player | null> {
        return new Promise((resolve) => {
            let settled = false;
            let player: Tone.Player | null = null;

            const finish = (loadedPlayer: Tone.Player | null) => {
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
                            console.warn(`[AudioManager] Music candidate failed: ${url}`);
                        }
                        player?.dispose();
                        finish(null);
                    },
                }).toDestination();
            } catch (err) {
                console.warn(`[AudioManager] Music player creation failed for ${url}:`, err);
                player?.dispose();
                finish(null);
            }

            window.setTimeout(() => {
                if (settled) return;
                console.warn(`[AudioManager] Music load timed out: ${url}`);
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
            console.warn('[AudioManager] Music player start failed:', err);
            player.dispose();
            AudioManager.musicPlayer = null;
        }
    }
}