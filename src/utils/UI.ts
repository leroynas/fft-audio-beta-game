/**
 * UI.ts — HUD overlay utilities.
 *
 * Phase 5 — thesis-ready UI:
 *  - 64-bar spectrogram (top-right, color-coded by frequency band)
 *  - Enhanced mode panel with mode description
 *  - Session seed display with "R to reseed" hint
 *  - Dynamic EQ / Compressor status labels
 *  - Full permanent instructions at bottom
 *  - Mixer status text
 */
import Phaser from 'phaser';
import { AudioMode, FloorType } from '../types';
import { MixerSnapshot } from '../audio/AdaptiveMixer';

const MODE_LABELS: Record<AudioMode, string> = {
    classic: 'Mode A: Classic Random + Adaptive Live Mix (FFT)',
    live: 'Mode B: Live Drift + Memory + Adaptive Live Mix (FFT)',
};

const MODE_DESCRIPTIONS: Record<AudioMode, string> = {
    classic: 'i.i.d. random sample selection — no memory between events',
    live:    'Granular synthesis with memory cursor — one continuous performer session',
};

/** Color per mode — red for A, green for B (high contrast for testing) */
const MODE_COLORS: Record<AudioMode, string> = {
    classic: '#ff6666',
    live:    '#66ff88',
};

// ── Spectrogram constants (top-right) ────────────────────────
const SPEC_MARGIN = 10;   // px from right/top edges
const SPEC_BAR_W  = 3;    // px width of each bin bar
const SPEC_BAR_GAP = 1;   // px gap between bars
const SPEC_MAX_H  = 80;   // Max bar height (pixels)
const SPEC_BINS   = 64;   // Number of FFT bins to display

// Color thresholds: bin index → color (low=red, mid=yellow, high=cyan)
const LOW_BIN_END = 10;   // ~3 kHz boundary
const MID_BIN_END = 30;   // ~13 kHz boundary
function binColor(i: number): number {
    if (i < LOW_BIN_END) return 0xff4444;   // Red (low)
    if (i < MID_BIN_END) return 0xffcc44;   // Yellow (mid)
    return 0x44ddff;                         // Cyan (high)
}

// Map dB range to 0..1 for bar height
const DB_FLOOR = -60;
const DB_CEIL  = 0;
function dbToNorm(db: number): number {
    return Math.max(0, Math.min(1, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)));
}

// ── 3-band bar constants (left side) ─────────────────────────
const BAR_X      = 10;
const BAR_Y      = 110;
const BAR_W      = 28;
const BAR_GAP    = 6;
const BAR_MAX_H  = 60;
const BAR_LABEL_Y = BAR_Y + BAR_MAX_H + 4;
const BAR_COLORS = {
    low:  0x4488ff,
    mid:  0xffaa22,
    high: 0xff44aa,
};

export class UI {
    private modeText: Phaser.GameObjects.Text;
    private modeDescText: Phaser.GameObjects.Text;
    private floorText: Phaser.GameObjects.Text;
    private seedText: Phaser.GameObjects.Text;
    private hintText: Phaser.GameObjects.Text;
    private mixerStatusText: Phaser.GameObjects.Text;
    private eqLabel: Phaser.GameObjects.Text;
    private compLabel: Phaser.GameObjects.Text;
    private fftGfx: Phaser.GameObjects.Graphics;
    private specGfx: Phaser.GameObjects.Graphics;

    // Bar label texts
    private barLabels: Phaser.GameObjects.Text[] = [];

    private scene: Phaser.Scene;

