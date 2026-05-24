/**
 * types.ts — Shared type definitions for Live Drift Audio Demo
 */

/** The three floor surface types in the game world */
export type FloorType = 'wood' | 'gravel' | 'stone';

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

/** Audio mode identifiers — 'live' is reserved for Phase 3 */
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

