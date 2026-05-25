/**
 * StoreScene.ts — walkable seed shop interior.
 *
 * v11:
 *  - Store is now a playable interior with the player walking on the floor.
 *  - Press E at the counter to open/close the seed catalog.
 *  - Walk onto the bottom-centre exit mat to return to the exact position
 *    in front of the shop. ESC still returns when the catalog is closed.
 *  - Floor/wall tiles remain replaceable through PNG/JPG/JPEG files.
 */
import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { FarmState, SEED_CATALOG, SeedDefinition } from '../gameData';
import { FloorZone, PlantVariant } from '../types';
import { extensionCandidates, loadFirstAvailableImageTexture } from '../utils/TextureResolver';

const PANEL_W = 790;
const PANEL_H = 486;
const ROW_H = 58;
const TILE = 42;

const FLOOR_TOP = 255;
const EXIT_W = 112;
const EXIT_H = 36;

const STORE_FLOOR_FALLBACK_KEY = 'store-floor-fallback-tile';
const STORE_WALL_FALLBACK_KEY = 'store-wall-fallback-tile';
const STORE_FLOOR_CUSTOM_KEY = 'store-floor-custom-tile';
const STORE_WALL_CUSTOM_KEY = 'store-wall-custom-tile';

const STORE_FLOOR_CANDIDATES = extensionCandidates('/assets/tiles/interiors/store_floor');
const STORE_WALL_CANDIDATES = extensionCandidates('/assets/tiles/interiors/store_wall');

const SHOP_PLANT_ASSETS: Record<PlantVariant, { folder: string; filePrefix: string }> = {
    beat_beet: { folder: 'Beat_Beet', filePrefix: 'Beatbeet' },
    crescendo_carrot: { folder: 'Crescendo_Carrot', filePrefix: 'CrescendoCarrot' },
    echo_eggplant: { folder: 'Echo_Eggplant', filePrefix: 'EchoEggplant' },
    melody_melon: { folder: 'Melody_Melon', filePrefix: 'MelodyMelon' },
    rhythm_radish: { folder: 'Rhythm_Radish', filePrefix: 'RhythmRadish' },
    treble_turnip: { folder: 'Treble_Turnip', filePrefix: 'TrebleTurnip' },
    vinyl_vine: { folder: 'Vinyl_Vine', filePrefix: 'VinylVine' },
};

type ReturnSpawn = { x: number; y: number };

export class StoreScene extends Phaser.Scene {
    private shopOpen = false;
    private dialogueText!: Phaser.GameObjects.Text;
    private coinsText!: Phaser.GameObjects.Text;
    private promptText!: Phaser.GameObjects.Text;
    private shopContainer?: Phaser.GameObjects.Container;
    private buyKeys: Phaser.Input.Keyboard.Key[] = [];
    private keyE!: Phaser.Input.Keyboard.Key;
    private keyEsc!: Phaser.Input.Keyboard.Key;
    private returnSpawn?: ReturnSpawn;
    private floorTileSprites: Phaser.GameObjects.TileSprite[] = [];
    private wallTileSprites: Phaser.GameObjects.TileSprite[] = [];
    private player?: Player;
    private floorZones: FloorZone[] = [];
    private counterInteractZone!: Phaser.Geom.Rectangle;
    private exitZone!: Phaser.Geom.Rectangle;
    private counterCollider?: Phaser.GameObjects.Rectangle;

    constructor() {
        super({ key: 'StoreScene' });
    }

    preload(): void {
        this.load.spritesheet('player', 'assets/sprites/player_spritesheet.png', {
            frameWidth: 32,
            frameHeight: 32,
        });

        for (const [variant, asset] of Object.entries(SHOP_PLANT_ASSETS) as [PlantVariant, { folder: string; filePrefix: string }][]) {
            this.load.image(
                `shop-seedling-${variant}`,
                `/assets/sprites/Plants/plants/${asset.folder}/${asset.filePrefix}_02_Sprout.png`
            );
        }
    }

