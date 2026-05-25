/**
 * UI.ts — compact fixed-screen HUD overlay utilities.
 *
 * v13:
 *  - Mode shortcuts are integrated into the mode board.
 *  - Spectrum sits in the upper-right, with the FFT Mix panel directly below.
 *  - Money/gold sits in the lower-left.
 *  - Toolbar is smaller and uses generated pixel-tool icons, including a clear hoe icon.
 *  - HUD counter-scales against camera zoom so it stays locked to the screen.
 *  - Adds a manual Save Progress button; refresh resets unsaved money/state.
 */
import Phaser from 'phaser';
import { AudioMode, FloorType, ToolType } from '../types';
import { MixerSnapshot } from '../audio/AdaptiveMixer';
import { FarmState } from '../gameData';

const MODE_LABELS: Record<AudioMode, string> = {
    classic: 'Mode A · Classic Random',
    live: 'Mode B · Live Drift',
};

const MODE_DESCRIPTIONS: Record<AudioMode, string> = {
    classic: 'WASD move · E interact/use · M mode · 1–4 tools · click SAVE to keep progress',
    live: 'WASD move · E interact/use · M mode · 1–4 tools · stable memory/drift layer',
};

const MODE_COLORS: Record<AudioMode, string> = {
    classic: '#ff927f',
    live: '#9df8a6',
};

const SPEC_MARGIN = 14;
const SPEC_TOP_Y = 14;
const SPEC_BINS = 64;
const SPEC_BAR_W = 2;
const SPEC_BAR_GAP = 0.5;
const SPEC_MAX_H = 44;
const SPEC_PANEL_PAD = 8;
const SPEC_PANEL_W = SPEC_BINS * (SPEC_BAR_W + SPEC_BAR_GAP) + SPEC_PANEL_PAD * 2;
const SPEC_PANEL_H = SPEC_MAX_H + 32;
const LOW_BIN_END = 10;
const MID_BIN_END = 30;

const MIX_PANEL_W = SPEC_PANEL_W;
const MIX_PANEL_H = 86;
const MIX_GAP = 8;

const TOOL_BOX_W = 82;
const TOOL_BOX_H = 42;
const TOOL_GAP = 6;
const TOOLBAR_BOTTOM_MARGIN = 12;
const ZOOM_BOX_W = 36;
const ZOOM_BOX_H = 32;
const ZOOM_GAP = 6;
const SAVE_BOX_W = 64;
const SAVE_BOX_H = 26;

const DB_FLOOR = -60;
const DB_CEIL = 0;

const BAR_COLORS = {
    low: 0x6ba6ff,
    mid: 0xf0b64e,
    high: 0xe776b6,
};

const TOOLS: { key: ToolType; hotkey: string; label: string }[] = [
    { key: 'pickaxe', hotkey: '1', label: 'Pick' },
    { key: 'axe', hotkey: '2', label: 'Axe' },
    { key: 'hoe', hotkey: '3', label: 'Hoe' },
    { key: 'watering_can', hotkey: '4', label: 'Water' },
];

