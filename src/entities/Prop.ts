/**
 * Prop.ts — Interactive world prop entity.
 *
 * Renders interactive world props, plant growth stages, mature-plant
 * harvesting, and proximity-based interaction when the player presses E.
 */
import Phaser from 'phaser';
import {
    BuildingVariant,
    EnterableSceneKey,
    PlantGrowthStage,
    PlantVariant,
    PropType,
} from '../types';
import { FarmState } from '../gameData';

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
    // Mature crop PNGs are very large compared with the planter art. These
    // values keep the visible crop inside the soil box and align the base to
    // the same soil line for every plant.
    beat_beet:        { scale: 0.042, x: 0,  y: 8 },
    crescendo_carrot: { scale: 0.038, x: -1, y: 8 },
    echo_eggplant:    { scale: 0.042, x: 0,  y: 8 },
    melody_melon:     { scale: 0.040, x: -2, y: 9 },
    rhythm_radish:    { scale: 0.039, x: 0,  y: 8 },
    treble_turnip:    { scale: 0.041, x: 0,  y: 8 },
    vinyl_vine:       { scale: 0.040, x: 1,  y: 8 },
};

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

    private scene: Phaser.Scene;
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
        this.plantId = `${plantVariant}:${Math.round(x)}:${Math.round(y)}`;
        this.plantVisual = PLANT_VISUALS[plantVariant] ?? DEFAULT_PLANT_VISUAL;
        this.buildingVariant = buildingVariant;
        this.targetScene = targetScene;

        const children: Phaser.GameObjects.GameObject[] = [];

        // ---------------------------------------------------
        // PLANT PROP (uses stage-specific real images)
        // ---------------------------------------------------
        if (type === 'plant') {
            const sessionState = FarmState.getPlantState(this.plantId);
            if (sessionState) {
                this.plantStage = sessionState.stage;
                this.growthTimer = sessionState.elapsedMs;
                this.hasBeenHarvested = sessionState.harvested === true;
            } else {
                FarmState.setPlantState(this.plantId, { stage: this.plantStage, elapsedMs: this.growthTimer });
            }

            this.plantImage = scene.add.image(this.plantVisual.x, this.plantVisual.y, this.getPlantTextureKey(this.plantStage));
            this.plantImage.setScale(this.plantVisual.scale);
            this.plantImage.setOrigin(0.5, 1);
            this.plantImage.setAlpha(this.hasBeenHarvested ? 0.42 : 1);

            children.push(this.plantImage);

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

            // --------------------------------------------------
            // SOLID COLLISION BODY
            // --------------------------------------------------

            const bodyWidth = building.displayWidth;
            const bodyHeight = building.displayHeight;

            // Collision near bottom of house/store.
            this.collider = scene.add.rectangle(
                x,
                y - bodyHeight / 2,
                bodyWidth,
                bodyHeight,
                0xff0000,
                0
            );

            scene.physics.add.existing(this.collider, true);

            // --------------------------------------------------
            // INTERACTION POINT (front door area)
            // --------------------------------------------------

            this.interactionPoint = new Phaser.Math.Vector2(
                x,
                y - 20
            );
        }

        // ---------------------------------------------------
        // DEFAULT PROPS (rectangles)
        // ---------------------------------------------------
        else {
            const size =
                type === 'door'
                    ? { w: 48, h: 16 }
                    : { w: 28, h: 28 };

            const gfx = scene.add.graphics();

            gfx.fillStyle(PROP_COLORS[type], 1);

            gfx.fillRoundedRect(
                -size.w / 2,
                -size.h / 2,
                size.w,
                size.h,
                3
            );

            children.push(gfx);

            this.interactRadius = DEFAULT_INTERACT_RADIUS;
        }

        // ---------------------------------------------------
        // LABEL
        // ---------------------------------------------------
        const labelY = type === 'plant' ? 42 : -80;
        const txt = scene.add.text(0, labelY, label, {
            fontSize: '11px',
            color: '#ffffff',
            fontFamily: 'monospace',
            stroke: '#000000',
            strokeThickness: 3,
        }).setOrigin(0.5);

        children.push(txt);

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
        .setAlpha(0);

        children.push(this.promptText);

        // ---------------------------------------------------
        // CONTAINER
        // ---------------------------------------------------
        this.sprite = scene.add.container(x, y, children);

        this.sprite.setDepth(type === 'building' ? 1 : 5);

        // Bigger container for buildings
        if (type === 'building') {
            this.sprite.setSize(300, 300);
        } else if (type === 'door') {
            this.sprite.setSize(48, 16);
        } else {
            this.sprite.setSize(28, 28);
        }
    }

    /** The plant variant identifier used for filenames and sound routing. */
    getPlantVariant(): PlantVariant {
        return this.plantVariant;
    }

    /** Current plant growth stage. Stage 4 is mature and harvestable. */
    getPlantStage(): PlantGrowthStage {
        return this.plantStage;
    }

    isPlantMature(): boolean {
        return this.type === 'plant' && this.plantStage === 4;
    }

    /**
     * Call every frame.
     * Checks distance to player and shows/hides prompt.
     */
    updateProximity(playerX: number, playerY: number): boolean {
        let targetX = this.sprite.x;
        let targetY = this.sprite.y;

        // Buildings interact at the front door area
        if (this.type === 'building' && this.interactionPoint) {
            targetX = this.interactionPoint.x;
            targetY = this.interactionPoint.y;
        }

        const dist = Phaser.Math.Distance.Between(
            playerX,
            playerY,
            targetX,
            targetY
        );

        const inRange = dist < this.interactRadius;

        this.promptText.setText(this.getPromptText());
        this.promptText.setAlpha(inRange ? 1 : 0);

        // Move prompt to door area
        if (this.type === 'building') {
            this.promptText.setPosition(0, -30);
        } else if (this.type === 'plant') {
            this.promptText.setPosition(0, 56);
        }

        return inRange;
    }

    /** Trigger interaction */
    interact(): void {
        if (this.isAnimating) return;

        console.log(
            `[Prop] Interacted with: ${this.label} (${this.type})`
        );

        this.isAnimating = true;

        // Smaller animation for large buildings
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

    /** Harvest only when the plant has reached stage 4. */
    tryHarvest(): boolean {
        if (this.type !== 'plant' || !this.plantImage) {
            return false;
        }

        if (this.hasBeenHarvested) {
            this.showFloatingText('Already harvested', '#cccccc');
            return false;
        }

        if (this.plantStage !== 4) {
            this.showFloatingText('Not ready', '#cccccc');
            return false;
        }

        this.hasBeenHarvested = true;
        FarmState.markPlantHarvested(this.plantId);
        this.onPlantHarvest?.(this.plantVariant);
        this.showFloatingText(`Harvested ${this.label}`, '#ffee77');

        this.scene.tweens.add({
            targets: this.plantImage,
            y: this.plantImage.y - 18,
            alpha: 0,
            scaleX: this.plantImage.scaleX * 1.15,
            scaleY: this.plantImage.scaleY * 1.15,
            duration: 220,
            ease: 'Quad.easeOut',
            onComplete: () => {
                if (!this.plantImage) return;
                // Do not restart the growth cycle. In one play session a crop
                // grows once, remains mature across interiors, and after harvest
                // stays in a harvested visual state until a new session/manual
                // save load decides otherwise.
                this.plantImage.setAlpha(0.42);
                this.plantImage.setPosition(this.plantVisual.x, this.plantVisual.y);
                this.plantImage.setScale(this.plantVisual.scale);
                this.promptText.setText(this.getPromptText());
            },
        });

        return true;
    }

    private getPromptText(): string {
        if (this.targetScene) return '[E] Enter';

        if (this.type === 'plant') {
            if (this.hasBeenHarvested) return 'Harvested';
            return this.plantStage === 4
                ? '[E] Harvest'
                : `Growing ${this.plantStage}/4`;
        }

        return '[E] Interact';
    }

    private getPlantTextureKey(stage: PlantGrowthStage): string {
        return `${this.plantVariant}_stage${stage}`;
    }

    update(delta: number): void {
        if (this.type !== 'plant') return;
        if (!this.plantImage) return;
        if (this.hasBeenHarvested) return;

        // When GameScene is switched/restarted, Phaser destroys this image.
        // Old Prop objects can briefly still receive an update during the same
        // frame, so never call setTexture on an orphaned/destroyed Image.
        if (!this.plantImage.scene || !this.scene.sys || !this.scene.sys.textures) return;

        this.growthTimer += delta;
        FarmState.setPlantState(this.plantId, {
            stage: this.plantStage,
            elapsedMs: this.growthTimer,
            harvested: this.hasBeenHarvested,
        });

        if (this.plantStage === 1 && this.growthTimer > GROW_TO_STAGE_2_MS) {
            this.setPlantStage(2);
        }

        if (this.plantStage === 2 && this.growthTimer > GROW_TO_STAGE_3_MS) {
            this.setPlantStage(3);
        }

        if (this.plantStage === 3 && this.growthTimer > GROW_TO_STAGE_4_MS) {
            this.setPlantStage(4);
        }
    }

    private setPlantStage(stage: PlantGrowthStage, silent = false): void {
        if (!this.plantImage) return;

        const textureKey = this.getPlantTextureKey(stage);

        if (!this.scene.textures.exists(textureKey)) {
            console.warn(`[Prop] Missing plant texture: ${textureKey}`);
            return;
        }

        this.plantStage = stage;
        this.plantImage.setTexture(textureKey);
        FarmState.setPlantState(this.plantId, {
            stage: this.plantStage,
            elapsedMs: this.growthTimer,
            harvested: this.hasBeenHarvested,
        });
        this.promptText.setText(this.getPromptText());

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