    create(data: { returnSpawn?: ReturnSpawn } = {}): void {
        this.returnSpawn = data.returnSpawn;
        this.shopOpen = false;
        this.buyKeys = [];
        this.floorTileSprites = [];
        this.wallTileSprites = [];
        this.floorZones = [];
        this.counterCollider = undefined;

        this.cameras.main.setBackgroundColor('#17110b');
        this.ensureFallbackTextures();
        this.drawPixelStoreInterior();
        this.applyReplaceableTiles();
        this.drawCounterNpc();
        this.createPlayer();
        this.createControls();
        this.refreshHud();
    }

    update(): void {
        if (!this.player) return;

        if (this.shopOpen) {
            this.stopPlayerBody();

            if (Phaser.Input.Keyboard.JustDown(this.keyE) || Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
                this.closeShop();
                return;
            }

            for (let i = 0; i < this.buyKeys.length; i++) {
                if (Phaser.Input.Keyboard.JustDown(this.buyKeys[i])) {
                    this.buySeed(SEED_CATALOG[i]);
                    break;
                }
            }
            return;
        }

        this.player.update(this.floorZones);

        const nearCounter = this.isPlayerInside(this.counterInteractZone);
        const nearExit = this.isPlayerInside(this.exitZone);
        if (nearCounter) {
            this.promptText.setText('[E] Talk / buy seeds');
            this.promptText.setPosition(this.scale.width / 2, 314);
            this.promptText.setAlpha(1);
        } else if (nearExit) {
            this.promptText.setText('Leaving store…');
            this.promptText.setPosition(this.exitZone.centerX, this.exitZone.y - 24);
            this.promptText.setAlpha(1);
            this.exitToVillage();
            return;
        } else {
            this.promptText.setAlpha(0.35);
            this.promptText.setText('Counter: E buys seeds');
            this.promptText.setPosition(this.scale.width / 2, 314);
        }

        if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
            this.exitToVillage();
            return;
        }

