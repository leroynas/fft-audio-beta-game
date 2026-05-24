/**
 * main.ts — Application entry point for Live Drift Audio Demo.
 *
 * Configures the Phaser 3 game instance with physics, display settings,
 * and registers scenes: StartScene (title) → GameScene (gameplay).
 */
import Phaser from 'phaser';
import { StartScene } from './scenes/StartScene';
import { GameScene } from './scenes/GameScene';
import { HouseScene } from './scenes/HouseScene';
import { StoreScene } from './scenes/StoreScene';

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 1024,
    height: 768,
    parent: 'game-container',
    backgroundColor: '#1a1a2e',
    physics: {
        default: 'arcade',
        arcade: {
            gravity: { x: 0, y: 0 },
            debug: false,
        },
    },
    scene: [StartScene, GameScene, HouseScene, StoreScene],
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
    },
};

new Phaser.Game(config);