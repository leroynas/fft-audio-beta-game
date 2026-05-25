/**
 * GameScene.ts — Main outdoor farm map.
 *
 * Changes in this version:
 *  - Wider village world.
 *  - Houses and placeholder buildings are spread across the full map.
 *  - Clean stone road grid connects the village rows.
 *  - Stone roads stop before the beach, so the sand/water transition stays clean.
 *  - Main house, store and planters remain central enough for gameplay.
 *  - Planter plot keeps one seamless stone base around and between planters.
 *  - Plant sprites are vertically aligned to their planter beds.
 */
import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { Prop } from '../entities/Prop';
import { AudioManager } from '../audio/AudioManager';
import { UI } from '../utils/UI';
import { FloorZone, PlantVariant, PropConfig, ToolType } from '../types';
import { FarmState } from '../gameData';
import { extensionCandidates, loadFirstAvailableImageTexture } from '../utils/TextureResolver';

// ── World configuration ──────────────────────────────────────

/**
 * Wider outdoor map so the village can breathe.
 * The playable grass area is intentionally large before the beach starts.
 */
const WORLD_W = 4200;
const WORLD_H = 2400;

const HOUSE_X = 1050;
const HOUSE_Y = 560;

const STORE_X = 480;
const STORE_Y = 560;

const BEACH_PATH_X = HOUSE_X;
const PLANT_AREA_X = Math.round((STORE_X + HOUSE_X) / 2);

// One consistent stone-path width.
const PATH_W = 56;

// Main village road rows.
// These rows stay in grass and are used for building-front alignment.
const NORTH_ROW_PATH_Y = 220;
const MAIN_PATH_Y = HOUSE_Y;
const SOUTH_ROW_PATH_Y = 1120;
const LOWER_FIELD_PATH_Y = 1480;

// Vertical village road columns.
// These spread the houses over the full width of the map.
const WEST_VILLAGE_PATH_X = 260;
const MID_VILLAGE_PATH_X = 1580;
const EAST_VILLAGE_PATH_X = 2860;
const FAR_VILLAGE_PATH_X = 3920;

// Useful map boundaries.
const ROAD_LEFT = 150;
const ROAD_RIGHT = WORLD_W - 150;

const PLANT_COLUMN_SPACING = 118;
const PLANT_ROW_SPACING = 120;
const PLANT_ROW_Y1 = HOUSE_Y + 205;
const PLANT_ROW_Y2 = PLANT_ROW_Y1 + PLANT_ROW_SPACING;

// Small planter artwork uses a centre point; plant sprites use a bottom anchor.
// Keep these separate so plants sit on the planter soil instead of floating
// above the beds.
const PLANT_BED_Y_OFFSET = 20;
const PLANT_SPRITE_Y_OFFSET = PLANT_BED_Y_OFFSET;

// One clean stone base under the planter area. This removes broken-looking
// mini path pieces and gives every planter a walkable stone border.
const PLANT_BED_W = 62;
const PLANT_BED_H = 58;
const PLANT_STONE_MARGIN = PATH_W;
const PLANT_GRID_LEFT = PLANT_AREA_X - PLANT_COLUMN_SPACING - PLANT_BED_W / 2 - PLANT_STONE_MARGIN;
const PLANT_GRID_RIGHT = PLANT_AREA_X + PLANT_COLUMN_SPACING + PLANT_BED_W / 2 + PLANT_STONE_MARGIN;
const PLANT_GRID_BOTTOM = PLANT_ROW_Y2 + PLANT_BED_Y_OFFSET + PLANT_BED_H / 2 + PLANT_STONE_MARGIN;

const GRASS_END_Y = 1580;
const SAND_END_Y = 1880;
const WATER_START_Y = SAND_END_Y;

const PLAYER_START_X = HOUSE_X;
const PLAYER_START_Y = MAIN_PATH_Y + PATH_W / 2;

const SHOW_DEBUG_GRID = false;

const DEFAULT_TOOL: ToolType = 'hoe';
const TOOL_ORDER: ToolType[] = ['pickaxe', 'axe', 'hoe', 'watering_can'];
const TOOL_HOTKEYS: { keyCode: number; tool: ToolType }[] = [
    { keyCode: Phaser.Input.Keyboard.KeyCodes.ONE,   tool: 'pickaxe' },
    { keyCode: Phaser.Input.Keyboard.KeyCodes.TWO,   tool: 'axe' },
    { keyCode: Phaser.Input.Keyboard.KeyCodes.THREE, tool: 'hoe' },
    { keyCode: Phaser.Input.Keyboard.KeyCodes.FOUR,  tool: 'watering_can' },
];

