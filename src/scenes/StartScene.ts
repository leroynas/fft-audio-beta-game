/**
 * StartScene.ts — Title / splash screen (Scene 0).
 *
 * Preloads the main gameplay textures so pressing start switches to the map
 * immediately instead of waiting for GameScene's loader on the first input.
 */
import Phaser from 'phaser';

const PLANT_PRELOADS = [
    { key: 'beat_beet', folder: 'Beat_Beet', filePrefix: 'Beatbeet' },
    { key: 'crescendo_carrot', folder: 'Crescendo_Carrot', filePrefix: 'CrescendoCarrot' },
    { key: 'echo_eggplant', folder: 'Echo_Eggplant', filePrefix: 'EchoEggplant' },
    { key: 'melody_melon', folder: 'Melody_Melon', filePrefix: 'MelodyMelon' },
    { key: 'rhythm_radish', folder: 'Rhythm_Radish', filePrefix: 'RhythmRadish' },
    { key: 'treble_turnip', folder: 'Treble_Turnip', filePrefix: 'TrebleTurnip' },
    { key: 'vinyl_vine', folder: 'Vinyl_Vine', filePrefix: 'VinylVine' },
];

export class StartScene extends Phaser.Scene {
    private hasStarted = false;

    constructor() {
        super({ key: 'StartScene' });
    }

    preload(): void {
        this.load.spritesheet('player', 'assets/sprites/player_spritesheet.png', {
            frameWidth: 32,
            frameHeight: 32,
        });

        // Replaceable outdoor/interior tiles are resolved inside their scenes
        // with PNG/JPG/JPEG candidates and generated fallbacks. StartScene does
        // not preload hard-coded tile extensions, so replacing grass.png with
        // grass.jpg/jpeg will not break startup.

        this.load.image('object-house', '/assets/objects/Main_House.png');
        this.load.image('object-store', '/assets/objects/Store_Building.png');
        this.load.image('planter-big', '/assets/sprites/Plants/planter/planter_big.png');
        this.load.image('planter-small', '/assets/sprites/Plants/planter/planter_small.png');

        for (const plant of PLANT_PRELOADS) {
            this.load.image(
                `${plant.key}_stage1`,
                `/assets/sprites/Plants/plants/${plant.folder}/${plant.filePrefix}_01_Seed.png`
            );
            this.load.image(
                `${plant.key}_stage2`,
                `/assets/sprites/Plants/plants/${plant.folder}/${plant.filePrefix}_02_Sprout.png`
            );
            this.load.image(
                `${plant.key}_stage3`,
                `/assets/sprites/Plants/plants/${plant.folder}/${plant.filePrefix}_03_Growing.png`
            );
            this.load.image(
                `${plant.key}_stage4`,
                `/assets/sprites/Plants/plants/${plant.folder}/${plant.filePrefix}_04_Mature.png`
            );
        }

        this.load.image('plant_stage1', '/assets/sprites/Plants/plants/Vinyl_Vine/VinylVine_01_Seed.png');
        this.load.image('plant_stage2', '/assets/sprites/Plants/plants/Vinyl_Vine/VinylVine_02_Sprout.png');
        this.load.image('plant_stage3', '/assets/sprites/Plants/plants/Vinyl_Vine/VinylVine_03_Growing.png');
        this.load.image('plant_stage4', '/assets/sprites/Plants/plants/Vinyl_Vine/VinylVine_04_Mature.png');
    }

    create(): void {
        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;

        // Background
        this.cameras.main.setBackgroundColor('#0a0a1a');

        // Title
        this.add.text(cx, cy - 116, 'Supportive Narrative Demo', {
            fontSize: '36px',
            color: '#66ff88',
            fontFamily: 'monospace',
            fontStyle: 'bold',
        }).setOrigin(0.5);

        // Subtitle
        this.add.text(cx, cy - 62, 'Mini farming game for research on randomisation in game sound · Player: Daphne', {
            fontSize: '18px',
            color: '#aaaacc',
            fontFamily: 'monospace',
        }).setOrigin(0.5);

        // Description
        this.add.text(cx, cy + 18, [
            'Made for my Supportive Narrative research.',
            '',
            'Mode A — chooses a random sample from a prepared list',
            '          for example: stone_01, stone_02, stone_03.',
            'Mode B — uses adaptive continuity and memory',
            '          so variation follows the performer over time.'
        ].join('\n'), {
            fontSize: '13px',
            color: '#888899',
            fontFamily: 'monospace',
            align: 'center',
            lineSpacing: 4,
        }).setOrigin(0.5);

        // Prompt — pulsing
        const prompt = this.add.text(cx, cy + 170, 'Press SPACE / ENTER or click to start', {
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

        this.input.keyboard!.once('keydown-SPACE', () => this.startGame());
        this.input.keyboard!.once('keydown-ENTER', () => this.startGame());
        this.input.once('pointerdown', () => this.startGame());
    }

    private startGame(): void {
        if (this.hasStarted) return;
        this.hasStarted = true;
        this.scene.start('GameScene');
    }
}
