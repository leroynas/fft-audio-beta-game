/**
 * Prop.ts — Interactive world prop entity.
 *
 * v15 farming loop:
 *  - Plant props are empty planter interaction points on a fresh session.
 *  - Press E with the hoe selected to plant the first owned seed.
 *  - Press E with the watering can selected to water a planted seed.
 *  - Crops only start their growth timer after watering.
 *  - Stage/state persists while moving between map, house, store and future facilities.
 */
import Phaser from 'phaser';
import {
    BuildingVariant,
    EnterableSceneKey,
    PlantGrowthStage,
    PlantVariant,
    PropType,
} from '../types';
import { FarmState, SEED_CATALOG } from '../gameData';

/** Prop visual color mapping (fallbacks for primitive props) */
const PROP_COLORS: Record<string, number> = {
    keys:   0xc0c0c0,
    cloth:  0x8866aa,
    barrel: 0x8b5e3c,
    door:   0x6b4226,
    building: 0xffffff,
};

const BUILDING_TEXTURE_KEYS: Record<BuildingVariant, string> = {
    house: 'object-house',
    store: 'object-store',
};

/** Default interaction radius */
const DEFAULT_INTERACT_RADIUS = 60;

/** Growth timing is intentionally quick for testing. Increase these later for the full game loop. */
const GROW_TO_STAGE_2_MS = 5000;
const GROW_TO_STAGE_3_MS = 10000;
const GROW_TO_STAGE_4_MS = 15000;

interface PlantVisualConfig {
    scale: number;
    x: number;
    y: number;
}

/**
 * Per-crop visual calibration. The source PNGs have different canvas sizes and
 * visual weight, so a single origin/scale makes beet, carrot and radish look
 * like they float above the planter. These offsets lock the crop base to the
 * planter soil line.
 */
const DEFAULT_PLANT_VISUAL: PlantVisualConfig = { scale: 0.043, x: 0, y: 8 };
const PLANT_VISUALS: Partial<Record<PlantVariant, PlantVisualConfig>> = {
    beat_beet:        { scale: 0.042, x: 0,  y: 8 },
    crescendo_carrot: { scale: 0.038, x: -1, y: 8 },
    echo_eggplant:    { scale: 0.042, x: 0,  y: 8 },
    melody_melon:     { scale: 0.040, x: -2, y: 9 },
    rhythm_radish:    { scale: 0.039, x: 0,  y: 8 },
    treble_turnip:    { scale: 0.041, x: 0,  y: 8 },
    vinyl_vine:       { scale: 0.040, x: 1,  y: 8 },
};

function getCropName(variant: PlantVariant): string {
    return SEED_CATALOG.find((entry) => entry.variant === variant)?.cropName ?? 'Crop';
}

export class Prop {
    public type: PropType;
    public sprite: Phaser.GameObjects.Container;
    public label: string;
    public collider?: Phaser.GameObjects.Rectangle;
    public targetScene?: EnterableSceneKey;

    /** Callback fired on normal interaction. */
    public onInteract: (() => void) | null = null;

    /** Callback fired when a plant enters a new visual/sound stage. */
    public onPlantStageChange: ((variant: PlantVariant, stage: PlantGrowthStage) => void) | null = null;

    /** Callback fired when a mature plant is harvested. */
    public onPlantHarvest: ((variant: PlantVariant) => void) | null = null;

    private interactionPoint?: Phaser.Math.Vector2;
    private plantStage: PlantGrowthStage = 1;
    private plantImage?: Phaser.GameObjects.Image;
    private plantVariant: PlantVariant = 'vinyl_vine';
    private plantId = '';
    private plantVisual: PlantVisualConfig = DEFAULT_PLANT_VISUAL;
    private buildingVariant: BuildingVariant = 'house';
    private growthTimer = 0;
    private hasBeenHarvested = false;
    private isPlanted = false;
    private isWatered = false;

