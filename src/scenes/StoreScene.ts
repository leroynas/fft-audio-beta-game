/**
 * StoreScene.ts — Simple interior scene entered from the Store prop.
 */
import Phaser from 'phaser';

export class StoreScene extends Phaser.Scene {
    constructor() {
        super({ key: 'StoreScene' });
    }

    create(): void {
        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;

        this.cameras.main.setBackgroundColor('#0d1117');

        this.add.rectangle(cx, cy, 720, 460, 0x161b22, 1)
            .setStrokeStyle(3, 0x66ff88, 0.7);

        this.add.text(cx, cy - 170, 'Store Scene', {
            fontSize: '36px',
            color: '#66ff88',
            fontFamily: 'monospace',
            fontStyle: 'bold',
        }).setOrigin(0.5);

        this.add.text(cx, cy - 95, [
            'Interior placeholder for the Store.',
            '',
            'This scene is entered from the store building',
            'on the right-center side of the main map.',
        ].join('\n'), {
            fontSize: '16px',
            color: '#ffffff',
            fontFamily: 'monospace',
            align: 'center',
            lineSpacing: 8,
        }).setOrigin(0.5);

        this.add.text(cx, cy + 150, 'Press E or ESC to return to the map', {
            fontSize: '18px',
            color: '#ffee77',
            fontFamily: 'monospace',
        }).setOrigin(0.5);

        const returnToMap = () => {
            this.scene.start('GameScene');
        };

        this.input.keyboard!.once('keydown-E', returnToMap);
        this.input.keyboard!.once('keydown-ESC', returnToMap);
    }
}
