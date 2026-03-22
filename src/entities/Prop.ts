/**
 * Prop.ts — Interactive world prop entity.
 *
 * Renders a labeled sprite/rectangle and handles proximity-based
 * interaction when the player presses E.
 */
import Phaser from 'phaser';
import { PropType } from '../types';

/** Prop visual color mapping (placeholder until real sprites) */
const PROP_COLORS: Record<PropType, number> = {
    keys:   0xc0c0c0,   // silver
    cloth:  0x8866aa,   // purple-ish
    barrel: 0x8b5e3c,   // dark wood
    door:   0x6b4226,   // dark brown
};

/** Distance (px) at which the player can interact */
const INTERACT_RADIUS = 60;

export class Prop {
    public type: PropType;
    public sprite: Phaser.GameObjects.Container;
    public label: string;

    /** Callback fired on interaction — set by the scene / audio system */
    public onInteract: (() => void) | null = null;

    private scene: Phaser.Scene;
    private promptText: Phaser.GameObjects.Text;
    private isAnimating = false;

    constructor(scene: Phaser.Scene, x: number, y: number, type: PropType, label: string) {
        this.scene = scene;
        this.type = type;
        this.label = label;

        // --- Visual: colored rectangle + label ---
        const size = type === 'door' ? { w: 48, h: 16 } : { w: 28, h: 28 };
        const gfx = scene.add.graphics();
        gfx.fillStyle(PROP_COLORS[type], 1);
        gfx.fillRoundedRect(-size.w / 2, -size.h / 2, size.w, size.h, 3);

        const txt = scene.add.text(0, -size.h / 2 - 14, label, {
            fontSize: '11px',
            color: '#ffffff',
            fontFamily: 'monospace',
        }).setOrigin(0.5);

        // "Press E" prompt (hidden by default)
        this.promptText = scene.add.text(0, size.h / 2 + 8, '[E] Interact', {
            fontSize: '10px',
            color: '#ffee77',
            fontFamily: 'monospace',
        }).setOrigin(0.5).setAlpha(0);

        this.sprite = scene.add.container(x, y, [gfx, txt, this.promptText]);
        this.sprite.setDepth(5);
        this.sprite.setSize(size.w, size.h);
    }

    /**
     * Call every frame. Checks distance to player and shows/hides prompt.
     * Returns true if the player is within interaction range.
     */
    updateProximity(playerX: number, playerY: number): boolean {
        const dist = Phaser.Math.Distance.Between(
            playerX, playerY,
            this.sprite.x, this.sprite.y
        );
        const inRange = dist < INTERACT_RADIUS;
        this.promptText.setAlpha(inRange ? 1 : 0);
        return inRange;
    }

    /** Trigger the interaction (called when E is pressed and player is in range) */
    interact(): void {
        if (this.isAnimating) return;

        console.log(`[Prop] Interacted with: ${this.label} (${this.type})`);

        // Visual feedback: quick scale pop
        this.isAnimating = true;
        this.scene.tweens.add({
            targets: this.sprite,
            scaleX: 1.3,
            scaleY: 1.3,
            duration: 100,
            yoyo: true,
            ease: 'Quad.easeOut',
            onComplete: () => {
                this.isAnimating = false;
            },
        });

        // Fire external callback (used by audio system)
        this.onInteract?.();
    }
}
