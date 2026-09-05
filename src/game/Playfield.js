/**
 * Owns one isolated player playfield and its complete visual presentation.
 * The visual node is centred on the playfield so short punch transforms stay
 * purely cosmetic and never affect board coordinates or Box2D simulation.
 * Board, minos, HUD panels, ghost, effects, and the optional physics layer
 * belong here; score callouts live in a sibling announcement layer instead.
 * Future multiplayer scenes create one Playfield per player and one world per
 * physics Playfield, while reusing shared mino geometry and definitions.
 */

import { CELL, COLS, ROWS } from "../config/gameplayConstants.js";
import {
  GAME_VIEWPORT_HEIGHT,
  GAME_VIEWPORT_WIDTH,
} from "../config/uiConstants.js";
import { BoardRenderer } from "../render/BoardRenderer.js";
import { EffectsRenderer } from "../render/EffectsRenderer.js";
import { PhysicsRenderer } from "../render/PhysicsRenderer.js";
import { PhysicsWorld } from "../physics/PhysicsWorld.js";
import {
  createShaderSettings,
  destroyShaderSettings,
  loadSkin,
} from "../render/ShaderSettings.js";
import { TRASH_SKIN_FILE } from "../config/trashConstants.js";
import { createPlayfieldLayout, SinglePlayerHud } from "../ui/PlayfieldLayout.js";
import {
  PLAYFIELD_HARD_DROP_PUNCH,
  PLAYFIELD_MATCH_PUNCH,
  PLAYFIELD_SPIN_PUNCH,
} from "../config/effectsConstants.js";

const localLayout = (layout) => {
  const shift = (rect) => ({
    ...rect,
    x: rect.x - layout.centerX,
    y: rect.y - layout.centerY,
  });
  return {
    ...layout,
    x: layout.x - layout.centerX,
    y: layout.y - layout.centerY,
    centerX: 0,
    centerY: 0,
    hold: shift(layout.hold),
    stats: shift(layout.stats),
    next: shift(layout.next),
    garbage: shift(layout.garbage),
    items: shift(layout.items),
  };
};

export class Playfield {
  constructor({
    root,
    cols = COLS,
    rows = ROWS,
    cell = CELL,
    width = GAME_VIEWPORT_WIDTH,
    height = GAME_VIEWPORT_HEIGHT,
    skinBaseUrl = "minoskins",
  }) {
    this.skinBaseUrl = skinBaseUrl;
    this.layout = createPlayfieldLayout({ cols, rows, cell, width, height });
    this.localLayout = localLayout(this.layout);
    this.root = new PIXI.Container();
    this.root.label = "playfield";
    this.root.position.set(this.layout.centerX, this.layout.centerY);
    this.announcements = new PIXI.Container();
    this.announcements.label = "playfieldAnnouncements";
    root.addChild(this.root, this.announcements);

    // This is the sole board-space transform: its local coordinates are grid
    // units (one unit per mino cell), with origin at the field's top-left.
    this.gridRoot = new PIXI.Container();
    this.gridRoot.label = "playfieldGrid";
    this.gridRoot.position.set(this.localLayout.x, this.localLayout.y);
    this.gridRoot.scale.set(this.localLayout.scale * CELL);
    this.gridLayer = new PIXI.Graphics();
    this.gridLayer.label = "playfieldGridBackground";
    this.minoLayer = new PIXI.Container();
    this.minoLayer.label = "classicMinoLayer";
    this.glowLayer = new PIXI.Container();
    this.glowLayer.label = "playfieldGlowUnderlay";
    this.frameLayer = new PIXI.Container();
    this.frameLayer.label = "playfieldFrameOverlay";
    this.effectsLayer = new PIXI.Container();
    this.effectsLayer.label = "playfieldEffects";
    const pixelLayers = [
      this.gridLayer,
      this.minoLayer,
      this.glowLayer,
      this.effectsLayer,
      this.frameLayer,
    ];
    // Existing board and effect renderers author geometry in CELL pixels.
    // Keep that implementation intact behind an inverse scale while the
    // public playfield coordinate space remains normalized grid units.
    pixelLayers.forEach((layer) => {
      layer.scale.set(1 / CELL);
      this.gridRoot.addChild(layer);
    });
    this.root.addChild(this.gridRoot);
    // Geometry and shader source are shared globally; every Playfield retains
    // independently mutable uniforms, curves, and skin resources.
    this.material = createShaderSettings();
    this.trashMaterial = createShaderSettings();
    this.loadTrashSkin();
    this.renderer = new BoardRenderer(
      this.gridLayer,
      this.minoLayer,
      this.glowLayer,
      this.frameLayer,
      this.material,
      this.trashMaterial,
    );
    this.effects = new EffectsRenderer(this.effectsLayer);
    this.hud = new SinglePlayerHud({
      root: this.root,
      layout: this.localLayout,
      overlayRoot: this.announcements,
      overlayLayout: this.layout,
      material: this.material,
    });
    this.punch = { scale: 0, y: 0, rotation: 0, life: 0 };
  }

