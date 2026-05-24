/**
 * HouseScene.ts — Interior scene entered from the House prop.
 *
 * Expected map image:
 *   public/assets/maps/I_House.png
 */
import Phaser from 'phaser';

const HOUSE_MAP_KEY = 'map-house-interior';
const HOUSE_MAP_PATH = '/assets/maps/I_House.png';

export class HouseScene extends Phaser.Scene {
    constructor() {
        super({ key: 'HouseScene' });
    }

    preload(): void {
        this.load.image(HOUSE_MAP_KEY, HOUSE_MAP_PATH);
    }

    create(): void {
        this.cameras.main.setBackgroundColor('#111018');
        this.drawInteriorMap(HOUSE_MAP_KEY, 0xffde8f, 'House Scene');
        this.createReturnControls();
    }

    private drawInteriorMap(textureKey: string, accent: number, title: string): void {
        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;

        if (this.textures.exists(textureKey)) {
            const map = this.add.image(cx, cy, textureKey).setOrigin(0.5);
            const source = this.textures.get(textureKey).getSourceImage() as HTMLImageElement;
            const scale = Math.min(
                this.scale.width / source.width,
                this.scale.height / source.height
            );
            map.setScale(scale);
        } else {
            this.add.rectangle(cx, cy, 720, 460, 0x1d1a26, 1)
                .setStrokeStyle(3, accent, 0.7);

            this.add.text(cx, cy, `Missing map image:
${HOUSE_MAP_PATH}`, {
                fontSize: '16px',
                color: '#ffffff',
                fontFamily: 'monospace',
                align: 'center',
                lineSpacing: 8,
            }).setOrigin(0.5);
        }

        this.add.text(cx, 34, title, {
            fontSize: '28px',
            color: '#ffde8f',
            fontFamily: 'monospace',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 4,
        }).setOrigin(0.5).setDepth(50);

        this.add.text(cx, this.scale.height - 34, 'Press E or ESC to return to the map', {
            fontSize: '16px',
            color: '#ffee77',
            fontFamily: 'monospace',
            stroke: '#000000',
            strokeThickness: 3,
        }).setOrigin(0.5).setDepth(50);
    }

    private createReturnControls(): void {
        const returnToMap = () => {
            this.scene.start('GameScene');
        };

        this.input.keyboard!.once('keydown-E', returnToMap);
        this.input.keyboard!.once('keydown-ESC', returnToMap);
    }
}
