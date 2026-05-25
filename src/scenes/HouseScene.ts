/**
 * HouseScene.ts — Walkable house interior.
 *
 * v10:
 *  - Returns to the exact outdoor spawn sent by GameScene instead of resetting.
 *  - Floor and wall tiles are replaceable image files. The scene tries PNG,
 *    JPG, then JPEG and falls back to generated grey tiles if nothing exists.
 *  - Walking onto the bottom-centre exit mat now leaves automatically.
 */
import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { FloorZone, ToolType } from '../types';
import { AudioManager } from '../audio/AudioManager';
import { UI } from '../utils/UI';
import { extensionCandidates, loadFirstAvailableImageTexture } from '../utils/TextureResolver';

const ROOM_W = 760;
const ROOM_H = 500;
const WALL_H = 96;
const TILE = 42;
const EXIT_W = 90;
const EXIT_H = 34;
const STEP_DISTANCE = 48;
const DEFAULT_TOOL: ToolType = 'hoe';
const TOOL_ORDER: ToolType[] = ['pickaxe', 'axe', 'hoe', 'watering_can'];
const TOOL_HOTKEYS: { keyCode: number; tool: ToolType }[] = [
    { keyCode: Phaser.Input.Keyboard.KeyCodes.ONE,   tool: 'pickaxe' },
    { keyCode: Phaser.Input.Keyboard.KeyCodes.TWO,   tool: 'axe' },
    { keyCode: Phaser.Input.Keyboard.KeyCodes.THREE, tool: 'hoe' },
    { keyCode: Phaser.Input.Keyboard.KeyCodes.FOUR,  tool: 'watering_can' },
];

const HOUSE_FLOOR_FALLBACK_KEY = 'house-floor-fallback-tile';
const HOUSE_WALL_FALLBACK_KEY = 'house-wall-fallback-tile';
const HOUSE_FLOOR_CUSTOM_KEY = 'house-floor-custom-tile';
const HOUSE_WALL_CUSTOM_KEY = 'house-wall-custom-tile';

const HOUSE_FLOOR_CANDIDATES = extensionCandidates('/assets/tiles/interiors/house_floor');
const HOUSE_WALL_CANDIDATES = extensionCandidates('/assets/tiles/interiors/house_wall');

type ReturnSpawn = { x: number; y: number };

export class HouseScene extends Phaser.Scene {
    private player?: Player;
    private keyEsc!: Phaser.Input.Keyboard.Key;
    private exitZone!: Phaser.Geom.Rectangle;
    private exitPrompt!: Phaser.GameObjects.Text;
    private keyM!: Phaser.Input.Keyboard.Key;
    private keyTab!: Phaser.Input.Keyboard.Key;
    private audioManager!: AudioManager;
    private ui!: UI;
    private currentTool: ToolType = DEFAULT_TOOL;
    private toolKeyBindings: { key: Phaser.Input.Keyboard.Key; tool: ToolType }[] = [];
    private cameraZoom = 1.0;
    private audioUnlocked = false;
    private floorZones: FloorZone[] = [];
    private returnSpawn?: ReturnSpawn;
    private floorTileSprites: Phaser.GameObjects.TileSprite[] = [];
    private wallTileSprites: Phaser.GameObjects.TileSprite[] = [];

    constructor() {
        super({ key: 'HouseScene' });
    }

    preload(): void {
        this.load.spritesheet('player', 'assets/sprites/player_spritesheet.png', {
            frameWidth: 32,
            frameHeight: 32,
        });
    }

    create(data: { returnSpawn?: ReturnSpawn } = {}): void {
        this.returnSpawn = data.returnSpawn;
        this.floorTileSprites = [];
        this.wallTileSprites = [];
        this.currentTool = DEFAULT_TOOL;
        this.toolKeyBindings = [];
        this.cameraZoom = 1.0;
        this.audioUnlocked = false;

        this.cameras.main.setBackgroundColor('#0e1014');
        this.ensureFallbackTextures();
        this.drawWalkableInterior();
        this.applyReplaceableTiles();
        this.createPlayer();
        this.cameras.main.setZoom(this.cameraZoom);
        this.audioManager = AudioManager.getShared();
        this.ui = new UI(this, (tool) => this.selectTool(tool, true), (direction) => this.adjustCameraZoom(direction));
        this.createControls();
    }