function dbToNorm(db: number): number {
    const safe = Number.isFinite(db) ? db : DB_FLOOR;
    return Math.max(0, Math.min(1, (safe - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
}

function binColor(i: number): number {
    if (i < LOW_BIN_END) return 0xd85d45;
    if (i < MID_BIN_END) return 0xe9bc57;
    return 0x64d8e8;
}

export class UI {
    private scene: Phaser.Scene;
    private hudGfx: Phaser.GameObjects.Graphics;
    private specGfx: Phaser.GameObjects.Graphics;
    private mixGfx: Phaser.GameObjects.Graphics;
    private toolPanel: Phaser.GameObjects.Graphics;
    private zoomPanel: Phaser.GameObjects.Graphics;

    private modeText: Phaser.GameObjects.Text;
    private modeDescText: Phaser.GameObjects.Text;
    private floorText: Phaser.GameObjects.Text;
    private seedText: Phaser.GameObjects.Text;
    private moneyText: Phaser.GameObjects.Text;
    private saveText: Phaser.GameObjects.Text;
    private saveZone: Phaser.GameObjects.Zone;
    private saveStatusText: Phaser.GameObjects.Text;
    private specTitleText: Phaser.GameObjects.Text;
    private mixTitleText: Phaser.GameObjects.Text;
    private mixerStatusText: Phaser.GameObjects.Text;
    private mixValueTexts: Phaser.GameObjects.Text[] = [];

    private toolTexts: Phaser.GameObjects.Text[] = [];
    private toolIcons: Phaser.GameObjects.Image[] = [];
    private toolZones: Phaser.GameObjects.Zone[] = [];
    private zoomTexts: Phaser.GameObjects.Text[] = [];
    private zoomZones: Phaser.GameObjects.Zone[] = [];

    private activeTool: ToolType = 'hoe';
    private onToolSelect?: (tool: ToolType) => void;
    private onZoom?: (direction: number) => void;
    private resizeHandler?: () => void;
    private overlaySyncHandler?: () => void;
    private uiCamera?: Phaser.Cameras.Scene2D.Camera;
    private uiObjects: Phaser.GameObjects.GameObject[] = [];
    private destroyed = false;
    private hudScale = 1;
    private saveStatusUntil = 0;

    constructor(scene: Phaser.Scene, onToolSelect?: (tool: ToolType) => void, onZoom?: (direction: number) => void) {
        this.scene = scene;
        this.onToolSelect = onToolSelect;
        this.onZoom = onZoom;
        this.ensureToolIconTextures();

        this.hudGfx = scene.add.graphics().setScrollFactor(0).setDepth(98);
        this.specGfx = scene.add.graphics().setScrollFactor(0).setDepth(100);
        this.mixGfx = scene.add.graphics().setScrollFactor(0).setDepth(100);
        this.toolPanel = scene.add.graphics().setScrollFactor(0).setDepth(101);
        this.zoomPanel = scene.add.graphics().setScrollFactor(0).setDepth(101);

        const baseText: Phaser.Types.GameObjects.Text.TextStyle = {
            fontFamily: 'monospace',
            color: '#f7ead1',
            stroke: '#2a1208',
            strokeThickness: 3,
        };

        this.modeText = scene.add.text(0, 0, '', {
            ...baseText,
            fontSize: '15px',
            fontStyle: 'bold',
        }).setScrollFactor(0).setDepth(102);

        this.modeDescText = scene.add.text(0, 0, '', {
            ...baseText,
            fontSize: '9px',
            color: '#d9c49e',
            strokeThickness: 2,
            wordWrap: { width: 315 },
        }).setScrollFactor(0).setDepth(102);

        this.floorText = scene.add.text(0, 0, '', {
            ...baseText,
            fontSize: '10px',
            color: '#fff1a8',
            strokeThickness: 2,
        }).setScrollFactor(0).setDepth(102);

        this.seedText = scene.add.text(0, 0, '', {
            ...baseText,
            fontSize: '9px',
            color: '#a9dfff',
            strokeThickness: 2,
        }).setScrollFactor(0).setDepth(102);

        this.specTitleText = scene.add.text(0, 0, 'SPECTRUM 20Hz → 20kHz', {
            ...baseText,
            fontSize: '9px',
            color: '#ffde8f',
            fontStyle: 'bold',
            strokeThickness: 2,
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(102);

        this.mixTitleText = scene.add.text(0, 0, 'FFT MIX', {
            ...baseText,
            fontSize: '9px',
            color: '#ffde8f',
            fontStyle: 'bold',
            strokeThickness: 2,
        }).setOrigin(1, 0).setScrollFactor(0).setDepth(102);

        this.mixerStatusText = scene.add.text(0, 0, '', {
            ...baseText,
            fontSize: '8px',
            color: '#d9c49e',
            strokeThickness: 2,
            wordWrap: { width: SPEC_PANEL_W - 18 },
        }).setScrollFactor(0).setDepth(102);

        for (const label of ['LOW', 'MID', 'HIGH']) {
            this.mixValueTexts.push(scene.add.text(0, 0, label, {
                ...baseText,
                fontSize: '8px',
                color: '#dbc4a0',
                strokeThickness: 2,
            }).setScrollFactor(0).setDepth(102));
        }

        this.moneyText = scene.add.text(0, 0, '', {
            fontSize: '15px',
            color: '#fff1a8',
            fontFamily: 'monospace',
            fontStyle: 'bold',
            stroke: '#2a1208',
            strokeThickness: 4,
        }).setScrollFactor(0).setDepth(110);

        this.saveText = scene.add.text(0, 0, 'SAVE', {
            fontSize: '10px',
            color: '#fff1a8',
            fontFamily: 'monospace',
            fontStyle: 'bold',
            stroke: '#2a1208',
            strokeThickness: 3,
        }).setOrigin(0.5).setScrollFactor(0).setDepth(110);

        this.saveStatusText = scene.add.text(0, 0, '', {
            fontSize: '8px',
            color: '#9df8a6',
            fontFamily: 'monospace',
            stroke: '#2a1208',
            strokeThickness: 2,
        }).setScrollFactor(0).setDepth(110);

        this.saveZone = scene.add.zone(0, 0, SAVE_BOX_W, SAVE_BOX_H)
            .setOrigin(0.5)
            .setScrollFactor(0)
            .setDepth(111)
            .setInteractive({ useHandCursor: true });
        this.saveZone.on('pointerdown', () => {
            FarmState.saveProgress();
            this.saveStatusUntil = performance.now() + 1600;
        });

        this.createToolbar();
        this.createZoomButtons();
        this.registerOverlayObjects();
        this.createOverlayCamera();
        this.reposition(scene);

        this.resizeHandler = () => {
            if (this.destroyed || !this.scene.sys.isActive()) return;
            this.reposition(scene);
        };
        scene.scale.on('resize', this.resizeHandler);
        this.overlaySyncHandler = () => this.syncOverlayCamera();
        scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.overlaySyncHandler);
        scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
        scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroy());
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.resizeHandler) {
            this.scene.scale.off('resize', this.resizeHandler);
            this.resizeHandler = undefined;
        }
        if (this.overlaySyncHandler) {
            this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.overlaySyncHandler);
            this.overlaySyncHandler = undefined;
        }
        if (this.uiCamera && this.scene.cameras.cameras.includes(this.uiCamera)) {
            this.scene.cameras.remove(this.uiCamera);
            this.uiCamera = undefined;
        }
    }

    update(mode: AudioMode, floor: FloorType, mixer?: MixerSnapshot, seed?: string, tool: ToolType = this.activeTool): void {
        if (this.destroyed || !this.modeText.scene) return;

        this.reposition(this.scene);
        this.redrawHudChrome(mode);
        this.redrawToolbar();
        this.redrawZoomButtons();

        this.moneyText.setText(`◈ ${FarmState.coins}`);
        this.saveStatusText.setText(performance.now() < this.saveStatusUntil ? 'saved' : (FarmState.hasManualSave ? 'manual save' : 'fresh run'));
        this.saveStatusText.setColor(performance.now() < this.saveStatusUntil ? '#9df8a6' : '#d9c49e');
        this.modeText.setText(MODE_LABELS[mode]);
        this.modeText.setColor(MODE_COLORS[mode]);
        this.modeDescText.setText(MODE_DESCRIPTIONS[mode]);
        this.floorText.setText(`Floor: ${floor.toUpperCase()}`);
        this.seedText.setText(seed ? `Seed: ${seed} · locked` : 'Seed: locked');
        this.setActiveTool(tool);

        if (mixer) {
            this.drawSpectrogram(mixer);
            this.drawFFTMix(mixer);
            this.mixerStatusText.setText(mixer.statusText);
            this.mixerStatusText.setColor(
                mixer.lowDucking || mixer.midCutting || mixer.compressorEngaged ? '#ffde8f' : '#9df8a6'
            );
        }
    }

    setActiveTool(tool: ToolType): void {
        if (this.destroyed || this.activeTool === tool) return;
        this.activeTool = tool;
        this.redrawToolbar();
    }

    private sx(x: number): number { return x; }
    private sy(y: number): number { return y; }


    private registerOverlayObjects(): void {
        this.uiObjects = [
            this.hudGfx,
            this.specGfx,
            this.mixGfx,
            this.toolPanel,
            this.zoomPanel,
            this.modeText,
            this.modeDescText,
            this.floorText,
            this.seedText,
            this.moneyText,
            this.saveText,
            this.saveStatusText,
            this.saveZone,
            this.specTitleText,
            this.mixTitleText,
            this.mixerStatusText,
            ...this.mixValueTexts,
            ...this.toolTexts,
            ...this.toolIcons,
            ...this.toolZones,
            ...this.zoomTexts,
            ...this.zoomZones,
        ];
    }

    private createOverlayCamera(): void {
        const cam = this.scene.cameras.add(0, 0, this.scene.scale.width, this.scene.scale.height);
        cam.setName('HUDOverlayCamera');
        cam.setScroll(0, 0);
        cam.setZoom(1);
        cam.setRoundPixels(true);
        this.uiCamera = cam;

        this.scene.cameras.main.ignore(this.uiObjects);
        this.syncOverlayCamera();
    }

    private syncOverlayCamera(): void {
        if (this.destroyed || !this.uiCamera) return;
        this.uiCamera.setViewport(0, 0, this.scene.scale.width, this.scene.scale.height);
        this.uiCamera.setScroll(0, 0);
        this.uiCamera.setZoom(1);

        const uiSet = new Set(this.uiObjects);
        const nonUiObjects = this.scene.children.getChildren().filter((obj) => !uiSet.has(obj));
        this.uiCamera.ignore(nonUiObjects);
        this.scene.cameras.main.ignore(this.uiObjects);
    }

    private refreshHudScale(): void {
        // A separate HUD camera renders the overlay at screen-space zoom 1.
        // Therefore the UI itself should never counter-scale against the world
        // camera. Zoom buttons only zoom the world/character camera.
        this.hudScale = 1;

        const scalable: Phaser.GameObjects.GameObject[] = [
            this.hudGfx,
            this.specGfx,
            this.mixGfx,
            this.toolPanel,
            this.zoomPanel,
            this.modeText,
            this.modeDescText,
            this.floorText,
            this.seedText,
            this.moneyText,
            this.saveText,
            this.saveStatusText,
            this.saveZone,
            this.specTitleText,
            this.mixTitleText,
            this.mixerStatusText,
            ...this.mixValueTexts,
            ...this.toolTexts,
            ...this.toolIcons,
            ...this.toolZones,
            ...this.zoomTexts,
            ...this.zoomZones,
        ];

        for (const obj of scalable) {
            const scalableObj = obj as Phaser.GameObjects.GameObject & { scene?: Phaser.Scene; setScale?: (x: number, y?: number) => void };
            if (scalableObj.scene && scalableObj.setScale) scalableObj.setScale(this.hudScale);
        }
    }

    private redrawHudChrome(mode: AudioMode): void {
        if (this.destroyed || !this.hudGfx.scene) return;
        this.hudGfx.clear();
        this.hudGfx.setScale(this.hudScale);

        // Compact mode/shortcut board.
        this.hudGfx.fillStyle(0x000000, 0.28);
        this.hudGfx.fillRoundedRect(16 + 3, 16 + 3, 330, 82, 10);
        this.hudGfx.fillStyle(0x332116, 0.94);
        this.hudGfx.fillRoundedRect(16, 16, 330, 82, 10);
        this.hudGfx.lineStyle(3, 0x2a1208, 1);
        this.hudGfx.strokeRoundedRect(16, 16, 330, 82, 10);
        this.hudGfx.lineStyle(2, mode === 'live' ? 0x9df8a6 : 0xff927f, 0.86);
        this.hudGfx.strokeRoundedRect(21, 21, 320, 72, 8);

        // Gold badge bottom-left.
        const h = this.scene.scale.height;
        this.hudGfx.fillStyle(0x000000, 0.26);
        this.hudGfx.fillRoundedRect(17, h - 53, 196, 38, 10);
        this.hudGfx.fillStyle(0x5a341b, 0.96);
        this.hudGfx.fillRoundedRect(14, h - 56, 196, 38, 10);
        this.hudGfx.lineStyle(3, 0xffde8f, 0.86);
        this.hudGfx.strokeRoundedRect(14, h - 56, 196, 38, 10);
        this.hudGfx.fillStyle(0x2f2116, 0.92);
        this.hudGfx.fillRoundedRect(138, h - 50, SAVE_BOX_W, SAVE_BOX_H, 8);
        this.hudGfx.lineStyle(2, 0xc28745, 0.92);
        this.hudGfx.strokeRoundedRect(138, h - 50, SAVE_BOX_W, SAVE_BOX_H, 8);
    }

    private drawSpectrogram(mixer: MixerSnapshot): void {
        this.specGfx.clear();
        this.specGfx.setScale(this.hudScale);

        const bins = mixer.fftBins;
        const w = this.scene.scale.width;
        const panelX = w - SPEC_PANEL_W - SPEC_MARGIN;
        const panelY = SPEC_TOP_Y;
        const startX = panelX + SPEC_PANEL_PAD;
        const startY = panelY + 24;

        this.specGfx.fillStyle(0x000000, 0.28);
        this.specGfx.fillRoundedRect(panelX + 3, panelY + 3, SPEC_PANEL_W, SPEC_PANEL_H, 8);
        this.specGfx.fillStyle(0x211812, 0.92);
        this.specGfx.fillRoundedRect(panelX, panelY, SPEC_PANEL_W, SPEC_PANEL_H, 8);
        this.specGfx.lineStyle(2, 0x7d4b25, 0.95);
        this.specGfx.strokeRoundedRect(panelX, panelY, SPEC_PANEL_W, SPEC_PANEL_H, 8);

        this.specGfx.lineStyle(1, 0xf0c46a, 0.32);
        this.specGfx.lineBetween(startX, startY + SPEC_MAX_H + 2, startX + SPEC_BINS * (SPEC_BAR_W + SPEC_BAR_GAP), startY + SPEC_MAX_H + 2);

        const binCount = Math.min(SPEC_BINS, bins?.length ?? 0);
        for (let i = 0; i < binCount; i++) {
            const norm = dbToNorm(bins[i]);
            const barH = Math.max(1, norm * SPEC_MAX_H);
            const x = startX + i * (SPEC_BAR_W + SPEC_BAR_GAP);
            const y = startY + SPEC_MAX_H - barH;
            this.specGfx.fillStyle(binColor(i), 0.88);
            this.specGfx.fillRect(x, y, SPEC_BAR_W, barH);
        }

        // Visual x-axis band markers so the complete horizontal axis reads clearly.
        this.specGfx.fillStyle(0xf7d28a, 0.82);
        this.specGfx.fillRect(startX, startY + SPEC_MAX_H + 5, 20, 2);
        this.specGfx.fillRect(startX + 54, startY + SPEC_MAX_H + 5, 35, 2);
        this.specGfx.fillRect(startX + 118, startY + SPEC_MAX_H + 5, 45, 2);
    }

    private drawFFTMix(mixer: MixerSnapshot): void {
        this.mixGfx.clear();
        this.mixGfx.setScale(this.hudScale);

        const w = this.scene.scale.width;
        const panelX = w - MIX_PANEL_W - SPEC_MARGIN;
        const panelY = SPEC_TOP_Y + SPEC_PANEL_H + MIX_GAP;
        const labelX = panelX + 12;
        const barX = panelX + 52;
        const barW = MIX_PANEL_W - 82;
        const rows = [
            { label: 'LOW',  db: mixer.lowDb,  gain: mixer.lowGainDb,  color: BAR_COLORS.low,  active: mixer.lowDucking },
            { label: 'MID',  db: mixer.midDb,  gain: mixer.midGainDb,  color: BAR_COLORS.mid,  active: mixer.midCutting },
            { label: 'HIGH', db: mixer.highDb, gain: mixer.highGainDb, color: BAR_COLORS.high, active: mixer.compressorEngaged },
        ];

        this.mixGfx.fillStyle(0x000000, 0.28);
        this.mixGfx.fillRoundedRect(panelX + 3, panelY + 3, MIX_PANEL_W, MIX_PANEL_H, 8);
        this.mixGfx.fillStyle(0x211812, 0.92);
        this.mixGfx.fillRoundedRect(panelX, panelY, MIX_PANEL_W, MIX_PANEL_H, 8);
        this.mixGfx.lineStyle(2, 0x7d4b25, 0.95);
        this.mixGfx.strokeRoundedRect(panelX, panelY, MIX_PANEL_W, MIX_PANEL_H, 8);

        rows.forEach((row, i) => {
            const y = panelY + 23 + i * 18;
            const norm = dbToNorm(row.db);
            this.mixGfx.fillStyle(0x110d09, 0.88);
            this.mixGfx.fillRoundedRect(barX, y, barW, 9, 3);
            this.mixGfx.fillStyle(row.color, row.active ? 1 : 0.72);
            this.mixGfx.fillRoundedRect(barX, y, Math.max(3, barW * norm), 9, 3);

            if (Math.abs(row.gain) > 0.25) {
                this.mixGfx.fillStyle(row.gain < 0 ? 0xff604e : 0x9df8a6, 0.9);
                this.mixGfx.fillRoundedRect(barX + barW - 18, y - 1, 16, 11, 3);
            }

            this.mixValueTexts[i].setText(`${row.label} ${row.gain >= 0 ? '+' : ''}${row.gain.toFixed(1)}dB`);
            this.mixValueTexts[i].setPosition(this.sx(labelX), this.sy(y - 3));
            this.mixValueTexts[i].setColor(row.active ? '#fff1a8' : '#dbc4a0');
        });
    }

    private createToolbar(): void {
        const style: Phaser.Types.GameObjects.Text.TextStyle = {
            fontSize: '9px',
            color: '#f6d9a7',
            fontFamily: 'monospace',
            align: 'center',
            stroke: '#2a1208',
            strokeThickness: 2,
        };

        for (const tool of TOOLS) {
            const icon = this.scene.add.image(0, 0, `tool-icon-${tool.key}`)
                .setOrigin(0.5)
                .setScrollFactor(0)
                .setDepth(102);
            const text = this.scene.add.text(0, 0, `${tool.hotkey} ${tool.label}`, style)
                .setOrigin(0.5)
                .setScrollFactor(0)
                .setDepth(102);
            const zone = this.scene.add.zone(0, 0, TOOL_BOX_W, TOOL_BOX_H)
                .setOrigin(0.5)
                .setScrollFactor(0)
                .setDepth(103)
                .setInteractive({ useHandCursor: true });
            zone.on('pointerdown', () => this.onToolSelect?.(tool.key));
            this.toolIcons.push(icon);
            this.toolTexts.push(text);
            this.toolZones.push(zone);
        }
    }

    private createZoomButtons(): void {
        const style: Phaser.Types.GameObjects.Text.TextStyle = {
            fontSize: '17px',
            color: '#fff1a8',
            fontFamily: 'monospace',
            align: 'center',
            fontStyle: 'bold',
            stroke: '#2a1208',
            strokeThickness: 3,
        };

        [{ label: '−', direction: -1 }, { label: '+', direction: 1 }].forEach((button) => {
            const text = this.scene.add.text(0, 0, button.label, style)
                .setOrigin(0.5)
                .setScrollFactor(0)
                .setDepth(102);
            const zone = this.scene.add.zone(0, 0, ZOOM_BOX_W, ZOOM_BOX_H)
                .setOrigin(0.5)
                .setScrollFactor(0)
                .setDepth(103)
                .setInteractive({ useHandCursor: true });
            zone.on('pointerdown', () => this.onZoom?.(button.direction));
            this.zoomTexts.push(text);
            this.zoomZones.push(zone);
        });
    }

    private reposition(scene: Phaser.Scene): void {
        if (this.destroyed || !this.modeText.scene) return;
        this.refreshHudScale();

        const w = scene.scale.width;
        const h = scene.scale.height;
        const specPanelX = w - SPEC_PANEL_W - SPEC_MARGIN;
        const mixPanelY = SPEC_TOP_Y + SPEC_PANEL_H + MIX_GAP;

        this.modeText.setPosition(this.sx(31), this.sy(27));
        this.modeDescText.setPosition(this.sx(31), this.sy(50));
        this.floorText.setPosition(this.sx(31), this.sy(74));
        this.seedText.setPosition(this.sx(135), this.sy(74));

        this.specTitleText.setPosition(this.sx(w - SPEC_MARGIN - 8), this.sy(SPEC_TOP_Y + 6));
        this.mixTitleText.setPosition(this.sx(w - SPEC_MARGIN - 8), this.sy(mixPanelY + 6));
        this.mixerStatusText.setPosition(this.sx(specPanelX + 12), this.sy(mixPanelY + 67));
        this.moneyText.setPosition(this.sx(34), this.sy(h - 47));
        this.saveText.setPosition(this.sx(170), this.sy(h - 37));
        this.saveZone.setPosition(this.sx(170), this.sy(h - 37));
        this.saveStatusText.setPosition(this.sx(34), this.sy(h - 22));

        this.repositionToolbar(scene);
        this.repositionZoomButtons(scene);
    }

    private repositionToolbar(scene: Phaser.Scene): void {
        const totalW = TOOLS.length * TOOL_BOX_W + (TOOLS.length - 1) * TOOL_GAP;
        const startX = (scene.scale.width - totalW) / 2 + TOOL_BOX_W / 2;
        const y = scene.scale.height - TOOLBAR_BOTTOM_MARGIN - TOOL_BOX_H / 2;

        for (let i = 0; i < TOOLS.length; i++) {
            const x = startX + i * (TOOL_BOX_W + TOOL_GAP);
            this.toolIcons[i]?.setPosition(this.sx(x), this.sy(y - 8));
            this.toolTexts[i]?.setPosition(this.sx(x), this.sy(y + 13));
            this.toolZones[i]?.setPosition(this.sx(x), this.sy(y));
        }
    }

    private repositionZoomButtons(scene: Phaser.Scene): void {
        const totalW = 2 * ZOOM_BOX_W + ZOOM_GAP;
        const startX = scene.scale.width - totalW - 16 + ZOOM_BOX_W / 2;
        const y = scene.scale.height - TOOLBAR_BOTTOM_MARGIN - ZOOM_BOX_H / 2;

        for (let i = 0; i < this.zoomTexts.length; i++) {
            const x = startX + i * (ZOOM_BOX_W + ZOOM_GAP);
            this.zoomTexts[i]?.setPosition(this.sx(x), this.sy(y));
            this.zoomZones[i]?.setPosition(this.sx(x), this.sy(y));
        }
    }

    private redrawZoomButtons(): void {
        if (this.destroyed || !this.zoomPanel.scene) return;
        this.zoomPanel.clear();
        this.zoomPanel.setScale(this.hudScale);

        const totalW = 2 * ZOOM_BOX_W + ZOOM_GAP;
        const startX = this.scene.scale.width - totalW - 16 + ZOOM_BOX_W / 2;
        const y = this.scene.scale.height - TOOLBAR_BOTTOM_MARGIN - ZOOM_BOX_H / 2;

        for (let i = 0; i < this.zoomTexts.length; i++) {
            const cx = startX + i * (ZOOM_BOX_W + ZOOM_GAP);
            const x = cx - ZOOM_BOX_W / 2;
            const top = y - ZOOM_BOX_H / 2;
            this.zoomPanel.fillStyle(0x000000, 0.24);
            this.zoomPanel.fillRoundedRect(x + 2, top + 2, ZOOM_BOX_W, ZOOM_BOX_H, 8);
            this.zoomPanel.fillStyle(0x5a341b, 0.94);
            this.zoomPanel.fillRoundedRect(x, top, ZOOM_BOX_W, ZOOM_BOX_H, 8);
            this.zoomPanel.lineStyle(2, 0xffde8f, 0.82);
            this.zoomPanel.strokeRoundedRect(x + 2, top + 2, ZOOM_BOX_W - 4, ZOOM_BOX_H - 4, 6);
        }
    }

    private redrawToolbar(): void {
        if (this.destroyed || !this.toolPanel.scene) return;
        this.toolPanel.clear();
        this.toolPanel.setScale(this.hudScale);

        const totalW = TOOLS.length * TOOL_BOX_W + (TOOLS.length - 1) * TOOL_GAP;
        const startX = (this.scene.scale.width - totalW) / 2 + TOOL_BOX_W / 2;
        const y = this.scene.scale.height - TOOLBAR_BOTTOM_MARGIN - TOOL_BOX_H / 2;

        this.toolPanel.fillStyle(0x000000, 0.22);
        this.toolPanel.fillRoundedRect(startX - TOOL_BOX_W / 2 - 8 + 3, y - TOOL_BOX_H / 2 - 7 + 3, totalW + 16, TOOL_BOX_H + 14, 12);
        this.toolPanel.fillStyle(0x2f2116, 0.92);
        this.toolPanel.fillRoundedRect(startX - TOOL_BOX_W / 2 - 8, y - TOOL_BOX_H / 2 - 7, totalW + 16, TOOL_BOX_H + 14, 12);
        this.toolPanel.lineStyle(2, 0x7d4b25, 1);
        this.toolPanel.strokeRoundedRect(startX - TOOL_BOX_W / 2 - 8, y - TOOL_BOX_H / 2 - 7, totalW + 16, TOOL_BOX_H + 14, 12);

        for (let i = 0; i < TOOLS.length; i++) {
            const tool = TOOLS[i];
            const selected = tool.key === this.activeTool;
            const cx = startX + i * (TOOL_BOX_W + TOOL_GAP);
            const x = cx - TOOL_BOX_W / 2;
            const top = y - TOOL_BOX_H / 2;

            this.toolPanel.fillStyle(selected ? 0x8d5a2d : 0x4b2d1a, selected ? 0.99 : 0.86);
            this.toolPanel.fillRoundedRect(x, top, TOOL_BOX_W, TOOL_BOX_H, 8);
            this.toolPanel.lineStyle(selected ? 3 : 1, selected ? 0xffde8f : 0xc28745, selected ? 1 : 0.72);
            this.toolPanel.strokeRoundedRect(x + 3, top + 3, TOOL_BOX_W - 6, TOOL_BOX_H - 6, 7);
            this.toolTexts[i]?.setColor(selected ? '#fff1a8' : '#f6d9a7');
            this.toolIcons[i]?.setAlpha(selected ? 1 : 0.78);
        }
    }

    private ensureToolIconTextures(): void {
        const scene = this.scene;
        if (scene.textures.exists('tool-icon-hoe')) return;

        const makeIcon = (key: string, draw: (g: Phaser.GameObjects.Graphics) => void): void => {
            const g = scene.add.graphics();
            draw(g);
            g.generateTexture(key, 32, 32);
            g.destroy();
        };

        makeIcon('tool-icon-pickaxe', (g) => {
            g.lineStyle(4, 0x4f3822, 1); g.lineBetween(10, 24, 23, 10);
            g.lineStyle(4, 0xc8c8c8, 1); g.lineBetween(7, 10, 25, 7);
            g.lineStyle(2, 0xf2e2b2, 1); g.lineBetween(20, 7, 27, 14);
        });
        makeIcon('tool-icon-axe', (g) => {
            g.lineStyle(4, 0x4f3822, 1); g.lineBetween(13, 25, 22, 8);
            g.fillStyle(0xc8c8c8, 1); g.fillTriangle(17, 7, 28, 10, 19, 18);
            g.lineStyle(2, 0x707070, 1); g.strokeTriangle(17, 7, 28, 10, 19, 18);
        });
        makeIcon('tool-icon-hoe', (g) => {
            g.lineStyle(4, 0x4f3822, 1); g.lineBetween(12, 25, 22, 7);
            g.lineStyle(4, 0xc8c8c8, 1); g.lineBetween(21, 7, 29, 11);
            g.lineStyle(3, 0xc8c8c8, 1); g.lineBetween(28, 11, 24, 18);
        });
        makeIcon('tool-icon-watering_can', (g) => {
            g.fillStyle(0x6bb6d8, 1); g.fillRoundedRect(8, 13, 15, 11, 3);
            g.lineStyle(3, 0x3a7f9c, 1); g.strokeRoundedRect(8, 13, 15, 11, 3);
            g.lineStyle(3, 0x6bb6d8, 1); g.lineBetween(22, 15, 29, 11);
            g.lineStyle(2, 0xa9e8ff, 0.8); g.strokeCircle(12, 13, 5);
            g.fillStyle(0xa9e8ff, 0.9); g.fillCircle(28, 17, 2); g.fillCircle(25, 21, 2);
        });
    }
}
