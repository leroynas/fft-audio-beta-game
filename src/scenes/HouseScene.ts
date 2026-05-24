/**
 * HouseScene.ts — Simple interior scene entered from the House prop.
 */
import Phaser from 'phaser';

export class HouseScene extends Phaser.Scene {
    constructor() {
        super({ key: 'HouseScene' });
    }

    create(): void {
        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;

        this.cameras.main.setBackgroundColor('#111018');

        this.add.rectangle(cx, cy, 720, 460, 0x1d1a26, 1)
            .setStrokeStyle(3, 0xffde8f, 0.7);

        this.add.text(cx, cy - 170, 'House Scene', {
            fontSize: '36px',
            color: '#ffde8f',
            fontFamily: 'monospace',
            fontStyle: 'bold',
        }).setOrigin(0.5);

        this.add.text(cx, cy - 95, [
            'Interior placeholder for the House.',
            '',
            'This scene is entered from the main map by standing',
            'near the house door and pressing E.',
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
