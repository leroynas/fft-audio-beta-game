/**
 * types.ts — Shared type definitions for Live Drift Audio Demo
 */

/** The three floor surface types in the game world */
export type FloorType = 'wood' | 'gravel' | 'stone';

/** Identifiers for interactive props */
export type PropType = 'keys' | 'cloth' | 'barrel' | 'door' | 'building' | 'plant';

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
}