/** Base world layers: grass → sand → water when walking downward. */
const BASE_FLOOR_ZONES: FloorZone[] = [
    { x: 0, y: 0,             width: WORLD_W, height: GRASS_END_Y, type: 'grass', color: 0x4c5f38 },
    { x: 0, y: GRASS_END_Y,   width: WORLD_W, height: SAND_END_Y - GRASS_END_Y, type: 'sand', color: 0xd6be7f },
    { x: 0, y: WATER_START_Y, width: WORLD_W, height: WORLD_H - WATER_START_Y, type: 'water', color: 0x3c9aaa },
];

/**
 * Stone path overlays.
 * These are checked before base zones for footstep logic.
 *
 * The road network is intentionally simple:
 *  - 4 horizontal village roads.
 *  - 4 vertical village roads.
 *  - A local planter stone base.
 *  - No stone road continues into the beach.
 */
const PATH_ZONES: FloorZone[] = [
    // Northern village road.
    {
        x: ROAD_LEFT,
        y: NORTH_ROW_PATH_Y,
        width: ROAD_RIGHT - ROAD_LEFT,
        height: PATH_W,
        type: 'stone',
        color: 0x8a8272,
    },

    // Main road: store, house and central village access.
    {
        x: ROAD_LEFT,
        y: MAIN_PATH_Y,
        width: ROAD_RIGHT - ROAD_LEFT,
        height: PATH_W,
        type: 'stone',
        color: 0x8a8272,
    },

    // Southern village road.
    {
        x: ROAD_LEFT,
        y: SOUTH_ROW_PATH_Y,
        width: ROAD_RIGHT - ROAD_LEFT,
        height: PATH_W,
        type: 'stone',
        color: 0x8a8272,
    },

    // Lower grass road near the beach. It stops before the sand area.
    {
        x: ROAD_LEFT,
        y: LOWER_FIELD_PATH_Y,
        width: ROAD_RIGHT - ROAD_LEFT,
        height: PATH_W,
        type: 'stone',
        color: 0x8a8272,
    },

    // West vertical road.
    {
        x: WEST_VILLAGE_PATH_X - PATH_W / 2,
        y: NORTH_ROW_PATH_Y,
        width: PATH_W,
        height: LOWER_FIELD_PATH_Y - NORTH_ROW_PATH_Y + PATH_W,
        type: 'stone',
        color: 0x8a8272,
    },

    // Mid vertical road.
    {
        x: MID_VILLAGE_PATH_X - PATH_W / 2,
        y: NORTH_ROW_PATH_Y,
        width: PATH_W,
        height: LOWER_FIELD_PATH_Y - NORTH_ROW_PATH_Y + PATH_W,
        type: 'stone',
        color: 0x8a8272,
    },

    // East vertical road.
    {
        x: EAST_VILLAGE_PATH_X - PATH_W / 2,
        y: NORTH_ROW_PATH_Y,
        width: PATH_W,
        height: LOWER_FIELD_PATH_Y - NORTH_ROW_PATH_Y + PATH_W,
        type: 'stone',
        color: 0x8a8272,
    },

    // Far east vertical road.
    {
        x: FAR_VILLAGE_PATH_X - PATH_W / 2,
        y: NORTH_ROW_PATH_Y,
        width: PATH_W,
        height: LOWER_FIELD_PATH_Y - NORTH_ROW_PATH_Y + PATH_W,
        type: 'stone',
        color: 0x8a8272,
    },

    // Dedicated route from the main house area down toward the lower grass road.
    // It still stops before the beach.
    {
        x: BEACH_PATH_X - PATH_W / 2,
        y: MAIN_PATH_Y,
        width: PATH_W,
        height: LOWER_FIELD_PATH_Y - MAIN_PATH_Y + PATH_W,
        type: 'stone',
        color: 0x8a8272,
    },

    // Filled farm-stone area from the house path down through the planter grid.
    // It remains in the grass area and aligns with the main path.
    {
        x: PLANT_GRID_LEFT,
        y: MAIN_PATH_Y,
        width: PLANT_GRID_RIGHT - PLANT_GRID_LEFT,
        height: PLANT_GRID_BOTTOM - MAIN_PATH_Y,
        type: 'stone',
        color: 0x8a8272,
    },
];

