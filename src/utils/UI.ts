/**
 * UI.ts — DOM-based canvas overlay HUD.
 *
 * The previous Phaser HUD was repeatedly affected by world camera zoom. This
 * version is a normal HTML overlay pinned to the actual canvas rectangle, so
 * zooming the character/world never moves or scales the buttons, toolbar,
 * money, analyser, mode board or inventory.
 */
import Phaser from 'phaser';
import { AudioMode, FloorType, PlantVariant, ToolType } from '../types';
import { MixerSnapshot } from '../audio/AdaptiveMixer';
import { FarmState, SEED_CATALOG } from '../gameData';

const MODE_LABELS: Record<AudioMode, string> = {
    classic: 'Mode A · Random Sample List',
    live: 'Mode B · Adaptive Drift',
};

const MODE_DESCRIPTIONS: Record<AudioMode, string> = {
    classic: 'Each event picks one prepared sample, for example stone_01 / stone_02.',
    live: 'Adaptive continuity: movement shapes pitch, brightness, weight and timing over time.',
};

const MODE_COLORS: Record<AudioMode, string> = {
    classic: '#be4622',
    live: '#1c8db9',
};

const TOOLS: { key: ToolType; label: string; icon: string }[] = [
    { key: 'pickaxe', label: 'Pickaxe', icon: '⛏' },
    { key: 'axe', label: 'Axe', icon: '🪓' },
    { key: 'hoe', label: 'Hoe', icon: '🪏' },
    { key: 'watering_can', label: 'Water', icon: '🚿' },
];

const PLANT_ASSETS: Record<PlantVariant, { folder: string; filePrefix: string }> = {
    beat_beet: { folder: 'Beat_Beet', filePrefix: 'Beatbeet' },
    crescendo_carrot: { folder: 'Crescendo_Carrot', filePrefix: 'CrescendoCarrot' },
    echo_eggplant: { folder: 'Echo_Eggplant', filePrefix: 'EchoEggplant' },
    melody_melon: { folder: 'Melody_Melon', filePrefix: 'MelodyMelon' },
    rhythm_radish: { folder: 'Rhythm_Radish', filePrefix: 'RhythmRadish' },
    treble_turnip: { folder: 'Treble_Turnip', filePrefix: 'TrebleTurnip' },
    vinyl_vine: { folder: 'Vinyl_Vine', filePrefix: 'VinylVine' },
};

const DB_FLOOR = -60;
const DB_CEIL = 0;
const SPEC_BINS = 64;

