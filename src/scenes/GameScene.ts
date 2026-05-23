/**
 * GameScene.ts — The main (and only) gameplay scene.
 *
 * Responsibilities:
 *  - Builds the world: three floor zones, border lines, props
 *  - Creates the Player and follows with camera
 *  - Detects prop proximity and handles E-key interaction
 *  - Triggers footstep audio via AudioManager based on distance traveled
 *  - Manages mode switching (M key)
 *  - Draws HUD via UI utility
 */
import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Prop } from '../entities/Prop';
import { AudioManager } from '../audio/AudioManager';
import { UI } from '../utils/UI';
import { FloorZone, PropConfig } from '../types';

// ── World configuration ──────────────────────────────────────

/** Total world size (pixels) */
const WORLD_W = 2400;
const WORLD_H = 1600;

/**
 * Three floor zones laid out left-to-right.
 * Each zone spans the full height of the world.
 */
const FLOOR_ZONES: FloorZone[] = [
    { x: 0,    y: 0, width: 800,  height: WORLD_H, type: 'wood',   color: 0x8b6c42 },
    { x: 800,  y: 0, width: 800,  height: WORLD_H, type: 'gravel', color: 0x888888 },
    { x: 1600, y: 0, width: 800,  height: WORLD_H, type: 'stone',  color: 0x555555 },
];

/** Four interactive props spread across the world */
const PROPS: PropConfig[] = [
    { x: 650,  y: 800, type: 'door',   label: 'Old Door' },
    { x: 1200, y: 500,  type: 'keys',   label: 'Metal Keys' },
    { x: 1400, y: 760, type: 'barrel', label: 'Barrel' },
    { x: 1800, y: 800,  type: 'cloth',  label: 'Cloth Hanging' },
];
const EXTRA_PROPS: PropConfig[] = [
    { x: 1200, y: 760, type: 'building', label: 'Main-House'},
    { x: 1200, y: 1200, type: 'plant', label: 'Vinyl Vine'},
];

/** Distance (px) the player must walk before the next footstep fires */
const STEP_DISTANCE = 48;

// ──────────────────────────────────────────────────────────────

export class GameScene extends Phaser.Scene {
    private player!: Player;
    private props: Prop[] = [];
    private audioManager!: AudioManager;
    private ui!: UI;
    private keyE!: Phaser.Input.Keyboard.Key;
    private keyM!: Phaser.Input.Keyboard.Key;
    private keyR!: Phaser.Input.Keyboard.Key;
    private audioUnlocked = false;

    constructor() {
        super({ key: 'GameScene' });
    }

    // ── Preload ───────────────────────────────────────────────

    /**
     * Load the player spritesheet.
     *
     * Layout: 4 columns × 4 rows (16 frames total).
     *   Row 0: walk down   (frames 0–3)
     *   Row 1: walk left   (frames 4–7)
     *   Row 2: walk right  (frames 8–11)
     *   Row 3: walk up     (frames 12–15)
     *
     * If your sprite uses a different frame size, change frameWidth/frameHeight.
     */
    preload(): void {
        this.load.spritesheet('player', 'assets/sprites/player_spritesheet.png', {
            frameWidth: 32,
            frameHeight: 32,
        });

        // Floor tile textures
        this.load.image('tile-wood',   '/assets/tiles/wood.jpeg');
        this.load.image('tile-gravel', '/assets/tiles/gravel.jpeg');
        this.load.image('tile-stone',  '/assets/tiles/stone.jpeg');

        this.load.image('object-house', '/assets/objects/Main_House.png');
        this.load.image('plant', '/assets/sprites/plants/vinyl_vine/VinylVine_01_Seed.png');
        this.load.image('plant_stage2', '/assets/sprites/plants/vinyl_vine/VinylVine_02.Sprout.png');
        this.load.image('plant_stage3', '/assets/sprites/plants/vinyl_vine/VinylVine_03.Growing.png');
        this.load.image('plant_stage4', '/assets/sprites/plants/vinyl_vine/VinylVine_04.Mature.png');
    }

    // ── Create ────────────────────────────────────────────────

    create(): void {
        // --- Physics world bounds ---
        this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

        // --- Draw floor zones ---
        this.drawFloorZones();

        // --- Draw grid overlay for spatial reference ---
        this.drawGrid();

        // --- Create props ---
        for (const cfg of [ ...PROPS, ...EXTRA_PROPS ]) {
            const prop = new Prop(this, cfg.x, cfg.y, cfg.type, cfg.label);
            this.props.push(prop);
        }

        // --- Create player at center of the world ---
        this.player = new Player(this, WORLD_W / 2, WORLD_H / 2);

        for (const prop of this.props) {
           if (prop.collider) {
                this.physics.add.collider(
                    this.player.sprite,
                    prop.collider
                );
            }
        }

        // --- Camera: follow player, clamp to world ---
        this.cameras.main.startFollow(this.player.sprite, true, 0.08, 0.08);
        this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);

