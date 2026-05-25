/**
 * types.ts — Shared type definitions for Live Drift Audio Demo
 */

/**
 * Surfaces in the playable world.
 *
 * grass/sand/water are the current outdoor-map visuals.
 * wood/gravel/stone are kept for the existing demo audio mappings and
 * for older indoor/prototype surfaces.
 */
export type FloorType = 'grass' | 'sand' | 'water' | 'stone' | 'wood' | 'gravel';

/** Identifiers for interactive props */
export type PropType = 'keys' | 'cloth' | 'barrel' | 'door' | 'building' | 'plant';

/** Enterable scene keys for world buildings */
export type EnterableSceneKey = 'HouseScene' | 'StoreScene';

/** Building visual variants available in public/assets/objects */
export type BuildingVariant = 'house' | 'store';

/** Plant visual variants available in public/assets/sprites/Plants/plants */
export type PlantVariant =
    | 'beat_beet'
    | 'crescendo_carrot'
    | 'echo_eggplant'
    | 'melody_melon'
    | 'rhythm_radish'
    | 'treble_turnip'
    | 'vinyl_vine';

/** Plant growth stages. Stage 4 is mature/harvestable. */
export type PlantGrowthStage = 1 | 2 | 3 | 4;

/** Selectable bottom-toolbar tools. */
export type ToolType = 'pickaxe' | 'axe' | 'hoe' | 'watering_can';

/** Audio mode identifiers */
export type AudioMode = 'classic' | 'live';

/** A rectangular zone definition for the game world */
export interface FloorZone {
    x: number;
    y: number;
    width: number;
    height: number;
    type: FloorType;
    color: number;
}

/** Configuration for placing a prop in the world */
export interface PropConfig {
    x: number;
    y: number;
    type: PropType;
    label: string;
    plantVariant?: PlantVariant;
    buildingVariant?: BuildingVariant;
    targetScene?: EnterableSceneKey;
}