    update(_time: number, delta: number): void {
        if (!this.player) return;

        this.player.update(this.floorZones);

        const deltaSec = delta / 1000;
        this.audioManager.updatePerformer(deltaSec, this.player.speed, this.player.currentFloorType);
        const body = this.player.sprite.body as Phaser.Physics.Arcade.Body;
        this.audioManager.updatePanning(body.velocity.x, 200);

        if (this.player.isMoving && this.player.distanceSinceStep >= STEP_DISTANCE) {
            this.audioManager.playFootstep(this.player.currentFloorType);
            this.player.resetStepDistance();
        }

        const insideExit = Phaser.Geom.Rectangle.Contains(
            this.exitZone,
            this.player.sprite.x,
            this.player.sprite.y
        );

        this.exitPrompt.setAlpha(0);

        if (insideExit || Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
            this.exitToVillage();
            return;
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
    }

    private drawWalkableInterior(): void {
        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;
        const left = cx - ROOM_W / 2;
        const top = cy - ROOM_H / 2;
        const floorTop = top + WALL_H;
        const floorH = ROOM_H - WALL_H;

        // Replaceable tiled wall.
        const wall = this.add.tileSprite(cx, top + WALL_H / 2, ROOM_W, WALL_H, HOUSE_WALL_FALLBACK_KEY)
            .setOrigin(0.5)
            .setDepth(0);
        this.wallTileSprites.push(wall);

        this.add.rectangle(cx, top + WALL_H - 8, ROOM_W, 16, 0x24272f, 0.88).setDepth(1);

        // Simple wall details so it reads as an interior instead of a plain box.
        this.add.rectangle(cx - 230, top + 48, 150, 36, 0x2c2e36, 0.78)
            .setStrokeStyle(2, 0x555861, 0.7)
            .setDepth(2);
        this.add.rectangle(cx + 220, top + 50, 110, 44, 0x20232b, 0.78)
            .setStrokeStyle(2, 0x60636c, 0.65)
            .setDepth(2);

        // Replaceable greyish walkable floor tiles.
        const floor = this.add.tileSprite(left, floorTop, ROOM_W, floorH, HOUSE_FLOOR_FALLBACK_KEY)
            .setOrigin(0, 0)
            .setDepth(0);
        this.floorTileSprites.push(floor);

        // Fine grid overlay keeps the replacement texture readable as floor tiles.
        const floorGrid = this.add.graphics().setDepth(1);
        floorGrid.lineStyle(1, 0x34383c, 0.28);
        for (let y = floorTop; y <= top + ROOM_H; y += TILE) {
            floorGrid.lineBetween(left, y, left + ROOM_W, y);
        }
        for (let x = left; x <= left + ROOM_W; x += TILE) {
            floorGrid.lineBetween(x, floorTop, x, floorTop + floorH);
        }

        // Room border and exit mat.
        this.add.rectangle(cx, cy, ROOM_W, ROOM_H, 0x000000, 0)
            .setStrokeStyle(4, 0x15171d, 1)
            .setDepth(5);

        const exitX = cx;
        const exitY = top + ROOM_H - EXIT_H / 2 - 8;
        this.add.rectangle(exitX, exitY, EXIT_W, EXIT_H, 0x4e565a, 1)
            .setStrokeStyle(2, 0xffde8f, 0.75)
            .setDepth(2);
        this.add.text(exitX, exitY, 'EXIT', {
            fontSize: '12px',
            color: '#fff1a8',
            fontFamily: 'monospace',
            stroke: '#000000',
            strokeThickness: 3,
        }).setOrigin(0.5).setDepth(3);

        this.exitZone = new Phaser.Geom.Rectangle(exitX - EXIT_W / 2, exitY - EXIT_H / 2, EXIT_W, EXIT_H);

        this.floorZones = [
            { x: left, y: floorTop, width: ROOM_W, height: floorH, type: 'stone', color: 0x777b7e },
        ];

        this.add.text(cx, 34, 'House', {
            fontSize: '28px',
            color: '#ffde8f',
            fontFamily: 'monospace',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 4,
        }).setOrigin(0.5).setDepth(50);

        this.exitPrompt = this.add.text(cx, exitY - 42, '', {
            fontSize: '14px',
            color: '#ffee77',
            fontFamily: 'monospace',
            stroke: '#000000',
            strokeThickness: 3,
        }).setOrigin(0.5).setDepth(50);

        this.physics.world.setBounds(left, floorTop, ROOM_W, floorH);
    }

    private createPlayer(): void {
        const startX = this.exitZone.centerX;
        const startY = this.exitZone.y - 34;
        this.player = new Player(this, startX, startY);
        this.player.sprite.setDepth(20);
    }

    private createControls(): void {
        this.keyEsc = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
        this.keyM = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M);
        this.keyTab = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.TAB);
        this.input.keyboard!.addCapture(Phaser.Input.Keyboard.KeyCodes.TAB);
        this.toolKeyBindings = TOOL_HOTKEYS.map((binding) => ({
            key: this.input.keyboard!.addKey(binding.keyCode),
            tool: binding.tool,
        }));
        this.input.keyboard!.on('keydown', () => this.tryUnlockAudio());
        this.input.on('pointerdown', () => this.tryUnlockAudio());
        this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
            this.cycleTool(dy > 0 ? 1 : -1);
        });
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
        const nextZoom = Phaser.Math.Clamp(this.cameraZoom + direction * 0.25, 0.32, 3.0);
        if (Math.abs(nextZoom - this.cameraZoom) < 0.001) return;
        this.cameraZoom = nextZoom;
        this.cameras.main.setZoom(this.cameraZoom);
    }

    private tryUnlockAudio(): void {
        if (this.audioUnlocked) return;
        this.audioUnlocked = true;
        void this.audioManager.ensureStarted().catch((err) => {
            console.warn('[HouseScene] Audio could not be started:', err);
        });
    }

    private exitToVillage(): void {
        this.scene.start('GameScene', this.returnSpawn ? { spawn: this.returnSpawn } : undefined);
    }

    private ensureFallbackTextures(): void {
        this.createCheckerTile(HOUSE_FLOOR_FALLBACK_KEY, 0x85898c, 0x6f7376, 0x4d5054);
        this.createCheckerTile(HOUSE_WALL_FALLBACK_KEY, 0x3f424a, 0x30333a, 0x1f2229);
    }

    private createCheckerTile(key: string, a: number, b: number, line: number): void {
        if (this.textures.exists(key)) return;

        const gfx = this.add.graphics();
        gfx.fillStyle(a, 1);
        gfx.fillRect(0, 0, TILE, TILE);
        gfx.fillStyle(b, 1);
        gfx.fillRect(TILE / 2, 0, TILE / 2, TILE / 2);
        gfx.fillRect(0, TILE / 2, TILE / 2, TILE / 2);
        gfx.lineStyle(1, line, 0.45);
        gfx.strokeRect(0, 0, TILE, TILE);
        gfx.generateTexture(key, TILE, TILE);
        gfx.destroy();
    }

    private applyReplaceableTiles(): void {
        loadFirstAvailableImageTexture(this, HOUSE_FLOOR_CUSTOM_KEY, HOUSE_FLOOR_CANDIDATES, (key) => {
            this.floorTileSprites.forEach((tile) => { if (tile.scene) tile.setTexture(key); });
        });
        loadFirstAvailableImageTexture(this, HOUSE_WALL_CUSTOM_KEY, HOUSE_WALL_CANDIDATES, (key) => {
            this.wallTileSprites.forEach((tile) => { if (tile.scene) tile.setTexture(key); });
        });
    }

}