    constructor(scene: Phaser.Scene) {
        this.scene = scene;

        const style: Phaser.Types.GameObjects.Text.TextStyle = {
            fontSize: '18px',
            color: '#ffffff',
            fontFamily: 'monospace',
            backgroundColor: '#000000cc',
            padding: { x: 8, y: 6 },
        };

        // Mode indicator (top-left, large + color-coded)
        this.modeText = scene.add.text(10, 10, '', { ...style })
            .setScrollFactor(0)
            .setDepth(100);

        // Mode description (below mode)
        this.modeDescText = scene.add.text(10, 44, '', {
            ...style, fontSize: '11px', color: '#aaaacc',
            backgroundColor: '#000000aa',
        }).setScrollFactor(0).setDepth(100);

        // Floor type indicator
        this.floorText = scene.add.text(10, 70, '', { ...style, fontSize: '13px' })
            .setScrollFactor(0)
            .setDepth(100);

        // Session seed display
        this.seedText = scene.add.text(10, 92, '', {
            ...style, fontSize: '11px', color: '#cccc88',
            backgroundColor: '#000000aa',
            padding: { x: 4, y: 2 },
        }).setScrollFactor(0).setDepth(100);

        // FFT 3-band bar graphics
        this.fftGfx = scene.add.graphics()
            .setScrollFactor(0)
            .setDepth(100);

        // Bar labels: Low / Mid / High
        const labelStyle: Phaser.Types.GameObjects.Text.TextStyle = {
            fontSize: '9px', color: '#ffffffaa', fontFamily: 'monospace',
        };
        const labels = ['Low', 'Mid', 'Hi'];
        for (let i = 0; i < 3; i++) {
            const lbl = scene.add.text(
                BAR_X + i * (BAR_W + BAR_GAP) + BAR_W / 2,
                BAR_LABEL_Y,
                labels[i],
                labelStyle
            ).setOrigin(0.5, 0).setScrollFactor(0).setDepth(100);
            this.barLabels.push(lbl);
        }

        // Dynamic EQ label
        this.eqLabel = scene.add.text(10, BAR_LABEL_Y + 16, 'Dynamic EQ', {
            fontSize: '10px', color: '#88ff88', fontFamily: 'monospace',
            backgroundColor: '#000000aa', padding: { x: 3, y: 1 },
        }).setScrollFactor(0).setDepth(100);

        // Compressor label
        this.compLabel = scene.add.text(100, BAR_LABEL_Y + 16, 'Compressor', {
            fontSize: '10px', color: '#88ff88', fontFamily: 'monospace',
            backgroundColor: '#000000aa', padding: { x: 3, y: 1 },
        }).setScrollFactor(0).setDepth(100);

        // Mixer status text
        this.mixerStatusText = scene.add.text(10, BAR_LABEL_Y + 34, '', {
            ...style,
            fontSize: '11px',
            backgroundColor: '#000000aa',
            padding: { x: 4, y: 2 },
        }).setScrollFactor(0).setDepth(100);

        // Spectrogram graphics (top-right)
        this.specGfx = scene.add.graphics()
            .setScrollFactor(0)
            .setDepth(100);

        // Controls hint (bottom, full instructions)
        this.hintText = scene.add.text(10, 0,
            'WASD/Arrows: Move  |  E: Interact  |  M: Switch mode  |  R: New seed',
            { ...style, fontSize: '12px' }
        ).setScrollFactor(0).setDepth(100);

        // Position hint at bottom
        this.repositionHint(scene);
        scene.scale.on('resize', () => this.repositionHint(scene));
    }

    /** Update displayed mode, floor type, seed, and mixer visualisation */
    update(mode: AudioMode, floor: FloorType, mixer?: MixerSnapshot, seed?: string): void {
        this.modeText.setText(`${MODE_LABELS[mode]}  (press M to switch)`);
        this.modeText.setColor(MODE_COLORS[mode]);
        this.modeDescText.setText(MODE_DESCRIPTIONS[mode]);
        this.floorText.setText(`Floor: ${floor}`);

        if (seed) {
            this.seedText.setText(`Seed: ${seed}  (R to reseed)`);
        }

        if (mixer) {
            this.drawFFTBars(mixer);
            this.drawSpectrogram(mixer);
            this.mixerStatusText.setText(mixer.statusText);

            // Color the status text based on activity
            if (mixer.lowDucking || mixer.midCutting || mixer.compressorEngaged) {
                this.mixerStatusText.setColor('#ffcc44');
            } else {
                this.mixerStatusText.setColor('#88ff88');
            }

            // EQ label: highlight when active
            const eqActive = mixer.lowDucking || mixer.midCutting;
            this.eqLabel.setColor(eqActive ? '#ffcc44' : '#88ff88');
            this.compLabel.setColor(mixer.compressorEngaged ? '#ffcc44' : '#88ff88');
        }
    }

