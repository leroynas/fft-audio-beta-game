/**
 * Player.ts — Top-down player entity with spritesheet walk animations.
 *
 * Expects a spritesheet loaded as 'player' with a 4-row, 3-column layout:
 *   Row 0 (frames 0–2):  Walk DOWN
 *   Row 1 (frames 3–5):  Walk LEFT
 *   Row 2 (frames 6–8):  Walk RIGHT
 *   Row 3 (frames 9–11): Walk UP
 *
 * Frame size is configured via FRAME_WIDTH / FRAME_HEIGHT constants.
 * If your spritesheet uses a different layout or frame count, adjust
 * the ANIM_CONFIG map and the frameWidth/frameHeight in GameScene.preload().
 *
 * Handles WASD + Arrow key input, velocity damping, and exposes
 * currentFloorType for the audio system.
 */
import Phaser from 'phaser';
import { FloorType, FloorZone } from '../types';

/** Movement tuning constants */
const ACCELERATION = 600;
const MAX_SPEED = 200;
const DRAG = 800;

/** Minimum velocity magnitude to count as "moving" */
const MOVING_THRESHOLD = 20;

/** Visual scale applied to the sprite so it reads well in the world */
const PLAYER_SCALE = 1.5;

/** Walk animation frame rate (frames per second) */
const WALK_FRAME_RATE = 8;

/**
 * Animation configuration — maps a direction key to its start/end frames
 * in the spritesheet.  3 columns × 4 rows = 12 frames.
 *
 *   direction  →  row  →  start frame  →  end frame
 *   ────────────────────────────────────────────────
 *   down          0        0               2
 *   left          1        3               5
 *   right         2        6               8
 *   up            3        9              11
 */
const ANIM_CONFIG: Record<string, { start: number; end: number }> = {
    'walk-down':  { start: 0, end: 2 },
    'walk-left':  { start: 3, end: 5 },
    'walk-right': { start: 6, end: 8 },
    'walk-up':    { start: 9, end: 11 },
};

/** First frame per direction — used as idle pose */
const IDLE_FRAMES: Record<string, number> = {
    down:  0,
    left:  3,
    right: 6,
    up:    9,
};

export class Player {
    /** The Phaser physics sprite (spritesheet-based) */
    public sprite: Phaser.Physics.Arcade.Sprite;

    /** Which floor surface the player is currently on */
    public currentFloorType: FloorType = 'stone';

    /** True when the player is moving above the threshold */
    public isMoving = false;

    /** Current physics speed (px/frame) — exposed for PerformerState */
    public speed = 0;

    /** Distance traveled since last footstep trigger (used by audio) */
    public distanceSinceStep = 0;

    private cursors: Phaser.Types.Input.Keyboard.CursorKeys;
    private wasd: {
        W: Phaser.Input.Keyboard.Key;
        A: Phaser.Input.Keyboard.Key;
        S: Phaser.Input.Keyboard.Key;
        D: Phaser.Input.Keyboard.Key;
    };

    private prevX = 0;
    private prevY = 0;

    /** Last facing direction — used to pick the correct idle frame */
    private facing: 'down' | 'left' | 'right' | 'up' = 'down';

    constructor(scene: Phaser.Scene, x: number, y: number) {
        // Create the sprite from the pre-loaded 'player' spritesheet
        this.sprite = scene.physics.add.sprite(x, y, 'player');
        this.sprite.setCollideWorldBounds(true);
        this.sprite.setDrag(DRAG);
        this.sprite.setMaxVelocity(MAX_SPEED);
        this.sprite.setDepth(10);
        this.sprite.setScale(PLAYER_SCALE);

        // Create walk animations (only once — Phaser caches them globally)
        this.createAnimations(scene);

        // Start facing down (idle)
        this.sprite.setFrame(IDLE_FRAMES.down);

        // Input bindings
        this.cursors = scene.input.keyboard!.createCursorKeys();
        this.wasd = {
            W: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            A: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            S: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            D: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        };

        this.prevX = x;
        this.prevY = y;
    }

    /** Register walk animations from the spritesheet (idempotent) */
    private createAnimations(scene: Phaser.Scene): void {
        for (const [key, cfg] of Object.entries(ANIM_CONFIG)) {
            // Skip if already created (avoids warnings on scene restart)
            if (scene.anims.exists(key)) continue;

            scene.anims.create({
                key,
                frames: scene.anims.generateFrameNumbers('player', {
                    start: cfg.start,
                    end: cfg.end,
                }),
                frameRate: WALK_FRAME_RATE,
                repeat: -1, // loop while moving
            });
        }
    }

    /**
     * Call every frame from the scene's update().
     * Reads input, applies acceleration, and tracks distance for footsteps.
     */
    update(floorZones: FloorZone[]): void {
        const body = this.sprite.body as Phaser.Physics.Arcade.Body;

        // --- Input → acceleration ---
        let ax = 0;
        let ay = 0;

        if (this.cursors.left.isDown || this.wasd.A.isDown) ax -= 1;
        if (this.cursors.right.isDown || this.wasd.D.isDown) ax += 1;
        if (this.cursors.up.isDown || this.wasd.W.isDown) ay -= 1;
        if (this.cursors.down.isDown || this.wasd.S.isDown) ay += 1;

        // Normalize diagonal movement
        const len = Math.sqrt(ax * ax + ay * ay);
        if (len > 0) {
            ax = (ax / len) * ACCELERATION;
            ay = (ay / len) * ACCELERATION;
        }

        body.setAcceleration(ax, ay);

        // --- Track movement ---
        this.speed = body.speed;
        this.isMoving = this.speed > MOVING_THRESHOLD;

        // --- Animation: pick direction from velocity, play walk or idle ---
        if (this.isMoving) {
            const vx = body.velocity.x;
            const vy = body.velocity.y;

            // Determine dominant direction (favor vertical for diagonal)
            if (Math.abs(vy) >= Math.abs(vx)) {
                this.facing = vy > 0 ? 'down' : 'up';
            } else {
                this.facing = vx > 0 ? 'right' : 'left';
            }

            // play() with `true` will ignore the call if the same anim is already running
            this.sprite.anims.play(`walk-${this.facing}`, true);
        } else {
            // Idle: stop animation only if one is playing, then show standing frame
            if (this.sprite.anims.isPlaying) {
                this.sprite.anims.stop();
            }
            this.sprite.setFrame(IDLE_FRAMES[this.facing]);
        }

        // Accumulate distance traveled (used to trigger footsteps at intervals)
        const dx = this.sprite.x - this.prevX;
        const dy = this.sprite.y - this.prevY;
        this.distanceSinceStep += Math.sqrt(dx * dx + dy * dy);
        this.prevX = this.sprite.x;
        this.prevY = this.sprite.y;

        // --- Detect current floor zone ---
        this.currentFloorType = this.detectFloor(floorZones);
    }

    /** Reset the footstep distance counter (called by audio after playing a step) */
    resetStepDistance(): void {
        this.distanceSinceStep = 0;
    }

    /** Determine which floor zone the player center falls inside */
    private detectFloor(zones: FloorZone[]): FloorType {
        const px = this.sprite.x;
        const py = this.sprite.y;

        for (const zone of zones) {
            if (
                px >= zone.x &&
                px < zone.x + zone.width &&
                py >= zone.y &&
                py < zone.y + zone.height
            ) {
                return zone.type;
            }
        }

        // Default fallback
        return 'stone';
    }
}