function dbToNorm(db: number): number {
    const safe = Number.isFinite(db) ? db : DB_FLOOR;
    return Math.max(0, Math.min(1, (safe - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
}

function plantImageUrl(variant: PlantVariant, stage: 2 | 4): string {
    const asset = PLANT_ASSETS[variant];
    const suffix = stage === 2 ? '02_Sprout' : '04_Mature';
    return `/assets/sprites/Plants/plants/${asset.folder}/${asset.filePrefix}_${suffix}.png`;
}

function clearChildren(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function makeEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className = '',
    text = ''
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
}

export class UI {
    private root: HTMLDivElement;

    private modePanel: HTMLDivElement;
    private modeTitle: HTMLDivElement;
    private modeDesc: HTMLDivElement;
    private floorText: HTMLDivElement;

    private moneyText: HTMLDivElement;
    private saveButton: HTMLButtonElement;
    private resetButton: HTMLButtonElement;
    private saveStatus: HTMLDivElement;

    private toolbar: HTMLDivElement;
    private zoomPanel: HTMLDivElement;

    private spectrumPanel: HTMLDivElement;
    private spectrumBars: HTMLDivElement[] = [];

    private mixPanel: HTMLDivElement;
    private mixRows: { row: HTMLDivElement; fill: HTMLDivElement; text: HTMLDivElement }[] = [];

    private inventoryPanel: HTMLDivElement;
    private toolButtons = new Map<ToolType, HTMLButtonElement>();

    private activeTool: ToolType = 'hoe';
    private inventoryOpen = false;

    private onToolSelect?: (tool: ToolType) => void;
    private onZoom?: (direction: number) => void;

    private saveStatusUntil = 0;
    private destroyed = false;

    private readonly canvas: HTMLCanvasElement;
    private readonly overlayHost: HTMLElement;
    private readonly usesBodyFallback: boolean;
    private readonly resizeHandler: () => void;

    constructor(
        scene: Phaser.Scene,
        onToolSelect?: (tool: ToolType) => void,
        onZoom?: (direction: number) => void
    ) {
        this.onToolSelect = onToolSelect;
        this.onZoom = onZoom;

        this.canvas = scene.game.canvas;
        this.overlayHost = document.getElementById('game-container') ?? this.canvas.parentElement ?? document.body;
        this.usesBodyFallback = this.overlayHost === document.body;
        this.resizeHandler = () => this.syncToCanvas();

        this.root = makeEl('div', 'stardew-hud-overlay') as HTMLDivElement;
        this.overlayHost.appendChild(this.root);

        window.addEventListener('resize', this.resizeHandler, { passive: true });
        this.syncToCanvas();

        this.modePanel = makeEl('div', 'hud-panel mode-panel') as HTMLDivElement;
        this.modeTitle = makeEl('div', 'mode-title') as HTMLDivElement;
        this.modeDesc = makeEl('div', 'mode-desc') as HTMLDivElement;
        this.floorText = makeEl('div', 'mode-floor') as HTMLDivElement;
        this.modePanel.append(this.modeTitle, this.modeDesc, this.floorText);

        const wallet = makeEl('div', 'hud-panel wallet-panel compact-wallet-panel') as HTMLDivElement;
        const walletRow = makeEl('div', 'compact-wallet-row') as HTMLDivElement;

        this.moneyText = makeEl('div', 'money-text compact-money-text') as HTMLDivElement;

        const saveActions = makeEl('div', 'save-actions compact-save-actions') as HTMLDivElement;

        this.saveButton = makeEl('button', 'save-button compact-save-button', 'SAVE') as HTMLButtonElement;
        this.saveButton.title = 'Save your current farm progress';
        this.saveButton.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            FarmState.saveProgress();

            this.saveStatusUntil = performance.now() + 1500;
            this.saveStatus.textContent = 'saved';
            this.saveStatus.classList.remove('hidden');

            this.renderInventory();
        });

        this.resetButton = makeEl(
            'button',
            'save-button reset-save-button compact-save-button compact-reset-button',
            'RESET'
        ) as HTMLButtonElement;

        this.resetButton.title = 'Reset the manual save file';
        this.resetButton.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();

            const confirmed = window.confirm(
                'Reset your save file? This removes your manual save and restarts the farm.'
            );

            if (!confirmed) return;

            FarmState.resetProgress();

            this.saveStatusUntil = performance.now() + 1500;
            this.saveStatus.textContent = 'reset';
            this.saveStatus.classList.remove('hidden');

            window.location.reload();
        });

        this.saveStatus = makeEl('div', 'save-status compact-save-status hidden') as HTMLDivElement;

        saveActions.append(this.saveButton, this.resetButton);
        walletRow.append(this.moneyText, saveActions);
        wallet.append(walletRow, this.saveStatus);

        this.toolbar = makeEl('div', 'hud-panel tool-panel') as HTMLDivElement;

        for (const tool of TOOLS) {
            const btn = makeEl('button', 'tool-button') as HTMLButtonElement;
            btn.dataset.tool = tool.key;
            btn.innerHTML = `<span class="tool-icon">${tool.icon}</span><span class="tool-label">${tool.label}</span>`;

            btn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.onToolSelect?.(tool.key);
            });

            this.toolbar.appendChild(btn);
            this.toolButtons.set(tool.key, btn);
        }

        this.zoomPanel = makeEl('div', 'hud-panel zoom-panel') as HTMLDivElement;

        const zoomOut = makeEl('button', 'zoom-button', '−') as HTMLButtonElement;
        const zoomIn = makeEl('button', 'zoom-button', '+') as HTMLButtonElement;

        zoomOut.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this.onZoom?.(-1);
        });

        zoomIn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            this.onZoom?.(1);
        });

        this.zoomPanel.append(zoomOut, zoomIn);

        this.spectrumPanel = makeEl('div', 'hud-panel spectrum-panel') as HTMLDivElement;

        const specTitle = makeEl('div', 'analysis-title', 'SPECTRUM') as HTMLDivElement;
        const specBars = makeEl('div', 'spectrum-bars') as HTMLDivElement;

        for (let i = 0; i < SPEC_BINS; i++) {
            const bar = makeEl('div', 'spectrum-bar') as HTMLDivElement;
            bar.style.height = '2px';
            specBars.appendChild(bar);
            this.spectrumBars.push(bar);
        }

        const axis = makeEl('div', 'spectrum-axis') as HTMLDivElement;
        axis.innerHTML = '<span>20Hz</span><span>1k</span><span>20k</span>';

        this.spectrumPanel.append(specTitle, specBars, axis);

        this.mixPanel = makeEl('div', 'hud-panel mix-panel') as HTMLDivElement;

        const mixTitle = makeEl('div', 'analysis-title', 'FFT MIX') as HTMLDivElement;
        this.mixPanel.appendChild(mixTitle);

        for (const band of ['LOW', 'MID', 'HIGH']) {
            const row = makeEl('div', 'mix-row') as HTMLDivElement;
            const label = makeEl('span', 'mix-label', band) as HTMLSpanElement;
            const track = makeEl('div', 'mix-track') as HTMLDivElement;
            const fill = makeEl('div', `mix-fill ${band.toLowerCase()}`) as HTMLDivElement;
            const text = makeEl('span', 'mix-value', '+0.0dB') as HTMLSpanElement;

            track.appendChild(fill);
            row.append(label, track, text);
            this.mixPanel.appendChild(row);

            this.mixRows.push({
                row,
                fill,
                text: text as HTMLDivElement,
            });
        }

        this.inventoryPanel = makeEl('div', 'inventory-panel hidden') as HTMLDivElement;

        this.root.append(
            this.modePanel,
            wallet,
            this.spectrumPanel,
            this.mixPanel,
            this.toolbar,
            this.zoomPanel,
            this.inventoryPanel
        );

        scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
        scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.destroy());

        this.updateActiveTool();
    }

    destroy(): void {
        if (this.destroyed) return;

        this.destroyed = true;

        window.removeEventListener('resize', this.resizeHandler);
        this.root.remove();
    }

    private syncToCanvas(): void {
        if (this.destroyed) return;

        if (!this.usesBodyFallback) {
            this.root.style.left = '';
            this.root.style.top = '';
            this.root.style.width = '';
            this.root.style.height = '';
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const style = this.root.style;
        style.position = 'fixed';
        style.left = `${rect.left}px`;
        style.top = `${rect.top}px`;
        style.width = `${rect.width}px`;
        style.height = `${rect.height}px`;
    }

    update(
        mode: AudioMode,
        floor: FloorType,
        mixer?: MixerSnapshot,
        _seed?: string,
        tool: ToolType = this.activeTool
    ): void {
        if (this.destroyed) return;

        this.syncToCanvas();

        this.activeTool = tool;

        this.modeTitle.textContent = MODE_LABELS[mode];
        this.modeTitle.style.color = MODE_COLORS[mode];
        this.modePanel.style.setProperty('--mode-color', MODE_COLORS[mode]);

        this.modeDesc.textContent = MODE_DESCRIPTIONS[mode];
        this.floorText.textContent = `Floor: ${floor.toUpperCase()}`;

        this.moneyText.textContent = `◈ ${FarmState.coins}`;

        const showSaveStatus = performance.now() < this.saveStatusUntil;

        this.saveStatus.classList.toggle('saved-now', showSaveStatus);
        this.saveStatus.classList.toggle('hidden', !showSaveStatus);

        if (!showSaveStatus) {
            this.saveStatus.textContent = '';
        }

        this.updateActiveTool();

        if (mixer) {
            this.updateAnalysis(mixer);
        }

        if (this.inventoryOpen) {
            this.renderInventory();
        }
    }

    toggleInventory(): void {
        this.inventoryOpen = !this.inventoryOpen;
        this.inventoryPanel.classList.toggle('hidden', !this.inventoryOpen);
        this.renderInventory();
    }

    isInventoryOpen(): boolean {
        return this.inventoryOpen;
    }

    setActiveTool(tool: ToolType): void {
        this.activeTool = tool;
        this.updateActiveTool();
    }

    private updateActiveTool(): void {
        for (const [tool, btn] of this.toolButtons) {
            btn.classList.toggle('active', tool === this.activeTool);
        }
    }

    private updateAnalysis(mixer: MixerSnapshot): void {
        const bins = mixer.fftBins;

        for (let i = 0; i < this.spectrumBars.length; i++) {
            const norm = dbToNorm(bins?.[i] ?? -60);
            this.spectrumBars[i].style.height = `${Math.max(2, Math.round(norm * 46))}px`;
            this.spectrumBars[i].style.opacity = `${0.35 + norm * 0.65}`;
        }

        const rows = [
            {
                db: mixer.lowDb,
                gain: mixer.lowGainDb,
                active: mixer.lowDucking,
            },
            {
                db: mixer.midDb,
                gain: mixer.midGainDb,
                active: mixer.midCutting,
            },
            {
                db: mixer.highDb,
                gain: mixer.highGainDb,
                active: mixer.compressorEngaged,
            },
        ];

        rows.forEach((row, i) => {
            const norm = dbToNorm(row.db);

            this.mixRows[i].fill.style.width = `${Math.max(4, norm * 100)}%`;
            this.mixRows[i].text.textContent = `${Math.round(row.db)}dB`;
            this.mixRows[i].row.classList.toggle('active', row.active);
        });
    }

    private renderInventory(): void {
        if (!this.inventoryOpen) {
            clearChildren(this.inventoryPanel);
            return;
        }

        clearChildren(this.inventoryPanel);

        const frame = makeEl('div', 'inventory-frame') as HTMLDivElement;

        const header = makeEl('div', 'inventory-header') as HTMLDivElement;
        header.innerHTML = '<span>Bag</span><span class="inventory-close-hint">TAB</span>';
        frame.appendChild(header);

        const content = makeEl('div', 'inventory-content') as HTMLDivElement;

        const toolsSection = makeEl('section', 'inventory-section') as HTMLElement;
        toolsSection.appendChild(makeEl('h3', '', 'Tools'));

        const toolsGrid = makeEl('div', 'inventory-grid tools-grid') as HTMLDivElement;

        for (const tool of TOOLS) {
            const slot = makeEl(
                'button',
                `inventory-slot tool-slot ${tool.key === this.activeTool ? 'active' : ''}`
            ) as HTMLButtonElement;

            slot.innerHTML = `<span class="inventory-tool-icon">${tool.icon}</span><span>${tool.label}</span>`;

            slot.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                this.onToolSelect?.(tool.key);
            });

            toolsGrid.appendChild(slot);
        }

        toolsSection.appendChild(toolsGrid);
        content.appendChild(toolsSection);

        const ownedSeeds = SEED_CATALOG.filter((item) => FarmState.getSeedCount(item.variant) > 0);
        const ownedHarvests = SEED_CATALOG.filter((item) => FarmState.getHarvestCount(item.variant) > 0);

        const bagSection = makeEl('section', 'inventory-section bag-section') as HTMLElement;
        bagSection.appendChild(makeEl('h3', '', 'Plants / Seeds'));

        const itemsGrid = makeEl('div', 'inventory-grid items-grid') as HTMLDivElement;

        for (const item of ownedSeeds) {
            itemsGrid.appendChild(
                this.createInventoryItem(
                    plantImageUrl(item.variant, 2),
                    item.seedName.replace(' Seeds', ''),
                    FarmState.getSeedCount(item.variant),
                    'Seed'
                )
            );
        }

        for (const item of ownedHarvests) {
            itemsGrid.appendChild(
                this.createInventoryItem(
                    plantImageUrl(item.variant, 4),
                    item.cropName,
                    FarmState.getHarvestCount(item.variant),
                    'Crop'
                )
            );
        }

        if (ownedSeeds.length === 0 && ownedHarvests.length === 0) {
            itemsGrid.appendChild(
                makeEl('div', 'inventory-empty', 'Your bag has no seeds or harvested plants yet.')
            );
        }

        bagSection.appendChild(itemsGrid);
        content.appendChild(bagSection);

        frame.appendChild(content);
        this.inventoryPanel.appendChild(frame);
    }

    private createInventoryItem(
        src: string,
        label: string,
        count: number,
        tag: string
    ): HTMLDivElement {
        const slot = makeEl('div', 'inventory-slot item-slot') as HTMLDivElement;

        const img = makeEl('img', 'inventory-item-img') as HTMLImageElement;
        img.src = src;
        img.alt = label;

        const meta = makeEl('div', 'inventory-item-meta') as HTMLDivElement;
        meta.append(
            makeEl('strong', '', label),
            makeEl('span', '', `${tag} × ${count}`)
        );

        slot.append(img, meta);

        return slot;
    }
}