    /** Draw three vertical bars representing Low / Mid / High band energy */
    private drawFFTBars(mixer: MixerSnapshot): void {
        this.fftGfx.clear();

        // Background panel
        const panelW = 3 * BAR_W + 2 * BAR_GAP + 12;
        this.fftGfx.fillStyle(0x000000, 0.6);
        this.fftGfx.fillRoundedRect(BAR_X - 4, BAR_Y - 4, panelW, BAR_MAX_H + 8, 4);

        const bands = [
            { db: mixer.lowDb,  color: BAR_COLORS.low,  eqDb: mixer.lowGainDb,  active: mixer.lowDucking },
            { db: mixer.midDb,  color: BAR_COLORS.mid,  eqDb: mixer.midGainDb,  active: mixer.midCutting },
            { db: mixer.highDb, color: BAR_COLORS.high, eqDb: mixer.highGainDb, active: mixer.compressorEngaged },
        ];

        for (let i = 0; i < bands.length; i++) {
            const band = bands[i];
            const norm = dbToNorm(band.db);
            const barH = Math.max(2, norm * BAR_MAX_H);
            const x = BAR_X + i * (BAR_W + BAR_GAP);
            const y = BAR_Y + BAR_MAX_H - barH;

            const alpha = band.active ? 1.0 : 0.7;
            this.fftGfx.fillStyle(band.color, alpha);
            this.fftGfx.fillRect(x, y, BAR_W, barH);

            if (band.eqDb < -1) {
                const cutNorm = Math.abs(band.eqDb) / 10;
                const lineH = Math.min(barH, cutNorm * BAR_MAX_H);
                this.fftGfx.fillStyle(0xff2222, 0.7);
                this.fftGfx.fillRect(x, y, BAR_W, Math.max(2, lineH));
            }

            if (band.eqDb > 1) {
                this.fftGfx.fillStyle(0x22ff44, 0.6);
                this.fftGfx.fillRect(x, y - 3, BAR_W, 3);
            }
        }
    }

    /** Draw 64-bar spectrogram in the top-right corner */
    private drawSpectrogram(mixer: MixerSnapshot): void {
        this.specGfx.clear();

        const bins = mixer.fftBins;
        if (!bins || bins.length === 0) return;

        const specW = SPEC_BINS * (SPEC_BAR_W + SPEC_BAR_GAP);
        const scaleW = this.scene.scale.width;
        const startX = scaleW - specW - SPEC_MARGIN;
        const startY = SPEC_MARGIN;

        // Background panel
        this.specGfx.fillStyle(0x000000, 0.6);
        this.specGfx.fillRoundedRect(startX - 4, startY - 4, specW + 8, SPEC_MAX_H + 8, 4);

        const binCount = Math.min(SPEC_BINS, bins.length);
        for (let i = 0; i < binCount; i++) {
            const norm = dbToNorm(bins[i]);
            const barH = Math.max(1, norm * SPEC_MAX_H);
            const x = startX + i * (SPEC_BAR_W + SPEC_BAR_GAP);
            const y = startY + SPEC_MAX_H - barH;

            this.specGfx.fillStyle(binColor(i), 0.85);
            this.specGfx.fillRect(x, y, SPEC_BAR_W, barH);
        }
    }

    private repositionHint(scene: Phaser.Scene): void {
        const h = scene.scale.height;
        this.hintText.setY(h - 30);
    }
}