/** Detection order: path overlays first, then base layers. */
const FLOOR_DETECTION_ZONES: FloorZone[] = [
    ...PATH_ZONES,
    ...BASE_FLOOR_ZONES,
];

/** Every plant visual added under public/assets/sprites/plants. */
const PLANT_ASSETS: Record<PlantVariant, { folder: string; filePrefix: string }> = {
    beat_beet:        { folder: 'Beat_Beet',        filePrefix: 'Beatbeet' },
    crescendo_carrot: { folder: 'Crescendo_Carrot', filePrefix: 'CrescendoCarrot' },
    echo_eggplant:    { folder: 'Echo_Eggplant',    filePrefix: 'EchoEggplant' },
    melody_melon:     { folder: 'Melody_Melon',     filePrefix: 'MelodyMelon' },
    rhythm_radish:    { folder: 'Rhythm_Radish',    filePrefix: 'RhythmRadish' },
    treble_turnip:    { folder: 'Treble_Turnip',    filePrefix: 'TrebleTurnip' },
    vinyl_vine:       { folder: 'Vinyl_Vine',       filePrefix: 'VinylVine' },
};

/** Small non-building props spread around main useful areas. */
const PROPS: PropConfig[] = [
    { x: HOUSE_X + 190, y: HOUSE_Y + 65, type: 'barrel', label: 'Barrel' },
    { x: HOUSE_X - 150, y: HOUSE_Y + 78, type: 'keys', label: 'Metal Keys' },
    { x: STORE_X + 120, y: STORE_Y + 80, type: 'cloth', label: 'Cloth Hanging' },

    // Extra small props so the wider map does not feel completely empty.
    { x: WEST_VILLAGE_PATH_X + 90, y: SOUTH_ROW_PATH_Y + 80, type: 'barrel', label: 'Village Barrel' },
    { x: EAST_VILLAGE_PATH_X - 90, y: NORTH_ROW_PATH_Y + 80, type: 'cloth', label: 'Village Cloth' },
    { x: FAR_VILLAGE_PATH_X - 120, y: LOWER_FIELD_PATH_Y + 80, type: 'keys', label: 'Lost Keys' },
];

const EXTRA_PROPS: PropConfig[] = [
    {
        x: HOUSE_X,
        y: HOUSE_Y,
        type: 'building',
        label: 'House',
        buildingVariant: 'house',
        targetScene: 'HouseScene',
    },
    {
        x: STORE_X,
        y: STORE_Y,
        type: 'building',
        label: 'Store',
        buildingVariant: 'store',
        targetScene: 'StoreScene',
    },

    // Northern row — spread widely over the full map.
    { x: WEST_VILLAGE_PATH_X, y: NORTH_ROW_PATH_Y, type: 'building', label: 'Northwest House', buildingVariant: 'house' },
    { x: MID_VILLAGE_PATH_X,  y: NORTH_ROW_PATH_Y, type: 'building', label: 'North House',     buildingVariant: 'house' },
    { x: EAST_VILLAGE_PATH_X, y: NORTH_ROW_PATH_Y, type: 'building', label: 'Northeast House', buildingVariant: 'house' },
    { x: FAR_VILLAGE_PATH_X,  y: NORTH_ROW_PATH_Y, type: 'building', label: 'Far East House',  buildingVariant: 'house' },

    // Main row — central buildings and future expansion.
    { x: 2140, y: MAIN_PATH_Y, type: 'building', label: 'Future Store', buildingVariant: 'store' },
    { x: 3420, y: MAIN_PATH_Y, type: 'building', label: 'East House',   buildingVariant: 'house' },

    // Southern row — more space between houses.
    { x: WEST_VILLAGE_PATH_X, y: SOUTH_ROW_PATH_Y, type: 'building', label: 'Southwest House', buildingVariant: 'house' },
    { x: MID_VILLAGE_PATH_X,  y: SOUTH_ROW_PATH_Y, type: 'building', label: 'South House',     buildingVariant: 'house' },
    { x: EAST_VILLAGE_PATH_X, y: SOUTH_ROW_PATH_Y, type: 'building', label: 'Southeast House', buildingVariant: 'house' },
    { x: FAR_VILLAGE_PATH_X,  y: SOUTH_ROW_PATH_Y, type: 'building', label: 'Far South House', buildingVariant: 'house' },

    // Lower grass row near the beach. Still on grass, so no stone road cuts into sand.
    { x: 520,  y: LOWER_FIELD_PATH_Y, type: 'building', label: 'Lower Field House', buildingVariant: 'house' },
    { x: 2140, y: LOWER_FIELD_PATH_Y, type: 'building', label: 'Lower Store',       buildingVariant: 'store' },
    { x: 3600, y: LOWER_FIELD_PATH_Y, type: 'building', label: 'Beachside House',   buildingVariant: 'house' },

    // Small planting plot in the grass corridor between the shop and the house.
    // The x-axis alignment is kept, with stone aisles between/around the planters.
    { x: PLANT_AREA_X - PLANT_COLUMN_SPACING, y: PLANT_ROW_Y1 + PLANT_SPRITE_Y_OFFSET, type: 'plant', label: 'Empty Planter', plantVariant: 'vinyl_vine' },
    { x: PLANT_AREA_X,                        y: PLANT_ROW_Y1 + PLANT_SPRITE_Y_OFFSET, type: 'plant', label: 'Empty Planter', plantVariant: 'vinyl_vine' },
    { x: PLANT_AREA_X + PLANT_COLUMN_SPACING, y: PLANT_ROW_Y1 + PLANT_SPRITE_Y_OFFSET, type: 'plant', label: 'Empty Planter', plantVariant: 'vinyl_vine' },
    { x: PLANT_AREA_X - PLANT_COLUMN_SPACING, y: PLANT_ROW_Y2 + PLANT_SPRITE_Y_OFFSET, type: 'plant', label: 'Empty Planter', plantVariant: 'vinyl_vine' },
    { x: PLANT_AREA_X,                        y: PLANT_ROW_Y2 + PLANT_SPRITE_Y_OFFSET, type: 'plant', label: 'Empty Planter', plantVariant: 'vinyl_vine' },
    { x: PLANT_AREA_X + PLANT_COLUMN_SPACING, y: PLANT_ROW_Y2 + PLANT_SPRITE_Y_OFFSET, type: 'plant', label: 'Empty Planter', plantVariant: 'vinyl_vine' },
];

