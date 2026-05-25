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
import { FloorZone } from '../types';
import { extensionCandidates, loadFirstAvailableImageTexture } from '../utils/TextureResolver';

const ROOM_W = 760;
const ROOM_H = 500;
const WALL_H = 96;
const TILE = 42;
const EXIT_W = 90;
const EXIT_H = 34;

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

        this.cameras.main.setBackgroundColor('#0e1014');
        this.ensureFallbackTextures();
        this.drawWalkableInterior();
        this.applyReplaceableTiles();
        this.createPlayer();
        this.createControls();
    }

    update(): void {
        if (!this.player) return;

        this.player.update(this.floorZones);

        const insideExit = Phaser.Geom.Rectangle.Contains(
            this.exitZone,
            this.player.sprite.x,
            this.player.sprite.y
        );

        this.exitPrompt.setAlpha(0);

        if (insideExit || Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
            this.exitToVillage();
        }
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