        if (Phaser.Input.Keyboard.JustDown(this.keyE) && nearCounter) {
            this.openShop();
        }
    }

    private drawPixelStoreInterior(): void {
        const w = this.scale.width;
        const h = this.scale.height;
        const cx = w / 2;

        const wall = this.add.tileSprite(cx, 124, w, 248, STORE_WALL_FALLBACK_KEY)
            .setOrigin(0.5)
            .setDepth(0);
        this.wallTileSprites.push(wall);
        this.add.rectangle(cx, 248, w, 14, 0x2e1a10, 0.92).setDepth(1);

        const floor = this.add.tileSprite(0, FLOOR_TOP, w, Math.max(1, h - FLOOR_TOP), STORE_FLOOR_FALLBACK_KEY)
            .setOrigin(0, 0)
            .setDepth(0);
        this.floorTileSprites.push(floor);

        const grid = this.add.graphics().setDepth(1);
        grid.lineStyle(1, 0x3e352d, 0.22);
        for (let y = FLOOR_TOP; y <= h; y += TILE) grid.lineBetween(0, y, w, y);
        for (let x = 0; x <= w; x += TILE) grid.lineBetween(x, FLOOR_TOP, x, h);

        // Wall shelves and seed sacks.
        this.add.rectangle(190, 104, 250, 88, 0x3b2416, 0.94).setStrokeStyle(3, 0x9d6b35, 1).setDepth(2);
        this.add.rectangle(190, 104, 222, 10, 0xd99b4a, 1).setDepth(3);
        this.add.rectangle(w - 190, 104, 250, 88, 0x3b2416, 0.94).setStrokeStyle(3, 0x9d6b35, 1).setDepth(2);
        this.add.rectangle(w - 190, 104, 222, 10, 0xd99b4a, 1).setDepth(3);

        for (let i = 0; i < 4; i++) {
            this.add.circle(105 + i * 58, 124, 13, [0xd89a3a, 0x7fb45e, 0x8a6ed8, 0xbb4f4f][i], 1).setDepth(4);
            this.add.circle(w - 275 + i * 58, 124, 13, [0x8a6ed8, 0xd89a3a, 0x7fb45e, 0xbb4f4f][i], 1).setDepth(4);
        }

        this.add.text(cx, 36, 'Seed Store', {
            fontSize: '30px',
            color: '#ffde8f',
            fontFamily: 'monospace',
            fontStyle: 'bold',
            stroke: '#2a1208',
            strokeThickness: 5,
        }).setOrigin(0.5).setDepth(60);

        this.coinsText = this.add.text(w - 18, 18, '', {
            fontSize: '17px',
            color: '#fff1a8',
            fontFamily: 'monospace',
            fontStyle: 'bold',
            stroke: '#2a1208',
            strokeThickness: 4,
            backgroundColor: '#5a341bee',
            padding: { x: 12, y: 7 },
        }).setOrigin(1, 0).setDepth(130);

        const exitX = cx;
        const exitY = h - 36;
        this.add.rectangle(exitX, exitY, EXIT_W, EXIT_H, 0x4a3826, 1)
            .setStrokeStyle(2, 0xffde8f, 0.65)
            .setDepth(2);
        this.add.text(exitX, exitY, 'EXIT', {
            fontSize: '12px',
            color: '#fff1a8',
            fontFamily: 'monospace',
            stroke: '#2a1208',
            strokeThickness: 3,
        }).setOrigin(0.5).setDepth(3);

        this.exitZone = new Phaser.Geom.Rectangle(exitX - EXIT_W / 2, exitY - EXIT_H / 2, EXIT_W, EXIT_H);
        this.floorZones = [
            { x: 0, y: FLOOR_TOP, width: w, height: h - FLOOR_TOP, type: 'wood', color: 0x75685b },
        ];
        this.physics.world.setBounds(0, FLOOR_TOP, w, h - FLOOR_TOP);
    }

    private drawCounterNpc(): void {
        const cx = this.scale.width / 2;
        const counterY = 242;

        this.add.rectangle(cx, counterY, 580, 76, 0x7b4a25, 1)
            .setStrokeStyle(4, 0x2c1509, 1)
            .setDepth(20);
        this.add.rectangle(cx, counterY - 30, 600, 18, 0xc28745, 1)
            .setStrokeStyle(2, 0xf1bf6d, 0.7)
            .setDepth(21);
        this.add.rectangle(cx, counterY + 12, 540, 5, 0x4a2814, 0.65).setDepth(22);

        this.counterCollider = this.add.rectangle(cx, counterY + 5, 600, 88, 0xff0000, 0)
            .setDepth(21);
        this.physics.add.existing(this.counterCollider, true);

        this.counterInteractZone = new Phaser.Geom.Rectangle(cx - 320, counterY + 40, 640, 100);

        const npcX = cx - 190;
        this.add.circle(npcX, counterY - 76, 18, 0xffcf92, 1).setDepth(25);
        this.add.rectangle(npcX, counterY - 42, 36, 46, 0x4f7fd8, 1)
            .setStrokeStyle(2, 0x1a2a4a, 0.9)
            .setDepth(24);
        this.add.rectangle(npcX, counterY - 93, 42, 10, 0x2c1b10, 1).setDepth(26);
        this.add.text(npcX, counterY - 122, 'Shopkeeper', {
            fontSize: '11px',
            color: '#ffffff',
            fontFamily: 'monospace',
            stroke: '#000000',
            strokeThickness: 3,
        }).setOrigin(0.5).setDepth(50);

        this.dialogueText = this.add.text(cx, counterY + 82,
            'Shopkeeper: Welcome. Press E at the counter to buy seeds.',
            {
                fontSize: '15px',
                color: '#2b1609',
                fontFamily: 'monospace',
                align: 'center',
                backgroundColor: '#f0c982ee',
                padding: { x: 14, y: 9 },
                wordWrap: { width: 690 },
            }
        ).setOrigin(0.5).setDepth(80);

        this.promptText = this.add.text(cx, counterY + 120, 'Counter: E buys seeds', {
            fontSize: '13px',
            color: '#ffee77',
            fontFamily: 'monospace',
            stroke: '#000000',
            strokeThickness: 3,
        }).setOrigin(0.5).setAlpha(0.35).setDepth(90);
    }

    private createPlayer(): void {
        const startX = this.exitZone.centerX;
        const startY = this.exitZone.y - 48;
        this.player = new Player(this, startX, startY);
        this.player.sprite.setDepth(35);
        if (this.counterCollider) {
            this.physics.add.collider(this.player.sprite, this.counterCollider);
        }
    }

    private createControls(): void {
        this.keyE = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
        this.keyEsc = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
        this.buyKeys = [
            Phaser.Input.Keyboard.KeyCodes.ONE,
            Phaser.Input.Keyboard.KeyCodes.TWO,
            Phaser.Input.Keyboard.KeyCodes.THREE,
            Phaser.Input.Keyboard.KeyCodes.FOUR,
            Phaser.Input.Keyboard.KeyCodes.FIVE,
            Phaser.Input.Keyboard.KeyCodes.SIX,
        ].map((keyCode) => this.input.keyboard!.addKey(keyCode));
    }

    private isPlayerInside(rect: Phaser.Geom.Rectangle): boolean {
        if (!this.player) return false;
        return Phaser.Geom.Rectangle.Contains(rect, this.player.sprite.x, this.player.sprite.y);
    }

    private stopPlayerBody(): void {
        const body = this.player?.sprite.body as Phaser.Physics.Arcade.Body | undefined;
        body?.setVelocity(0, 0);
        body?.setAcceleration(0, 0);
    }

    private openShop(): void {
        if (this.shopOpen) return;
        this.shopOpen = true;
        this.stopPlayerBody();
        this.dialogueText.setText('Shopkeeper: Choose a seedling bag. Press 1–6 or click a slot to buy one.');
        this.drawShopPanel();
    }

    private closeShop(): void {
        if (!this.shopOpen) return;
        this.shopOpen = false;
        this.shopContainer?.destroy(true);
        this.shopContainer = undefined;
        this.dialogueText.setText('Shopkeeper: Come back when you need more seeds.');
    }

    private drawShopPanel(): void {
        this.shopContainer?.destroy(true);

        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2 + 96;
        const children: Phaser.GameObjects.GameObject[] = [];

        const panel = this.add.graphics();
        panel.fillStyle(0x000000, 0.42);
        panel.fillRoundedRect(-PANEL_W / 2 + 10, -PANEL_H / 2 + 10, PANEL_W, PANEL_H, 16);
        panel.fillStyle(0x754522, 0.99);
        panel.fillRoundedRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 16);
        panel.lineStyle(8, 0x2a1208, 1);
        panel.strokeRoundedRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 16);
        panel.lineStyle(3, 0xf2c26d, 0.85);
        panel.strokeRoundedRect(-PANEL_W / 2 + 12, -PANEL_H / 2 + 12, PANEL_W - 24, PANEL_H - 24, 11);
        panel.fillStyle(0xf7ddb0, 0.99);
        panel.fillRoundedRect(-PANEL_W / 2 + 26, -PANEL_H / 2 + 58, PANEL_W - 52, PANEL_H - 110, 10);
        children.push(panel);

        children.push(this.add.text(0, -PANEL_H / 2 + 30, 'Seed Catalog', {
            fontSize: '25px',
            color: '#fff1a8',
            fontFamily: 'monospace',
            fontStyle: 'bold',
            stroke: '#2a1208',
            strokeThickness: 4,
        }).setOrigin(0.5));

        children.push(this.add.text(PANEL_W / 2 - 112, -PANEL_H / 2 + 30, `◈ ${FarmState.coins}`, {
            fontSize: '16px',
            color: '#fff1a8',
            fontFamily: 'monospace',
            fontStyle: 'bold',
            backgroundColor: '#2a1208cc',
            padding: { x: 10, y: 5 },
        }).setOrigin(0.5));

        const startY = -PANEL_H / 2 + 96;
        SEED_CATALOG.forEach((item, index) => {
            const y = startY + index * ROW_H;
            const canAfford = FarmState.coins >= item.price;
            const rowColor = canAfford ? (index % 2 === 0 ? 0xecc783 : 0xddb36d) : 0xb89a72;

            const rowBg = this.add.rectangle(0, y, PANEL_W - 92, ROW_H - 8, rowColor, 1)
                .setStrokeStyle(2, canAfford ? 0x7b4a25 : 0x7d6b55, 0.85)
                .setInteractive({ useHandCursor: true })
                .on('pointerdown', () => this.buySeed(item));
            children.push(rowBg);

            const iconSlot = this.add.rectangle(-PANEL_W / 2 + 82, y, 50, 42, 0x7b4a25, 0.88)
                .setStrokeStyle(2, 0x2a1208, 0.9);
            children.push(iconSlot);

            const icon = this.add.image(-PANEL_W / 2 + 82, y + 10, `shop-seedling-${item.variant}`)
                .setOrigin(0.5, 1)
                .setAlpha(canAfford ? 1 : 0.55);
            const iconScale = Math.min(34 / icon.width, 32 / icon.height, 0.085);
            icon.setScale(iconScale);
            children.push(icon);

            const textColor = canAfford ? '#2b1609' : '#614b36';
            const owned = FarmState.getSeedCount(item.variant);
            children.push(this.add.text(-PANEL_W / 2 + 122, y - 17, `[${index + 1}] ${item.seedName}`, {
                fontSize: '14px',
                color: textColor,
                fontFamily: 'monospace',
                fontStyle: 'bold',
            }));
            children.push(this.add.text(-PANEL_W / 2 + 122, y + 6, `${item.cropName} seedling`, {
                fontSize: '11px',
                color: canAfford ? '#5d351b' : '#715f4d',
                fontFamily: 'monospace',
            }));
            children.push(this.add.text(PANEL_W / 2 - 198, y - 10, `${item.price}c`, {
                fontSize: '15px',
                color: canAfford ? '#4f2d15' : '#715f4d',
                fontFamily: 'monospace',
                fontStyle: 'bold',
            }).setOrigin(1, 0));
            children.push(this.add.text(PANEL_W / 2 - 56, y - 10, `owned: ${owned}`, {
                fontSize: '12px',
                color: canAfford ? '#4f2d15' : '#715f4d',
                fontFamily: 'monospace',
            }).setOrigin(1, 0));
        });

        children.push(this.add.text(0, PANEL_H / 2 - 26, 'Click/press 1–6 to buy.  E or ESC closes catalog.', {
            fontSize: '13px',
            color: '#fff1a8',
            fontFamily: 'monospace',
            stroke: '#2a1208',
            strokeThickness: 3,
        }).setOrigin(0.5));

        this.shopContainer = this.add.container(cx, cy, children).setDepth(120);
    }

    private buySeed(item: SeedDefinition): void {
        const result = FarmState.buySeed(item.variant, 1);
        this.dialogueText.setText(`Shopkeeper: ${result.message}`);
        this.refreshHud();
        if (this.shopOpen) this.drawShopPanel();
    }

    private refreshHud(): void {
        this.coinsText?.setText(`◈ ${FarmState.coins}`);
    }

    private exitToVillage(): void {
        this.scene.start('GameScene', this.returnSpawn ? { spawn: this.returnSpawn } : undefined);
    }

    private ensureFallbackTextures(): void {
        this.createCheckerTile(STORE_FLOOR_FALLBACK_KEY, 0x75685b, 0x6a5e52, 0x3e352d);
        this.createCheckerTile(STORE_WALL_FALLBACK_KEY, 0x5b3821, 0x4b2d1a, 0x2e1a10);
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
        loadFirstAvailableImageTexture(this, STORE_FLOOR_CUSTOM_KEY, STORE_FLOOR_CANDIDATES, (key) => {
            this.floorTileSprites.forEach((tile) => { if (tile.scene) tile.setTexture(key); });
        });
        loadFirstAvailableImageTexture(this, STORE_WALL_CUSTOM_KEY, STORE_WALL_CANDIDATES, (key) => {
            this.wallTileSprites.forEach((tile) => { if (tile.scene) tile.setTexture(key); });
        });
    }

}
