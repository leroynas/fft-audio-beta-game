/**
 * StartScene.ts — Title / splash screen (Scene 0).
 *
 * Shows the thesis title, subtitle, and waits for SPACE to launch
 * the main GameScene.  Generates the initial session seed.
 */
import Phaser from 'phaser';

export class StartScene extends Phaser.Scene {
    constructor() {
        super({ key: 'StartScene' });
    }

    create(): void {
        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;

        // Background
        this.cameras.main.setBackgroundColor('#0a0a1a');

        // Title
        this.add.text(cx, cy - 100, 'Live Drift Audio Demo', {
            fontSize: '36px',
            color: '#66ff88',
            fontFamily: 'monospace',
            fontStyle: 'bold',
        }).setOrigin(0.5);

        // Subtitle
        this.add.text(cx, cy - 50, 'From Live FOH to Game Audio', {
            fontSize: '18px',
            color: '#aaaacc',
            fontFamily: 'monospace',
        }).setOrigin(0.5);

        // Description
        this.add.text(cx, cy + 10, [
            'A research thesis demo comparing:',
            '',
            'Mode A — Classic Random game audio (i.i.d. samples)',
            'Mode B — Live Drift + Memory (granular, performer-state driven)',
            '',
            'Both routed through an Adaptive Live Mixer (FFT + EQ + Compression)',
        ].join('\n'), {
            fontSize: '13px',
            color: '#888899',
            fontFamily: 'monospace',
            align: 'center',
            lineSpacing: 4,
        }).setOrigin(0.5);

        // Prompt — pulsing
        const prompt = this.add.text(cx, cy + 160, 'Press SPACE to start', {
            fontSize: '20px',
            color: '#ffffff',
            fontFamily: 'monospace',
        }).setOrigin(0.5);

        this.tweens.add({
            targets: prompt,
            alpha: 0.3,
            duration: 800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
        });

        // SPACE → GameScene
        this.input.keyboard!.once('keydown-SPACE', () => {
            this.scene.start('GameScene');
        });
    }
}
