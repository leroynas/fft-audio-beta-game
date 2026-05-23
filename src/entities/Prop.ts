/**
 * Prop.ts — Interactive world prop entity.
 *
 * Renders interactive world props and handles proximity-based
 * interaction when the player presses E.
 */
import Phaser from 'phaser';
import { PropType } from '../types';

/** Prop visual color mapping (fallbacks for primitive props) */
const PROP_COLORS: Record<string, number> = {
    keys:   0xc0c0c0,
    cloth:  0x8866aa,
    barrel: 0x8b5e3c,
    door:   0x6b4226,
    building: 0xffffff,
};

/** Default interaction radius */
const DEFAULT_INTERACT_RADIUS = 60;
const BUILDING_INTERACT_RADIUS = 180;

export class Prop {
    public type: PropType;
    public sprite: Phaser.GameObjects.Container;
    public label: string;
    public collider?: Phaser.GameObjects.Rectangle;
    private interactionPoint?: Phaser.Math.Vector2;
    private plantStage = 1; // For plant growth stages (1-4)
    private plantImage?: Phaser.GameObjects.Image;
    private growthTimer = 0;

    /** Callback fired on interaction */
    public onInteract: (() => void) | null = null;

    private scene: Phaser.Scene;
    private promptText: Phaser.GameObjects.Text;
    private isAnimating = false;
    private interactRadius: number;

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        type: PropType,
        label: string
    ) {
        this.scene = scene;
        this.type = type;
        this.label = label;

        const children: Phaser.GameObjects.GameObject[] = [];

        // ---------------------------------------------------
        // BUILDING PROP (uses real image)
        // ---------------------------------------------------
        if (type === 'plant') {
            this.plantImage = scene.add.image(0, 0, 'plant');

            this.plantImage.setScale(0.05);
            this.plantImage.setOrigin(0.5, 1);

            children.push(this.plantImage);

            this.interactRadius = 50;
        }

        // ---------------------------------------------------
        // BUILDING PROP (uses real image)
        // ---------------------------------------------------
        else if (type === 'building') {
            const house = scene.add.image(0, 0, 'object-house');

            house.setScale(0.5);
            house.setOrigin(0.5, 1);

            children.push(house);

            this.interactRadius = 70;

            // --------------------------------------------------
            // SOLID COLLISION BODY
            // --------------------------------------------------

            const bodyWidth = house.displayWidth;
            const bodyHeight = house.displayHeight;

            // Collision near bottom of house
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
        const txt = scene.add.text(0, -80, label, {
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
        this.promptText = scene.add.text(0, 20, '[E] Interact', {
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

        this.promptText.setAlpha(inRange ? 1 : 0);

        // Move prompt to door area
        if (this.type === 'building') {
            this.promptText.setPosition(0, -30);
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
            },
        });

        this.onInteract?.();
    }

    update(delta: number): void {
    if (this.type !== 'plant') return;
    if (!this.plantImage) return;

    this.growthTimer += delta;

    // Stage 1 → Stage 2 after 5 seconds
    if (this.plantStage === 1 && this.growthTimer > 5000) {
        this.plantStage = 2;
        this.plantImage.setTexture('plant_stage2');
    }

    // Stage 2 → Stage 3 after 10 seconds
    if (this.plantStage === 2 && this.growthTimer > 10000) {
        this.plantStage = 3;
        this.plantImage.setTexture('plant_stage3');
    }

    // Stage 3 → Stage 4 after 15 seconds
    if (this.plantStage === 3 && this.growthTimer > 15000) {
        this.plantStage = 4;
        this.plantImage.setTexture('plant_stage4');
    }
}
}