        // --- Audio ---
        this.audioManager = new AudioManager();

        // Wire up prop interaction sounds
        for (const prop of this.props) {
            prop.onInteract = () => {
                if (prop.type === 'building')
                    this.audioManager.playPropInteract('door');
                if (prop.type === 'plant')
                    this.audioManager.playPropInteract('keys');

                this.audioManager.playPropInteract(prop.type);
            };
        }

        // --- UI overlay ---
        this.ui = new UI(this);

        // --- Input keys ---
        this.keyE = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
        this.keyM = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M);
        this.keyR = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R);

        // --- Unlock audio on first interaction ---
        this.input.keyboard!.on('keydown', () => this.tryUnlockAudio());
        this.input.on('pointerdown', () => this.tryUnlockAudio());
    }

    // ── Update (every frame) ─────────────────────────────────

    update(_time: number, delta: number): void {
        // Player movement + floor detection
        this.player.update(FLOOR_ZONES);

        // Advance the PerformerState drift each frame (drives Mode B)
        const deltaSec = delta / 1000;
        this.audioManager.updatePerformer(
            deltaSec,
            this.player.speed,
            this.player.currentFloorType
        );

        // Update stereo panning based on player horizontal velocity
        const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
        this.audioManager.updatePanning(body.velocity.x, 200);

        // Prop proximity checks + E-key interaction
        for (const prop of this.props) {
            const inRange = prop.updateProximity(
                this.player.sprite.x,
                this.player.sprite.y
            );

            if (inRange && Phaser.Input.Keyboard.JustDown(this.keyE)) {
                prop.interact();
            }
        }

        // Footstep audio: trigger based on distance walked
        if (this.player.isMoving && this.player.distanceSinceStep >= STEP_DISTANCE) {
            this.audioManager.playFootstep(this.player.currentFloorType);
            this.player.resetStepDistance();
        }

        // Mode switch on M press
        if (Phaser.Input.Keyboard.JustDown(this.keyM)) {
            const next = this.audioManager.getModeName() === 'classic' ? 'live' : 'classic';
            this.audioManager.switchMode(next);
        }

        // New session seed on R press
        if (Phaser.Input.Keyboard.JustDown(this.keyR)) {
            this.audioManager.newSeed();
        }

        // Update HUD (including mixer FFT display + seed)
        this.ui.update(
            this.audioManager.getModeName(),
            this.player.currentFloorType,
            this.audioManager.getMixerSnapshot(),
            this.audioManager.seed
        );

        for (const prop of this.props) {
            prop.update(delta);
        }
    }

    // ── World drawing helpers ─────────────────────────────────

    /** Render tiled floor zones using tile images + border lines */
    private drawFloorZones(): void {
        const ZONE_TILES: Record<string, string> = {
            wood:   'tile-wood',
            gravel: 'tile-gravel',
            stone:  'tile-stone',
        };

        const TILE_SCALE = 1;  // shrink large tile images to ~10%

        for (const zone of FLOOR_ZONES) {
            const ts = this.add.tileSprite(
                zone.x, zone.y,
                zone.width, zone.height,
                ZONE_TILES[zone.type]
            );
            ts.setOrigin(0, 0).setDepth(0);
            ts.tileScaleX = TILE_SCALE;
            ts.tileScaleY = TILE_SCALE;
        }

        // Zone borders (bright lines)
        const gfx = this.add.graphics();
        gfx.lineStyle(3, 0xffffff, 0.25);
        for (let i = 1; i < FLOOR_ZONES.length; i++) {
            const z = FLOOR_ZONES[i];
            gfx.lineBetween(z.x, z.y, z.x, z.y + z.height);
        }
        gfx.setDepth(1);

        // Zone labels
        for (const zone of FLOOR_ZONES) {
            this.add.text(zone.x + zone.width / 2, 30, zone.type.toUpperCase(), {
                fontSize: '20px',
                color: '#ffffff',
                fontFamily: 'monospace',
                stroke: '#000000',
                strokeThickness: 3,
            }).setOrigin(0.5).setAlpha(0.5).setDepth(2);
        }
    }

    /** Light reference grid across the whole world */
    private drawGrid(): void {
        const gfx = this.add.graphics();
        gfx.lineStyle(1, 0xffffff, 0.04);
        const step = 200;
        for (let x = 0; x <= WORLD_W; x += step) {
            gfx.lineBetween(x, 0, x, WORLD_H);
        }
        for (let y = 0; y <= WORLD_H; y += step) {
            gfx.lineBetween(0, y, WORLD_W, y);
        }
        gfx.setDepth(0);
    }

    /** Start Tone.js AudioContext on the first user gesture */
    private async tryUnlockAudio(): Promise<void> {
        if (this.audioUnlocked) return;
        this.audioUnlocked = true;
        await this.audioManager.ensureStarted();
    }
}
