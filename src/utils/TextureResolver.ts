/**
 * TextureResolver.ts — safe image extension resolver for replaceable tiles.
 *
 * It probes PNG/JPG/JPEG with an HTMLImageElement instead of Phaser's loader,
 * so missing alternate extensions do not create Phaser "Failed to process file"
 * warnings. Use it for replaceable user tiles only.
 */
import Phaser from 'phaser';

export function extensionCandidates(basePathWithoutExtension: string): string[] {
    return [
        `${basePathWithoutExtension}.png`,
        `${basePathWithoutExtension}.jpg`,
        `${basePathWithoutExtension}.jpeg`,
    ];
}

export function loadFirstAvailableImageTexture(
    scene: Phaser.Scene,
    key: string,
    urls: string[],
    onReady: (textureKey: string) => void,
): void {
    if (scene.textures.exists(key)) {
        onReady(key);
        return;
    }

    const tryUrl = (index: number): void => {
        if (index >= urls.length) return;

        const img = new Image();
        img.onload = () => {
            if (!scene.sys || !scene.textures) return;
            if (!scene.textures.exists(key)) {
                scene.textures.addImage(key, img);
            }
            onReady(key);
        };
        img.onerror = () => tryUrl(index + 1);
        img.src = urls[index];
    };

    tryUrl(0);
}

export interface OptionalSpriteSheetConfig {
    frameWidth: number;
    frameHeight: number;
    margin?: number;
    spacing?: number;
}

/**
 * Safely loads a user-replaceable spritesheet from PNG/JPG/JPEG without using
 * Phaser's loader for missing candidates. Missing optional NPC sheets therefore
 * do not create red console errors while you are still adding assets.
 */
export function loadFirstAvailableSpriteSheetTexture(
    scene: Phaser.Scene,
    key: string,
    urls: string[],
    config: OptionalSpriteSheetConfig,
    onReady: (textureKey: string) => void,
): void {
    if (scene.textures.exists(key)) {
        onReady(key);
        return;
    }

    const tryUrl = (index: number): void => {
        if (index >= urls.length) return;

        const img = new Image();
        img.onload = () => {
            if (!scene.sys || !scene.textures || scene.textures.exists(key)) return;
            const textureManager = scene.textures as Phaser.Textures.TextureManager & {
                addSpriteSheet?: (textureKey: string, source: HTMLImageElement, sheetConfig: OptionalSpriteSheetConfig) => Phaser.Textures.Texture;
            };
            if (textureManager.addSpriteSheet) {
                textureManager.addSpriteSheet(key, img, config);
                onReady(key);
                return;
            }

            scene.textures.addImage(key, img);
            onReady(key);
        };
        img.onerror = () => tryUrl(index + 1);
        img.src = urls[index];
    };

    tryUrl(0);
}
