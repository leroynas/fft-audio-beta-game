/**
 * ClassicMode.ts — Mode A: Classic Random game audio.
 *
 * Each sound event picks a random sample from a set, then applies
 * small random pitch (±3 semitones) and volume (±3 dB) variations.
 * This is the baseline "standard game audio" approach for comparison
 * with Live Drift Mode in Phase 3.
 *
 * Phase 5: Uses seeded PRNG for session-deterministic randomness.
 */
import * as Tone from 'tone';
import { IAudioMode } from '../AudioManager';
import { seededRandom } from '../AudioManager';
import { FloorType, PropType } from '../../types';

// ── Sample path configuration ────────────────────────────────
// Place your .mp3/.wav files under  public/assets/audio/
// Vite serves `public/` at the root, so paths start with `/assets/audio/…`

/** Footstep sample paths per floor type (add more samples for variety) */
const FOOTSTEP_SAMPLES: Record<FloorType, string[]> = {
    wood: [
        '/assets/audio/footsteps/wood_01.mp3',
    ],
    gravel: [
        '/assets/audio/footsteps/gravel_01.mp3',
    ],
    stone: [
        '/assets/audio/footsteps/stone_01.mp3',
    ],
};

/** Prop interaction sample paths (one or more per prop type) */
const PROP_SAMPLES: Record<PropType, string[]> = {
    keys: [
        '/assets/audio/props/keys_01.mp3',
    ],
    cloth: [
        '/assets/audio/props/cloth_01.mp3',
    ],
    barrel: [
        '/assets/audio/props/barrel_01.mp3',
    ],
    door: [
        '/assets/audio/props/door_01.mp3',
    ],
    building: [
        '/assets/audio/props/door_01.mp3',  // reuse door sound for building interaction
    ],
    plant: [
        '/assets/audio/props/keys_01.mp3',
    ],
};

/** Maximum pitch offset in semitones (±) */
const PITCH_RANGE_ST = 3;
/** Maximum volume offset in dB (±) */
const VOLUME_RANGE_DB = 3;

// ──────────────────────────────────────────────────────────────
export class ClassicMode implements IAudioMode {
    /** Cached Tone.Players per sample path — built once on init() */
    private players = new Map<string, Tone.Player>();

    /** Output node — all players route here (shared bus from AudioManager) */
    private output: Tone.ToneAudioNode;

    /** Seeded PRNG for session-deterministic randomness */
    private rng: () => number;

    /** Flag to avoid double-init */
    private initialized = false;

    constructor(output: Tone.ToneAudioNode, seed: string) {
        this.output = output;
        this.rng = seededRandom(seed + '_classic');
    }

    // ── Lifecycle ─────────────────────────────────────────────

    async init(): Promise<void> {
        if (this.initialized) return;

        // Collect every unique sample path
        const allPaths = new Set<string>();
        for (const paths of Object.values(FOOTSTEP_SAMPLES)) paths.forEach((p) => allPaths.add(p));
        for (const paths of Object.values(PROP_SAMPLES)) paths.forEach((p) => allPaths.add(p));

        // Pre-load each sample into a Tone.Player
        const loadPromises: Promise<void>[] = [];

        for (const url of allPaths) {
            const p = new Promise<void>((resolve) => {
                const player = new Tone.Player({
                    url,
                    onload: () => {
                        this.players.set(url, player);
                        resolve();
                    },
                    onerror: () => {
                        // If a sample file is missing we just warn — the game still works
                        console.warn(`[ClassicMode] Could not load sample: ${url}`);
                        resolve();
                    },
                });
                player.connect(this.output);
            });
            loadPromises.push(p);
        }

        await Promise.all(loadPromises);
        this.initialized = true;
        console.log(`[ClassicMode] Loaded ${this.players.size} samples`);
    }

    dispose(): void {
        for (const player of this.players.values()) {
            player.dispose();
        }
        this.players.clear();
        this.initialized = false;
    }

    // ── Sound triggers ────────────────────────────────────────

    playFootstep(floor: FloorType): void {
        const paths = FOOTSTEP_SAMPLES[floor];
        this.playRandomFromSet(paths);
    }

    playPropInteract(prop: PropType): void {
        const paths = PROP_SAMPLES[prop];
        this.playRandomFromSet(paths);
    }

    // ── Internals ─────────────────────────────────────────────

    /**
     * Pick a random sample from the set, apply random pitch & volume
     * variations, and play it.
     */
    private playRandomFromSet(paths: string[]): void {
        if (paths.length === 0) return;

        // Seeded random sample selection
        const url = paths[Math.floor(this.rng() * paths.length)];
        const player = this.players.get(url);
        if (!player || !player.loaded) {
            console.warn('[ClassicMode] Sample not loaded:', url);
            return;
        }

        // Random pitch shift: ±PITCH_RANGE_ST semitones → cents
        const pitchCents = (this.rng() * 2 - 1) * PITCH_RANGE_ST * 100;
        player.playbackRate = Math.pow(2, pitchCents / 1200);

        // Random volume variation: ±VOLUME_RANGE_DB
        const volumeOffset = (this.rng() * 2 - 1) * VOLUME_RANGE_DB;
        player.volume.value = volumeOffset;

        // Play from the start (rewind if already playing)
        player.stop();
        player.start();
    }
}
