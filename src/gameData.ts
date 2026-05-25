/**
 * gameData.ts — tiny shared state for the farming/shop loop.
 *
 * v15:
 *  - Fresh browser sessions start with empty planters and 50 coins unless
 *    the user explicitly presses Save Progress.
 *  - Planting consumes one owned seed; crops only start growing after watering.
 */
import { PlantGrowthStage, PlantVariant } from './types';

export interface SeedDefinition {
    variant: PlantVariant;
    cropName: string;
    seedName: string;
    price: number;
}

export const SEED_CATALOG: SeedDefinition[] = [
    { variant: 'beat_beet',        cropName: 'Beat Beet',        seedName: 'Beat Beet Seeds',        price: 12 },
    { variant: 'crescendo_carrot', cropName: 'Crescendo Carrot', seedName: 'Crescendo Carrot Seeds', price: 10 },
    { variant: 'echo_eggplant',    cropName: 'Echo Eggplant',    seedName: 'Echo Eggplant Seeds',    price: 14 },
    { variant: 'melody_melon',     cropName: 'Melody Melon',     seedName: 'Melody Melon Seeds',     price: 18 },
    { variant: 'rhythm_radish',    cropName: 'Rhythm Radish',    seedName: 'Rhythm Radish Seeds',    price: 11 },
    { variant: 'treble_turnip',    cropName: 'Treble Turnip',    seedName: 'Treble Turnip Seeds',    price: 13 },
    { variant: 'vinyl_vine',       cropName: 'Vinyl Vine',       seedName: 'Vinyl Vine Seeds',       price: 16 },
];

const MANUAL_SAVE_KEY = 'fft_stardew_manual_save_v17';

export interface PlantSessionState {
    /** Empty planters have isPlanted=false and no visible crop. */
    isPlanted?: boolean;

    /** The actual seed/crop planted in this specific planter. */
    plantedVariant?: PlantVariant;

    /** Growth stage for planted crops. Stage 4 is mature/harvestable. */
    stage: PlantGrowthStage;

    /** Growth timer only advances after the crop has been watered. */
    elapsedMs: number;

    /** True after the first watering; false crops stay as seeds. */
    watered?: boolean;

    harvested?: boolean;
}

interface FarmStateSnapshot {
    coins: number;
    seeds: Record<PlantVariant, number>;
    harvests: Record<PlantVariant, number>;
    plants: Record<string, PlantSessionState>;
    savedAt?: number;
}

function emptyVariantRecord(defaultValue = 0): Record<PlantVariant, number> {
    return {
        beat_beet: defaultValue,
        crescendo_carrot: defaultValue,
        echo_eggplant: defaultValue,
        melody_melon: defaultValue,
        rhythm_radish: defaultValue,
        treble_turnip: defaultValue,
        vinyl_vine: defaultValue,
    };
}

function createNewState(): FarmStateSnapshot {
    return {
        coins: 50,
        seeds: emptyVariantRecord(0),
        harvests: emptyVariantRecord(0),
        plants: {},
    };
}

class FarmStateStore {
    private state: FarmStateSnapshot = createNewState();
    private savedThisSession = false;

    constructor() {
        this.loadManualSave();
    }

    get coins(): number {
        return this.state.coins;
    }

    get hasManualSave(): boolean {
        try {
            return typeof localStorage !== 'undefined' && localStorage.getItem(MANUAL_SAVE_KEY) !== null;
        } catch {
            return false;
        }
    }

    get wasSavedThisSession(): boolean {
        return this.savedThisSession;
    }

    getSeedCount(variant: PlantVariant): number {
        return this.state.seeds[variant] ?? 0;
    }

    getHarvestCount(variant: PlantVariant): number {
        return this.state.harvests[variant] ?? 0;
    }

    buySeed(variant: PlantVariant, amount = 1): { ok: boolean; message: string } {
        const item = SEED_CATALOG.find((entry) => entry.variant === variant);
        if (!item) return { ok: false, message: 'Seed is not in the catalog yet.' };

        const total = item.price * amount;
        if (this.state.coins < total) {
            return { ok: false, message: `Not enough coins for ${item.seedName}.` };
        }

        this.state.coins -= total;
        this.state.seeds[variant] = (this.state.seeds[variant] ?? 0) + amount;

        return {
            ok: true,
            message: `Bought ${amount}× ${item.seedName}. Save progress to keep it after refresh.`,
        };
    }

    addHarvest(variant: PlantVariant, amount = 1): void {
        this.state.harvests[variant] = (this.state.harvests[variant] ?? 0) + amount;
    }

    getFirstOwnedSeedVariant(): PlantVariant | undefined {
        return SEED_CATALOG.find((entry) => (this.state.seeds[entry.variant] ?? 0) > 0)?.variant;
    }

    consumeSeed(variant: PlantVariant, amount = 1): boolean {
        const current = this.state.seeds[variant] ?? 0;
        if (current < amount) return false;
        this.state.seeds[variant] = current - amount;
        return true;
    }

    consumeFirstOwnedSeed(): PlantVariant | undefined {
        const variant = this.getFirstOwnedSeedVariant();
        if (!variant) return undefined;
        return this.consumeSeed(variant) ? variant : undefined;
    }

    getPlantState(id: string): PlantSessionState | undefined {
        const state = this.state.plants[id];
        return state ? { ...state } : undefined;
    }

    setPlantState(id: string, state: PlantSessionState): void {
        this.state.plants[id] = { ...state };
    }

    markPlantHarvested(id: string): void {
        const current = this.state.plants[id];

        this.state.plants[id] = {
            ...current,
            isPlanted: false,
            plantedVariant: undefined,
            stage: 1,
            elapsedMs: 0,
            watered: false,
            harvested: false,
        };
    }

    saveProgress(): void {
        try {
            const snapshot = {
                ...this.snapshot(),
                savedAt: Date.now(),
            };

            localStorage.setItem(MANUAL_SAVE_KEY, JSON.stringify(snapshot));
            this.savedThisSession = true;
        } catch (err) {
            console.warn('[FarmState] Could not save manual progress:', err);
        }
    }

    resetProgress(): void {
        this.state = createNewState();
        this.savedThisSession = false;

        try {
            localStorage.removeItem(MANUAL_SAVE_KEY);
        } catch (err) {
            console.warn('[FarmState] Could not clear manual save:', err);
        }
    }

    snapshot(): FarmStateSnapshot {
        return {
            coins: this.state.coins,
            seeds: { ...this.state.seeds },
            harvests: { ...this.state.harvests },
            plants: { ...this.state.plants },
            savedAt: this.state.savedAt,
        };
    }

    private loadManualSave(): void {
        try {
            const raw = localStorage.getItem(MANUAL_SAVE_KEY);
            if (!raw) return;

            const parsed = JSON.parse(raw) as Partial<FarmStateSnapshot>;

            this.state = {
                coins: typeof parsed.coins === 'number' ? parsed.coins : 50,
                seeds: { ...emptyVariantRecord(0), ...(parsed.seeds ?? {}) },
                harvests: { ...emptyVariantRecord(0), ...(parsed.harvests ?? {}) },
                plants: { ...(parsed.plants ?? {}) },
                savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : undefined,
            };
        } catch (err) {
            console.warn('[FarmState] Could not load manual save, starting fresh:', err);
            this.state = createNewState();
        }
    }
}

export const FarmState = new FarmStateStore();