/** Distance in pixels the player must walk before the next footstep fires. */
const STEP_DISTANCE = 48;

// ──────────────────────────────────────────────────────────────

export class GameScene extends Phaser.Scene {
    private player!: Player;
    private props: Prop[] = [];
    private solidPlanters: Phaser.GameObjects.Rectangle[] = [];
    private solidWater: Phaser.GameObjects.Rectangle[] = [];
    private floorTileSpritesByType: Partial<Record<FloorZone['type'], Phaser.GameObjects.TileSprite[]>> = {};
    private audioManager!: AudioManager;
    private ui!: UI;
    private keyE!: Phaser.Input.Keyboard.Key;
    private keyM!: Phaser.Input.Keyboard.Key;
    private keyTab!: Phaser.Input.Keyboard.Key;
    private toolKeyBindings: { key: Phaser.Input.Keyboard.Key; tool: ToolType }[] = [];
    private currentTool: ToolType = DEFAULT_TOOL;
    private audioUnlocked = false;
    private isChangingScene = false;
    private cameraZoom = 1.0;

    constructor() {
        super({ key: 'GameScene' });
    }

    // ── Preload ───────────────────────────────────────────────

    preload(): void {
        const loadImageOnce = (key: string, url: string): void => {
            if (!this.textures.exists(key)) this.load.image(key, url);
        };

        if (!this.textures.exists('player')) {
            this.load.spritesheet('player', 'assets/sprites/characters/player_spritesheet.png', {
                frameWidth: 32,
                frameHeight: 32,
            });
        }

        // Outdoor tile textures are resolved in create() with PNG/JPG/JPEG
        // candidates and safe generated fallbacks. Do not preload a single
        // hard-coded extension here; that creates Phaser processing warnings
        // whenever the user replaces e.g. stone.jpeg with stone.png.

        loadImageOnce('object-house', '/assets/objects/main_house/main_house_daphne.png');
        loadImageOnce('object-store', '/assets/objects/main_store/store_building_seeds.png');
        loadImageOnce('planter-big', '/assets/sprites/plants/planter/planter_big.png');
        loadImageOnce('planter-small', '/assets/sprites/plants/planter/planter_small.png');

        for (const [plantVariant, asset] of Object.entries(PLANT_ASSETS) as [PlantVariant, { folder: string; filePrefix: string }][]) {
            loadImageOnce(
                `${plantVariant}_stage1`,
                `/assets/sprites/plants/${asset.folder}/${asset.filePrefix}_01_Seed.png`
            );
            loadImageOnce(
                `${plantVariant}_stage2`,
                `/assets/sprites/plants/${asset.folder}/${asset.filePrefix}_02_Sprout.png`
            );
            loadImageOnce(
                `${plantVariant}_stage3`,
                `/assets/sprites/plants/${asset.folder}/${asset.filePrefix}_03_Growing.png`
            );
            loadImageOnce(
                `${plantVariant}_stage4`,
                `/assets/sprites/plants/${asset.folder}/${asset.filePrefix}_04_Mature.png`
            );
        }

        // Backward-compatible default keys. Existing code that still asks for
        // plant_stage1, plant_stage2, etc. will use Vinyl Vine.
        loadImageOnce('plant_stage1', '/assets/sprites/plants/Vinyl_Vine/VinylVine_01_Seed.png');
        loadImageOnce('plant_stage2', '/assets/sprites/plants/Vinyl_Vine/VinylVine_02_Sprout.png');
        loadImageOnce('plant_stage3', '/assets/sprites/plants/Vinyl_Vine/VinylVine_03_Growing.png');
        loadImageOnce('plant_stage4', '/assets/sprites/plants/Vinyl_Vine/VinylVine_04_Mature.png');
    }