    private scene: Phaser.Scene;
    private labelText: Phaser.GameObjects.Text;
    private promptText: Phaser.GameObjects.Text;
    private isAnimating = false;
    private interactRadius: number;

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        type: PropType,
        label: string,
        plantVariant: PlantVariant = 'vinyl_vine',
        buildingVariant: BuildingVariant = 'house',
        targetScene?: EnterableSceneKey
    ) {
        this.scene = scene;
        this.type = type;
        this.label = label;
        this.plantVariant = plantVariant;
        this.plantId = `plot:${Math.round(x)}:${Math.round(y)}`;
        this.plantVisual = PLANT_VISUALS[plantVariant] ?? DEFAULT_PLANT_VISUAL;
        this.buildingVariant = buildingVariant;
        this.targetScene = targetScene;

        const children: Phaser.GameObjects.GameObject[] = [];

        // ---------------------------------------------------
        // PLANT PLOT (starts empty unless state was saved in this session/save)
        // ---------------------------------------------------
        if (type === 'plant') {
            const sessionState = FarmState.getPlantState(this.plantId);
            if (sessionState) {
                this.isPlanted = sessionState.isPlanted === true;
                this.plantVariant = sessionState.plantedVariant ?? this.plantVariant;
                this.plantVisual = PLANT_VISUALS[this.plantVariant] ?? DEFAULT_PLANT_VISUAL;
                this.plantStage = sessionState.stage;
                this.growthTimer = sessionState.elapsedMs;
                this.isWatered = sessionState.watered === true;
                this.hasBeenHarvested = sessionState.harvested === true;
                if (this.hasBeenHarvested) {
                    this.isPlanted = false;
                    this.isWatered = false;
                    this.hasBeenHarvested = false;
                    this.plantStage = 1;
                    this.growthTimer = 0;
                    FarmState.markPlantHarvested(this.plantId);
                }
            } else {
                FarmState.setPlantState(this.plantId, {
                    isPlanted: false,
                    plantedVariant: undefined,
                    stage: this.plantStage,
                    elapsedMs: 0,
                    watered: false,
                    harvested: false,
                });
            }

            if (this.isPlanted) {
                this.plantImage = scene.add.image(
                    this.plantVisual.x,
                    this.plantVisual.y,
                    this.getPlantTextureKey(this.plantStage)
                );
                this.plantImage.setScale(this.plantVisual.scale);
                this.plantImage.setOrigin(0.5, 1);
                this.plantImage.setAlpha(this.hasBeenHarvested ? 0.42 : 1);
                children.push(this.plantImage);
            }

            this.interactRadius = 54;
        }

        // ---------------------------------------------------
        // BUILDING PROP (uses real image)
        // ---------------------------------------------------
        else if (type === 'building') {
            const building = scene.add.image(0, 0, BUILDING_TEXTURE_KEYS[this.buildingVariant]);
            building.setScale(0.5);
            building.setOrigin(0.5, 1);
            children.push(building);

            this.interactRadius = 90;

            const bodyWidth = building.displayWidth;
            const bodyHeight = building.displayHeight;

            this.collider = scene.add.rectangle(x, y - bodyHeight / 2, bodyWidth, bodyHeight, 0xff0000, 0);
            scene.physics.add.existing(this.collider, true);

            this.interactionPoint = new Phaser.Math.Vector2(x, y - 20);
        }

        // ---------------------------------------------------
        // DEFAULT PROPS (rectangles)
        // ---------------------------------------------------
        else {
            const size = type === 'door' ? { w: 48, h: 16 } : { w: 28, h: 28 };
            const gfx = scene.add.graphics();
            gfx.fillStyle(PROP_COLORS[type], 1);
            gfx.fillRoundedRect(-size.w / 2, -size.h / 2, size.w, size.h, 3);
            children.push(gfx);
            this.interactRadius = DEFAULT_INTERACT_RADIUS;
        }

        // ---------------------------------------------------
        // LABEL
        // ---------------------------------------------------
        const labelY = type === 'plant' ? 42 : -80;
        this.labelText = scene.add.text(0, labelY, this.getDisplayLabel(), {
            fontSize: '11px',
            color: '#ffffff',
            fontFamily: 'monospace',
            stroke: '#000000',
            strokeThickness: 3,
        }).setOrigin(0.5).setVisible(false);
        children.push(this.labelText);

        // ---------------------------------------------------
        // INTERACTION PROMPT
        // ---------------------------------------------------
        this.promptText = scene.add.text(0, 20, this.getPromptText(), {
            fontSize: '10px',
            color: '#ffee77',
            fontFamily: 'monospace',
            stroke: '#000000',
            strokeThickness: 2,
        })
        .setOrigin(0.5)
        .setAlpha(0)
        .setVisible(false);
        children.push(this.promptText);

        // ---------------------------------------------------
        // CONTAINER
        // ---------------------------------------------------
        this.sprite = scene.add.container(x, y, children);
        this.sprite.setDepth(type === 'building' ? 1 : 5);

        if (type === 'building') this.sprite.setSize(300, 300);
        else if (type === 'door') this.sprite.setSize(48, 16);
        else this.sprite.setSize(28, 28);
    }

    /** The plant variant identifier used for filenames and sound routing. */
    getPlantVariant(): PlantVariant {
        return this.plantVariant;
    }

    /** Current plant growth stage. Stage 4 is mature and harvestable. */
    getPlantStage(): PlantGrowthStage {
        return this.plantStage;
    }

    isPlantEmpty(): boolean {
        return this.type === 'plant' && !this.isPlanted;
    }

    needsWater(): boolean {
        return this.type === 'plant' && this.isPlanted && !this.isWatered && !this.hasBeenHarvested;
    }

    isPlantMature(): boolean {
        return this.type === 'plant' && this.isPlanted && !this.hasBeenHarvested && this.plantStage === 4;
    }

    /**
     * Call every frame.
     * Checks distance to player and shows/hides prompt.
     */
    updateProximity(playerX: number, playerY: number): boolean {
        let targetX = this.sprite.x;
        let targetY = this.sprite.y;

        if (this.type === 'building' && this.interactionPoint) {
            targetX = this.interactionPoint.x;
            targetY = this.interactionPoint.y;
        }

        const dist = Phaser.Math.Distance.Between(playerX, playerY, targetX, targetY);
        const inRange = dist < this.interactRadius;

        // Keep interactables clean: no floating labels/prompts over buildings,
        // props or planters. Temporary action feedback can still appear after E.
        this.promptText.setAlpha(0).setVisible(false);
        this.labelText.setAlpha(0).setVisible(false);

        return inRange;
    }

    /** Trigger generic interaction animation and callback. */
    interact(): void {
        if (this.isAnimating) return;

        console.log(`[Prop] Interacted with: ${this.label} (${this.type})`);
        this.isAnimating = true;

        const scaleBoost = this.type === 'building' ? 1.05 : 1.3;
        this.scene.tweens.add({
            targets: this.sprite,
            scaleX: scaleBoost,
            scaleY: scaleBoost,
            duration: 120,
            yoyo: true,
            ease: 'Quad.easeOut',
            onComplete: () => {
                this.isAnimating = false;
                this.onInteract?.();
            },
        });
    }

    tryPlantFirstOwnedSeed(): PlantVariant | undefined {
        if (this.type !== 'plant') return undefined;
        if (this.isPlanted && !this.hasBeenHarvested) {
            this.showFloatingText('Already planted', '#cccccc');
            return undefined;
        }

        const plantedVariant = FarmState.consumeFirstOwnedSeed();
        if (!plantedVariant) {
            this.showFloatingText('Buy seeds first', '#ffcf92');
            return undefined;
        }

        this.isPlanted = true;
        this.hasBeenHarvested = false;
        this.isWatered = false;
        this.plantVariant = plantedVariant;
        this.plantVisual = PLANT_VISUALS[plantedVariant] ?? DEFAULT_PLANT_VISUAL;
        this.plantStage = 1;
        this.growthTimer = 0;
        this.ensurePlantImage();
        this.setPlantStage(1, true);
        this.persistPlantState();
        this.labelText.setText(this.getDisplayLabel());
        this.promptText.setText(this.getPromptText());
        this.showFloatingText(`Planted ${getCropName(plantedVariant)}`, '#9df8a6');
        this.onPlantStageChange?.(plantedVariant, 1);
        return plantedVariant;
    }

    tryWater(): boolean {
        if (this.type !== 'plant') return false;
        if (!this.isPlanted) {
            this.showFloatingText('Plant seed first', '#ffcf92');
            return false;
        }
        if (this.hasBeenHarvested) {
            this.showFloatingText('Already harvested', '#cccccc');
            return false;
        }
        if (this.isWatered) {
            this.showFloatingText('Already watered', '#cccccc');
            return false;
        }

        this.isWatered = true;
        this.persistPlantState();
        this.promptText.setText(this.getPromptText());
        this.showFloatingText('Watered', '#a9dfff');
        this.onPlantStageChange?.(this.plantVariant, this.plantStage);
        return true;
    }

    /** Harvest only when the plant has reached stage 4. */
    tryHarvest(): boolean {
        if (this.type !== 'plant' || !this.plantImage) return false;

        if (this.hasBeenHarvested) {
            this.showFloatingText('Already harvested', '#cccccc');
            return false;
        }

        if (!this.isPlanted) {
            this.showFloatingText('Empty planter', '#cccccc');
            return false;
        }

        if (this.plantStage !== 4) {
            this.showFloatingText('Not ready', '#cccccc');
            return false;
        }

        const harvestedVariant = this.plantVariant;
        const harvestedImage = this.plantImage;

        this.onPlantHarvest?.(harvestedVariant);
        this.showFloatingText(`Harvested ${getCropName(harvestedVariant)}`, '#ffee77');

        // After harvest the crop is gone completely. The planter becomes empty
        // again: no faded residue, no hidden mature crop, and it can be replanted.
        this.isPlanted = false;
        this.hasBeenHarvested = false;
        this.isWatered = false;
        this.plantStage = 1;
        this.growthTimer = 0;
        this.plantImage = undefined;
        FarmState.markPlantHarvested(this.plantId);

        this.scene.tweens.add({
            targets: harvestedImage,
            y: harvestedImage.y - 18,
            alpha: 0,
            scaleX: harvestedImage.scaleX * 1.15,
            scaleY: harvestedImage.scaleY * 1.15,
            duration: 220,
            ease: 'Quad.easeOut',
            onComplete: () => harvestedImage.destroy(),
        });

        return true;
    }

    showStatus(message: string, color = '#ffee77'): void {
        this.showFloatingText(message, color);
    }

    private getDisplayLabel(): string {
        if (this.type !== 'plant') return this.label;
        if (!this.isPlanted) return 'Empty Planter';
        if (this.hasBeenHarvested) return `${getCropName(this.plantVariant)} · Done`;
        return getCropName(this.plantVariant);
    }

    private getPromptText(): string {
        if (this.targetScene) return '[E] Enter';

        if (this.type === 'plant') {
            if (!this.isPlanted) return FarmState.getFirstOwnedSeedVariant() ? '[E] Plant seed' : 'Buy seeds first';
            if (this.hasBeenHarvested) return 'Harvested';
            if (!this.isWatered) return '[E] Water first';
            return this.plantStage === 4 ? '[E] Harvest' : `Growing ${this.plantStage}/4`;
        }

        return '[E] Interact';
    }

    private getPlantTextureKey(stage: PlantGrowthStage): string {
        return `${this.plantVariant}_stage${stage}`;
    }

    update(delta: number): void {
        if (this.type !== 'plant') return;
        if (!this.isPlanted) return;
        if (!this.plantImage) return;
        if (this.hasBeenHarvested) return;
        if (!this.isWatered) return;
        if (this.plantStage === 4) return;

        if (!this.plantImage.scene || !this.scene.sys || !this.scene.sys.textures) return;

        this.growthTimer += delta;
        this.persistPlantState();

        if (this.plantStage === 1 && this.growthTimer > GROW_TO_STAGE_2_MS) this.setPlantStage(2);
        if (this.plantStage === 2 && this.growthTimer > GROW_TO_STAGE_3_MS) this.setPlantStage(3);
        if (this.plantStage === 3 && this.growthTimer > GROW_TO_STAGE_4_MS) this.setPlantStage(4);
    }

    private ensurePlantImage(): void {
        if (this.plantImage) {
            this.plantImage.setVisible(true);
            this.plantImage.setAlpha(1);
            return;
        }

        this.plantImage = this.scene.add.image(
            this.plantVisual.x,
            this.plantVisual.y,
            this.getPlantTextureKey(this.plantStage)
        );
        this.plantImage.setScale(this.plantVisual.scale);
        this.plantImage.setOrigin(0.5, 1);
        this.plantImage.setAlpha(1);
        this.sprite.addAt(this.plantImage, 0);
    }

    private setPlantStage(stage: PlantGrowthStage, silent = false): void {
        this.ensurePlantImage();
        if (!this.plantImage) return;

        const textureKey = this.getPlantTextureKey(stage);
        if (!this.scene.textures.exists(textureKey)) {
            console.warn(`[Prop] Missing plant texture: ${textureKey}`);
            return;
        }

        this.plantStage = stage;
        this.plantImage.setTexture(textureKey);
        this.plantImage.setPosition(this.plantVisual.x, this.plantVisual.y);
        this.plantImage.setScale(this.plantVisual.scale);
        this.plantImage.setAlpha(this.hasBeenHarvested ? 0.42 : 1);
        this.persistPlantState();
        this.promptText.setText(this.getPromptText());
        this.labelText.setText(this.getDisplayLabel());

        if (!silent) {
            this.onPlantStageChange?.(this.plantVariant, stage);
            this.scene.tweens.add({
                targets: this.plantImage,
                scaleX: this.plantVisual.scale * 1.12,
                scaleY: this.plantVisual.scale * 1.12,
                duration: 130,
                yoyo: true,
                ease: 'Sine.easeOut',
            });
        }
    }

    private persistPlantState(): void {
        FarmState.setPlantState(this.plantId, {
            isPlanted: this.isPlanted,
            plantedVariant: this.isPlanted ? this.plantVariant : undefined,
            stage: this.plantStage,
            elapsedMs: this.growthTimer,
            watered: this.isWatered,
            harvested: this.hasBeenHarvested,
        });
    }

    private showFloatingText(message: string, color: string): void {
        const txt = this.scene.add.text(this.sprite.x, this.sprite.y - 78, message, {
            fontSize: '10px',
            color,
            fontFamily: 'monospace',
            stroke: '#000000',
            strokeThickness: 3,
        }).setOrigin(0.5).setDepth(20);

        this.scene.tweens.add({
            targets: txt,
            y: txt.y - 26,
            alpha: 0,
            duration: 850,
            ease: 'Quad.easeOut',
            onComplete: () => txt.destroy(),
        });
    }
}