  setPalette(colors = []) {
    this.renderer.setPalette(colors);
    this.physicsRenderer?.setPalette(colors);
  }

  createPhysicsWorld(api, preset, config) {
    this.physics = new PhysicsWorld(api, preset, config);
    this.physicsLayer = new PIXI.Container();
    this.physicsLayer.label = "physicsMinoLayer";
    this.gridRoot.addChildAt(
      this.physicsLayer,
      this.gridRoot.getChildIndex(this.frameLayer),
    );
    this.physicsRenderer = new PhysicsRenderer(
      this.physicsLayer,
      this.material,
      this.trashMaterial,
    );
    this.physicsRenderer.setPalette(this.renderer.palette);
    return this.physics;
  }

  setHoldAction(callback) {
    this.hud.setHoldAction(callback);
  }

  setRestartAction(callback) {
    this.hud.setRestartAction(callback);
  }

  async loadSkin(fileName) {
    if (!fileName) return 0;
    try {
      const response = await fetch(
        `${this.skinBaseUrl}/${encodeURIComponent(fileName)}`,
      );
      if (!response.ok) return 0;
      const applied = loadSkin(await response.json(), this.material);
      this.renderer.lastBoardSignature = null;
      this.renderer.lastActiveSignature = null;
      this.physicsRenderer?.invalidateMaterial();
      return applied;
    } catch {
      return 0;
    }
  }

  async loadTrashSkin() {
    try {
      const response = await fetch(`${this.skinBaseUrl}/${TRASH_SKIN_FILE}`);
      if (response.ok) loadSkin(await response.json(), this.trashMaterial);
    } catch {
      // Default material remains valid if an optional Trash skin is missing.
    }
  }

  matchPunch() {
    this.addPunch(PLAYFIELD_MATCH_PUNCH);
  }
  spinPunch(rotationDirection = 1) {
    // The constant defines magnitude. Counter-clockwise rotations mirror the
    // cosmetic tilt without mutating the shared frozen preset.
    this.addPunch({
      ...PLAYFIELD_SPIN_PUNCH,
      rotation:
        PLAYFIELD_SPIN_PUNCH.rotation * (Math.sign(rotationDirection) || 1),
    });
  }
  hardDropPunch() {
    this.addPunch(PLAYFIELD_HARD_DROP_PUNCH);
  }
  addPunch({ scale, y, rotation, duration }) {
    this.punch = { scale, y, rotation, life: duration, total: duration };
  }
  update(deltaMS) {
    this.effects.update(deltaMS);
    if (this.punch.life <= 0) return;
    this.punch.life = Math.max(0, this.punch.life - deltaMS);
    const amount = this.punch.total ? this.punch.life / this.punch.total : 0;
    this.root.scale.set(1 + this.punch.scale * amount);
    this.root.y = this.layout.centerY + this.punch.y * amount;
    this.root.rotation = this.punch.rotation * amount;
    if (!this.punch.life) {
      this.root.scale.set(1);
      this.root.y = this.layout.centerY;
      this.root.rotation = 0;
    }
  }
  destroy() {
    this.physicsRenderer?.releaseRemovedBodies(new Set());
    this.effects.destroy();
    this.hud.destroy();
    destroyShaderSettings(this.material);
    destroyShaderSettings(this.trashMaterial);
    this.root.removeFromParent();
    this.announcements.removeFromParent();
    this.root.destroy({ children: true });
    this.announcements.destroy({ children: true });
  }
}
