/**
 * PerformerState.ts — The "virtual performer" that drives Live Drift Mode.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  THESIS CONCEPT: Memory & Drift vs. i.i.d. Random                  │
 * │                                                                     │
 * │  In classic game audio (Mode A) every sound event is independently  │
 * │  and identically distributed — each footstep picks a random sample  │
 * │  with random pitch/vol.  There is no "performer" — no memory of    │
 * │  what came before, no gradual evolution.                            │
 * │                                                                     │
 * │  PerformerState models the internal state of a live FOH performer.  │
 * │  Its five dimensions drift slowly via exponential lerp, responding  │
 * │  to gameplay input (velocity, surface) but never snapping.  This   │
 * │  creates the sensation of ONE continuous performer in ONE session   │
 * │  rather than unrelated disconnected samples.                │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * All properties are normalised 0–1. The lerp factor is deliberately
 * slow (0.02–0.08) so changes feel organic and sub-perceptual —
 * mirroring how a real FOH engineer adjusts knobs gradually.
 */

import { FloorType } from '../types';

// ── Lerp factors (lower = slower drift) ──────────────────────
const LERP_ENERGY     = 0.04;
const LERP_WEIGHT     = 0.03;
const LERP_BRIGHTNESS = 0.02;
const LERP_WETNESS    = 0.025;
const LERP_TIGHTNESS  = 0.06;

/** Max player speed used to normalise velocity → 0-1 energy */
const MAX_PLAYER_SPEED = 200;

/** Surface-specific target offsets — each floor "suggests" a character */
const FLOOR_TARGETS: Record<FloorType, {
    weight: number;
    brightness: number;
    wetness: number;
    tightness: number;
}> = {
    // Outdoor map surfaces
    grass:  { weight: 0.35, brightness: 0.55, wetness: 0.20, tightness: 0.70 },
    sand:   { weight: 0.52, brightness: 0.46, wetness: 0.30, tightness: 0.48 },
    water:  { weight: 0.65, brightness: 0.36, wetness: 0.78, tightness: 0.38 },
    stone:  { weight: 0.80, brightness: 0.30, wetness: 0.65, tightness: 0.55 },

    // Legacy/prototype surfaces
    wood:   { weight: 0.35, brightness: 0.55, wetness: 0.20, tightness: 0.70 },
    gravel: { weight: 0.60, brightness: 0.40, wetness: 0.45, tightness: 0.40 },
};

// ── Helper ───────────────────────────────────────────────────
function lerp(current: number, target: number, factor: number): number {
    return current + (target - current) * factor;
}

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}

// ──────────────────────────────────────────────────────────────
export class PerformerState {
    /**
     * energy: derived from player velocity.
     * High energy → faster playback, tighter timing.
     */
    energy = 0.3;

    /**
     * weight: how "heavy" the impact sounds.
     * Influenced by surface and slightly by energy.
     */
    weight = 0.5;

    /**
     * brightness: high-frequency content / sharpness.
     * Drifts toward the floor's suggestion.
     */
    brightness = 0.5;

    /**
     * wetness: reverb / room dust amount.
     * Stone corridors feel wetter than dry wood floors.
     */
    wetness = 0.3;

    /**
     * tightness: timing precision of the grain window.
     * Loose = lazier, more overlapping grains.
     */
    tightness = 0.5;

    // ── Internal targets (what we're drifting toward) ─────────
    private targetEnergy = 0.3;
    private targetWeight = 0.5;
    private targetBrightness = 0.5;
    private targetWetness = 0.3;
    private targetTightness = 0.5;

    /**
     * Call once per game frame to advance the drift.
     *
     * @param _deltaSec  Frame delta in seconds (unused for now but
     *                   reserved for frame-rate-independent lerp in Phase 4).
     * @param speed      Current player physics speed (px/frame).
     * @param floor      Current floor surface type.
     */
    update(_deltaSec: number, speed: number, floor: FloorType): void {
        // --- Compute target values from gameplay state ---

        // Energy tracks velocity directly (normalised 0–1)
        this.targetEnergy = clamp01(speed / MAX_PLAYER_SPEED);

        // Surface suggests weight, brightness, wetness, tightness
        const ft = FLOOR_TARGETS[floor];
        this.targetWeight     = ft.weight     + this.targetEnergy * 0.15;
        this.targetBrightness = ft.brightness + this.targetEnergy * 0.10;
        this.targetWetness    = ft.wetness    - this.targetEnergy * 0.10;
        this.targetTightness  = ft.tightness  + this.targetEnergy * 0.10;

        // --- Drift current values toward targets ---
        // The slow lerp is the whole point: the state REMEMBERS where it was
        // and only gradually shifts, preventing the jarring randomness of Mode A.
        this.energy     = lerp(this.energy,     this.targetEnergy,     LERP_ENERGY);
        this.weight     = lerp(this.weight,     this.targetWeight,     LERP_WEIGHT);
        this.brightness = lerp(this.brightness, this.targetBrightness, LERP_BRIGHTNESS);
        this.wetness    = lerp(this.wetness,    this.targetWetness,    LERP_WETNESS);
        this.tightness  = lerp(this.tightness,  this.targetTightness,  LERP_TIGHTNESS);

        // Clamp everything to valid range
        this.energy     = clamp01(this.energy);
        this.weight     = clamp01(this.weight);
        this.brightness = clamp01(this.brightness);
        this.wetness    = clamp01(this.wetness);
        this.tightness  = clamp01(this.tightness);
    }
}