    // ── Create ────────────────────────────────────────────────

    create(data: { spawn?: { x: number; y: number } } = {}): void {
        // Reset scene-local state. Phaser reuses the same Scene instance when
        // returning from HouseScene/StoreScene, so old props must not remain
        // in this array after their GameObjects have been destroyed.
        this.props = [];
        this.solidPlanters = [];
        this.solidWater = [];
        this.floorTileSpritesByType = {};
        this.isChangingScene = false;
        this.audioUnlocked = false;
        this.cameraZoom = 1.0;
        this.currentTool = DEFAULT_TOOL;
        this.toolKeyBindings = [];

        this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

        this.ensureOutdoorFallbackTextures();
        this.drawFloorZones();
        this.drawTerrainBreakup();
        this.drawBeachFoam();
        this.drawPathEdges();
        this.drawPathBreakup();
        this.drawPlantingArea();
        this.createWaterCollision();
        this.applyReplaceableOutdoorTiles();

        if (SHOW_DEBUG_GRID) {
            this.drawGrid();
        }

        for (const cfg of [...PROPS, ...EXTRA_PROPS]) {
            const prop = new Prop(
                this,
                cfg.x,
                cfg.y,
                cfg.type,
                cfg.label,
                cfg.plantVariant,
                cfg.buildingVariant,
                cfg.targetScene
            );
            this.props.push(prop);
        }

        // Create player near the requested return point when coming back from an interior.
        // StoreScene returns here with the shop-front coordinates, so leaving the
        // shop no longer teleports the player back to the house.
        const spawnX = typeof data.spawn?.x === 'number' ? data.spawn.x : PLAYER_START_X;
        const spawnY = typeof data.spawn?.y === 'number' ? data.spawn.y : PLAYER_START_Y;
        this.player = new Player(this, spawnX, spawnY);

        for (const prop of this.props) {
            if (prop.collider) {
                this.physics.add.collider(
                    this.player.sprite,
                    prop.collider
                );
            }
        }

        for (const planterCollider of this.solidPlanters) {
            this.physics.add.collider(this.player.sprite, planterCollider);
        }

        for (const waterCollider of this.solidWater) {
            this.physics.add.collider(this.player.sprite, waterCollider);
        }

        this.cameras.main.startFollow(this.player.sprite, true, 0.12, 0.12);
        this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
        this.cameras.main.setZoom(this.cameraZoom);

        this.audioManager = AudioManager.getShared();

        for (const prop of this.props) {
            if (prop.type === 'plant') {
                prop.onPlantStageChange = (variant, stage) => {
                    this.audioManager.playPlantGrowthStage(variant, stage);
                };

                prop.onPlantHarvest = (variant) => {
                    this.audioManager.playToolAction('harvest');
                    this.audioManager.playPlantHarvest(variant);
                    FarmState.addHarvest(variant);
                };
            }

            prop.onInteract = () => {
                if (prop.type === 'building') {
                    this.audioManager.playPropInteract('door');

                    if (prop.targetScene) {
                        this.isChangingScene = true;
                        const returnSpawn = prop.targetScene === 'StoreScene'
                            ? { x: STORE_X, y: MAIN_PATH_Y + PATH_W / 2 + 10 }
                            : { x: HOUSE_X, y: MAIN_PATH_Y + PATH_W / 2 + 10 };
                        this.scene.start(prop.targetScene, { returnSpawn });
                    }

                    return;
                }

                if (prop.type === 'plant') {
                    if (prop.isPlantMature()) {
                        prop.tryHarvest();
                        return;
                    }

                    if (prop.isPlantEmpty()) {
                        if (this.currentTool !== 'hoe') {
                            this.audioManager.playToolAction(this.currentTool);
                            return;
                        }

                        prop.tryPlantFirstOwnedSeed();
                        this.audioManager.playToolAction('hoe');
                        return;
                    }

                    if (prop.needsWater()) {
                        if (this.currentTool !== 'watering_can') {
                            this.audioManager.playToolAction(this.currentTool);
                            return;
                        }

                        prop.tryWater();
                        this.audioManager.playToolAction('watering_can');
                        return;
                    }

                    this.audioManager.playToolAction(this.currentTool);
                    this.audioManager.playPlantGrowthStage(prop.getPlantVariant(), prop.getPlantStage());
                    return;
                }

                this.audioManager.playPropInteract(prop.type);
            };
        }

        this.ui = new UI(
            this,
            (tool) => this.selectTool(tool, true),
            (direction) => this.adjustCameraZoom(direction)
        );

        this.keyE = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
        this.keyM = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M);
        this.keyTab = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);
        this.input.keyboard!.addCapture(Phaser.Input.Keyboard.KeyCodes.TAB);
        this.toolKeyBindings = TOOL_HOTKEYS.map((binding) => ({
            key: this.input.keyboard!.addKey(binding.keyCode),
            tool: binding.tool,
        }));

        // Unlock audio without blocking gameplay. The map itself starts instantly.
        this.input.keyboard!.on('keydown', () => this.tryUnlockAudio());
        this.input.on('pointerdown', () => this.tryUnlockAudio());
        this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
            this.cycleTool(dy > 0 ? 1 : -1);
        });
    }

    // ── Update every frame ────────────────────────────────────

    update(_time: number, delta: number): void {
        if (this.isChangingScene) return;

        this.player.update(FLOOR_DETECTION_ZONES);

        const deltaSec = delta / 1000;
        this.audioManager.updatePerformer(
            deltaSec,
            this.player.speed,
            this.player.currentFloorType
        );

        const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
        this.audioManager.updatePanning(body.velocity.x, 200);

        for (const prop of this.props) {
            const inRange = prop.updateProximity(
                this.player.sprite.x,
                this.player.sprite.y
            );

            if (inRange && Phaser.Input.Keyboard.JustDown(this.keyE)) {
                prop.interact();
                if (this.isChangingScene) return;
                break;
            }
        }

        if (this.player.isMoving && this.player.distanceSinceStep >= STEP_DISTANCE) {
            this.audioManager.playFootstep(this.player.currentFloorType);
            this.player.resetStepDistance();
        }

        if (Phaser.Input.Keyboard.JustDown(this.keyM)) {
            const next = this.audioManager.getModeName() === 'classic' ? 'live' : 'classic';
            void this.audioManager.switchMode(next);
        }

        if (Phaser.Input.Keyboard.JustDown(this.keyTab)) {
            this.ui.toggleInventory();
        }

        for (const binding of this.toolKeyBindings) {
            if (Phaser.Input.Keyboard.JustDown(binding.key)) {
                this.selectTool(binding.tool, true);
                break;
            }
        }

        this.ui.update(
            this.audioManager.getModeName(),
            this.player.currentFloorType,
            this.audioManager.getMixerSnapshot(),
            this.audioManager.seed,
            this.currentTool
        );

        for (const prop of this.props) {
            prop.update(delta);
        }
    }

    // ── World drawing helpers ─────────────────────────────────

    private ensureOutdoorFallbackTextures(): void {
        this.createCheckerTile('tile-fallback', 0x4c5f38, 0x3d5130, 0x5c7142);
        this.createCheckerTile('tile-grass', 0x4c5f38, 0x3d5130, 0x5c7142);
        this.createCheckerTile('tile-sand', 0xd6be7f, 0xc4a967, 0xf0d99c);
        this.createCheckerTile('tile-water', 0x3c9aaa, 0x2f8192, 0x84d9e2);
        this.createCheckerTile('tile-stone-path', 0x8a8272, 0x726b5f, 0xb1aa9a);
    }

    private createCheckerTile(key: string, a: number, b: number, line: number): void {
        if (this.textures.exists(key)) return;

        const size = 64;
        const gfx = this.add.graphics();
        gfx.fillStyle(a, 1);
        gfx.fillRect(0, 0, size, size);
        gfx.fillStyle(b, 1);
        gfx.fillRect(size / 2, 0, size / 2, size / 2);
        gfx.fillRect(0, size / 2, size / 2, size / 2);
        gfx.lineStyle(1, line, 0.32);
        gfx.strokeRect(0, 0, size, size);
        gfx.generateTexture(key, size, size);
        gfx.destroy();
    }

    private applyReplaceableOutdoorTiles(): void {
        const replacements: { type: FloorZone['type']; key: string; base: string }[] = [
            { type: 'grass', key: 'tile-grass-custom', base: '/assets/tiles/grass/grass' },
            { type: 'sand',  key: 'tile-sand-custom',  base: '/assets/tiles/beach/sand' },
            { type: 'water', key: 'tile-water-custom', base: '/assets/tiles/beach/water' },
            { type: 'stone', key: 'tile-stone-path-custom', base: '/assets/tiles/path/stone' },
        ];

        for (const item of replacements) {
            loadFirstAvailableImageTexture(this, item.key, extensionCandidates(item.base), (textureKey) => {
                const sprites = this.floorTileSpritesByType[item.type] ?? [];
                for (const tile of sprites) {
                    if (tile.scene) tile.setTexture(textureKey);
                }
            });
        }
    }

    private createWaterCollision(): void {
        const collider = this.add.rectangle(
            WORLD_W / 2,
            WATER_START_Y + (WORLD_H - WATER_START_Y) / 2,
            WORLD_W,
            WORLD_H - WATER_START_Y,
            0x0000ff,
            0
        );
        this.physics.add.existing(collider, true);
        this.solidWater.push(collider);
    }

    private drawFloorZones(): void {
        const zoneTextures: Record<string, string> = {
            grass: 'tile-grass',
            sand: 'tile-sand',
            water: 'tile-water',
            stone: 'tile-stone-path',
            wood: 'tile-wood',
            gravel: 'tile-gravel',
        };

        for (const zone of BASE_FLOOR_ZONES) {
            this.drawTiledZone(zone, zoneTextures[zone.type], 0);
        }

        for (const zone of PATH_ZONES) {
            this.drawTiledZone(zone, zoneTextures[zone.type], 0.8);
        }
    }

    private drawTiledZone(zone: FloorZone, textureKey: string, depth: number): void {
        const safeTextureKey = this.textures.exists(textureKey) ? textureKey : 'tile-fallback';
        const ts = this.add.tileSprite(
            zone.x,
            zone.y,
            zone.width,
            zone.height,
            safeTextureKey
        );

        ts.setOrigin(0, 0).setDepth(depth);
        (this.floorTileSpritesByType[zone.type] ??= []).push(ts);

        if (zone.type === 'stone') {
            // Keep every stone segment on the same world texture grid. This
            // prevents visible pattern jumps where path rectangles meet.
            ts.tileScaleX = 1;
            ts.tileScaleY = 1;
            ts.tilePositionX = zone.x % 128;
            ts.tilePositionY = zone.y % 128;
            return;
        }

        ts.tileScaleX = zone.type === 'water' ? 1.18 : 1.08;
        ts.tileScaleY = zone.type === 'water' ? 1.18 : 1.08;
        ts.tilePositionX = (zone.x * 0.37 + zone.y * 0.13) % 128;
        ts.tilePositionY = (zone.y * 0.31 + zone.width * 0.07) % 128;
    }

    /** Decorative breakup layer to hide obvious repeated tile seams. */
    private drawTerrainBreakup(): void {
        const grass = this.add.graphics().setDepth(0.35);
        for (let i = 0; i < 230; i++) {
            const x = this.seededRange(i, 11, 40, WORLD_W - 40);
            const y = this.seededRange(i, 12, 40, GRASS_END_Y - 40);
            const w = this.seededRange(i, 13, 12, 42);
            const h = this.seededRange(i, 14, 3, 9);
            grass.fillStyle(i % 2 === 0 ? 0x3d5130 : 0x5c7142, 0.14);
            grass.fillEllipse(x, y, w, h);
        }

        const sand = this.add.graphics().setDepth(0.35);
        for (let i = 0; i < 110; i++) {
            const x = this.seededRange(i, 21, 25, WORLD_W - 25);
            const y = this.seededRange(i, 22, GRASS_END_Y + 14, SAND_END_Y - 18);
            const r = this.seededRange(i, 23, 1.2, 3.6);
            sand.fillStyle(i % 2 === 0 ? 0xb99d64 : 0xf1d99a, 0.16);
            sand.fillCircle(x, y, r);
        }

        const water = this.add.graphics().setDepth(0.35);
        water.lineStyle(2, 0xbbe9ee, 0.16);
        for (let y = WATER_START_Y + 38; y < WORLD_H; y += 58) {
            water.beginPath();
            for (let x = 0; x <= WORLD_W; x += 40) {
                const waveY = y + Math.sin(x * 0.018 + y * 0.02) * 5;
                if (x === 0) water.moveTo(x, waveY);
                else water.lineTo(x, waveY);
            }
            water.strokePath();
        }
    }

    /**
     * Keep stone paths visually clean.
     * Earlier versions added random crack/pebble marks, but those read as loose
     * bumps near the buildings and made the road edges feel messy.
     */
    private drawPathBreakup(): void {
        // Intentionally empty. The stone texture itself is used with straight geometry.
    }

    private seededRange(index: number, salt: number, min: number, max: number): number {
        const raw = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
        const normalized = raw - Math.floor(raw);
        return min + normalized * (max - min);
    }

    /** Decorative foam line where sand meets water. */
    private drawBeachFoam(): void {
        const gfx = this.add.graphics().setDepth(0.95);
        gfx.lineStyle(4, 0xffffff, 0.45);
        gfx.beginPath();
        for (let x = -20; x <= WORLD_W + 20; x += 40) {
            const y = WATER_START_Y - 2 + Math.sin(x * 0.035) * 5;
            if (x === -20) gfx.moveTo(x, y);
            else gfx.lineTo(x, y);
        }
        gfx.strokePath();
    }

    /** No stroke rectangles: overlapping path pieces must merge smoothly. */
    private drawPathEdges(): void {
        // Intentionally empty. The texture and rectangular geometry provide the edge.
    }

    /** Places small solid planter sprites before plant props are drawn. */
    private drawPlantingArea(): void {
        const planterPositions = [
            { x: PLANT_AREA_X - PLANT_COLUMN_SPACING, y: PLANT_ROW_Y1 },
            { x: PLANT_AREA_X,                        y: PLANT_ROW_Y1 },
            { x: PLANT_AREA_X + PLANT_COLUMN_SPACING, y: PLANT_ROW_Y1 },
            { x: PLANT_AREA_X - PLANT_COLUMN_SPACING, y: PLANT_ROW_Y2 },
            { x: PLANT_AREA_X,                        y: PLANT_ROW_Y2 },
            { x: PLANT_AREA_X + PLANT_COLUMN_SPACING, y: PLANT_ROW_Y2 },
        ];

        for (const pos of planterPositions) {
            const bedX = pos.x;
            const bedY = pos.y + PLANT_BED_Y_OFFSET;

            const bed = this.add.image(bedX, bedY, 'planter-small')
                .setOrigin(0.5)
                .setScale(0.13)
                .setDepth(1.55);

            this.addSolidPlanterCollider(
                bedX,
                bedY + 2,
                bed.displayWidth * 0.72,
                bed.displayHeight * 0.38
            );
        }
    }

    private addSolidPlanterCollider(x: number, y: number, width: number, height: number): void {
        const collider = this.add.rectangle(x, y + height * 0.05, width, height, 0xff0000, 0);
        this.physics.add.existing(collider, true);
        this.solidPlanters.push(collider);
    }

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

        gfx.setDepth(50);
    }

    private selectTool(tool: ToolType, playSound = false): void {
        if (this.currentTool === tool) return;
        this.currentTool = tool;
        if (playSound) this.audioManager.playToolAction(tool);
    }

    private cycleTool(direction: number): void {
        const index = TOOL_ORDER.indexOf(this.currentTool);
        const nextIndex = (index + direction + TOOL_ORDER.length) % TOOL_ORDER.length;
        this.selectTool(TOOL_ORDER[nextIndex], true);
    }

    private adjustCameraZoom(direction: number): void {
        const nextZoom = Phaser.Math.Clamp(
            this.cameraZoom + direction * 0.25,
            0.32,
            3.0
        );

        if (Math.abs(nextZoom - this.cameraZoom) < 0.001) return;

        this.cameraZoom = nextZoom;
        this.cameras.main.setZoom(this.cameraZoom);
    }

    private tryUnlockAudio(): void {
        if (this.audioUnlocked) return;

        this.audioUnlocked = true;

        void this.audioManager.ensureStarted().catch((err) => {
            console.warn('[GameScene] Audio could not be started:', err);
        });
    }
}