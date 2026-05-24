/**
 * StoreScene.ts — Interior scene entered from the Store prop.
 *
 * Expected map image:
 *   public/assets/maps/I_Store.png
 */
import Phaser from 'phaser';

const STORE_MAP_KEY = 'map-store-interior';
const STORE_MAP_PATH = '/assets/maps/I_Store.png';

export class StoreScene extends Phaser.Scene {
    constructor() {
        super({ key: 'StoreScene' });
    }

    preload(): void {
        this.load.image(STORE_MAP_KEY, STORE_MAP_PATH);
    }

    create(): void {
        this.cameras.main.setBackgroundColor('#0d1117');
        this.drawInteriorMap(STORE_MAP_KEY, 0x66ff88, 'Store Scene');
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
            this.add.rectangle(cx, cy, 720, 460, 0x161b22, 1)
                .setStrokeStyle(3, accent, 0.7);

            this.add.text(cx, cy, `Missing map image:
${STORE_MAP_PATH}`, {
                fontSize: '16px',
                color: '#ffffff',
                fontFamily: 'monospace',
                align: 'center',
                lineSpacing: 8,
            }).setOrigin(0.5);
        }

        this.add.text(cx, 34, title, {
            fontSize: '28px',
            color: '#66ff88',
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
