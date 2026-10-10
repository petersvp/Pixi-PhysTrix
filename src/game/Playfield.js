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
  PLAYFIELD_LIFE_LOSS_PUNCH,
  PLAYFIELD_MATCH_PUNCH,
  PLAYFIELD_SPIN_PUNCH,
} from "../config/effectsConstants.js";

// Pixel-space extension beyond the board. Keep these here so Line Seal can be
// tuned against the playfield frame without changing gameplay coordinates.
export const LINE_SEAL_OVERLAY = Object.freeze({
  frameBleedX: 16,
  frameBleedY: 0,
  fillAlpha: 0.3,
  edgeAlpha: 0.9,
  edgeWidth: 3,
  iconSize: 30,
  textGap: 4,
});

// Keep reward-flight timing in one place so queue insertion and presentation
// always use the same duration.
export const GOD_ESSENCE_REWARD_FLIGHT = Object.freeze({
  durationMs: 3_000,
  iconSize: 42,
  spawnStaggerMs: 180,
  midpointJitter: 12,
  glowFadeMs: 320,
  frameGlowColor: 0xffdf38,
  frameGlowDistance: 20,
  frameGlowInnerStrength: 0.5,
  frameGlowQuality: 0.3,
  frameGlowBaseStrength: 2.5,
  frameGlowPulseStrength: 1.2,
  frameGlowPulsePeriodMs: 90,
  queueIconSpacing: 46,
  queueEndY: -16,
  mergeDurationMs: 1 * 1000,
  boardExitX: 12,
  boardExitY: 12,
  queueOutsideX: 10,
  queueMiddleY: 0.58,
  queueTopY: 28,
});

const pointOnCatmullRom = (points, progress) => {
  const segmentCount = points.length - 1;
  const scaled = Math.min(segmentCount, Math.max(0, progress * segmentCount));
  const index = Math.min(segmentCount - 1, Math.floor(scaled));
  const t = scaled - index;
  const t2 = t * t;
  const t3 = t2 * t;
  const p0 = points[Math.max(0, index - 1)];
  const p1 = points[index];
  const p2 = points[index + 1];
  const p3 = points[Math.min(segmentCount, index + 2)];
  const interpolate = (a, b, c, d) => 0.5 * (
    2 * b +
    (-a + c) * t +
    (2 * a - 5 * b + 4 * c - d) * t2 +
    (-a + 3 * b - 3 * c + d) * t3
  );
  return {
    x: interpolate(p0.x, p1.x, p2.x, p3.x),
    y: interpolate(p0.y, p1.y, p2.y, p3.y),
  };
};

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
    queueSize,
    showGodEssenceWallet = false,
  }) {
    this.skinBaseUrl = skinBaseUrl;
    this.cols = cols;
    this.layout = createPlayfieldLayout({ cols, rows, cell, width, height, queueSize });
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
    this.lineSealLayer = new PIXI.Container();
    this.lineSealLayer.label = "lineSealOverlay";
    // Keep authored seals separate from their short-lived blocked-chain
    // feedback. Rebuilding a seal must never erase a pulse already underway.
    this.lineSealVisualLayer = new PIXI.Container();
    this.lineSealVisualLayer.label = "lineSealVisuals";
    this.lineSealPulseLayer = new PIXI.Container();
    this.lineSealPulseLayer.label = "lineSealPulses";
    this.lineSealOutlineLayer = new PIXI.Container();
    this.lineSealOutlineLayer.label = "lineSealOutlines";
    this.lineSealLayer.addChild(
      this.lineSealVisualLayer,
      this.lineSealPulseLayer,
      this.lineSealOutlineLayer,
    );
    this.lineSealPulses = [];
    this.lineSealOutlines = [];
    this.lineSealVisuals = [];
    this.rewardFlightLayer = new PIXI.Container();
    this.rewardFlightLayer.label = "godEssenceRewardFlights";
    this.rewardFlights = [];
    this.rewardFlightSequence = 0;
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
    // Seals intentionally sit above both minos and the chrome, so their row
    // range continues visibly into the frame.
    this.lineSealLayer.scale.set(1 / CELL);
    this.gridRoot.addChild(this.lineSealLayer);
    this.lineSealSignature = "";
    this.root.addChild(this.gridRoot);
    // Geometry and shader source are shared globally; every Playfield retains
    // independently mutable uniforms, curves, and skin resources.
    this.material = createShaderSettings();
    this.trashMaterial = createShaderSettings();
    this.attachmentMaterial = createShaderSettings();
    this.gemMaterial = createShaderSettings();
    this.metalMaterial = createShaderSettings();
    this.iceMaterial = createShaderSettings();
    this.jellyMaterial = createShaderSettings();
    this.loadTrashSkin();
    this.loadAttachmentSkin();
    this.loadGemSkin();
    this.loadMetalSkin();
    this.loadIceSkin();
    this.loadJellySkin();
    this.renderer = new BoardRenderer(
      this.gridLayer,
      this.minoLayer,
      this.glowLayer,
      this.frameLayer,
      this.material,
      this.trashMaterial,
      cols,
      rows,
      { attachment: this.attachmentMaterial, gem: this.gemMaterial, metal: this.metalMaterial, slippery: this.iceMaterial, bounce: this.jellyMaterial, filler: this.trashMaterial },
    );
    this.effects = new EffectsRenderer(this.effectsLayer);
    this.hud = new SinglePlayerHud({
      root: this.root,
      layout: this.localLayout,
      overlayRoot: this.announcements,
      overlayLayout: this.layout,
      material: this.material,
      previewMaterials: { attachment: this.attachmentMaterial, gem: this.gemMaterial, metal: this.metalMaterial, slippery: this.iceMaterial, bounce: this.jellyMaterial, filler: this.trashMaterial },
      showGodEssenceWallet,
    });
    // This is a direct child of the Playfield root (the known-good item-icon
    // render space). Its coordinates are therefore the same local pixel space
    // as the HUD meter and Queue panel.
    this.root.addChild(this.rewardFlightLayer);
    this.punch = { scale: 0, y: 0, rotation: 0, life: 0 };
    this.spinRotation = { value: 0, life: 0, total: 0 };
    this.presentationTimeMs = 0;
    this.blindTarget = false;
    this.blindBlend = 0;
    this.desaturationTarget = false;
    this.desaturationBlend = 0;
    this.chromaticEchoTarget = false;
    this.chromaticEchoBlend = 0;
    this.queueJamTarget = false;
    this.queueJamBlend = 0;
    this.upsideDownTarget = false;
    this.upsideDownRotation = 0;
    this.astigmatismTarget = false;
    this.astigmatismBlend = 0;
    this.astigmatismFilter = null;
    this.desaturationFilter = null;
    this.rewardFrameGlow = null;
    this.rewardFrameGlowBlend = 0;
  }

  startGodEssenceRewardFlight(itemIndices = []) {
    const atlas = this.godEssenceAtlas?.atlas;
    const textureSource = this.godEssenceAtlas?.texture?.source;
    const config = GOD_ESSENCE_REWARD_FLIGHT;
    const presentationId = ++this.rewardFlightSequence;
    if (!atlas || !textureSource)
      return { id: presentationId, durationMs: config.durationMs };
    const start = {
      x: this.localLayout.items.x + this.localLayout.items.width / 2,
      y: this.localLayout.items.y + this.localLayout.items.height / 2,
    };
    const endCenter = {
      x: this.localLayout.next.x + this.localLayout.next.width / 2,
      y: this.localLayout.next.y + config.queueEndY,
    };
    const boardRight = this.localLayout.x + this.localLayout.scaledWidth;
    const boardBottom = this.localLayout.y + this.localLayout.scaledHeight;
    const queueRight = this.localLayout.next.x + this.localLayout.next.width;
    const waypointOne = {
      x: boardRight + config.boardExitX,
      y: boardBottom + config.boardExitY,
    };
    const waypointTwo = {
      x: queueRight + config.queueOutsideX,
      y: this.localLayout.next.y + this.localLayout.next.height * config.queueMiddleY,
    };
    const waypointThree = {
      x: waypointTwo.x,
      y: this.localLayout.next.y + config.queueTopY,
    };
    itemIndices.forEach((itemIndex, index) => {
      const end = {
        x: endCenter.x + (index - (itemIndices.length - 1) / 2) * config.queueIconSpacing,
        y: endCenter.y,
      };
      const cell = atlas.itemCells?.[itemIndex];
      if (!cell) return;
      const sprite = new PIXI.Sprite(new PIXI.Texture({
        source: textureSource,
        frame: new PIXI.Rectangle(
          (cell.column - 1) * atlas.cellSize,
          (cell.row - 1) * atlas.cellSize,
          atlas.cellSize,
          atlas.cellSize,
        ),
      }));
      sprite.label = "godEssenceRewardFlight";
      sprite.anchor.set(0.5);
      sprite.width = sprite.height = config.iconSize;
      sprite.position.set(start.x, start.y);
      const jitter = () => (Math.random() - 0.5) * config.midpointJitter;
      this.rewardFlights.push({
        sprite,
        presentationId,
        route: [
          start,
          { x: waypointOne.x + jitter(), y: waypointOne.y + jitter() },
          { x: waypointTwo.x + jitter(), y: waypointTwo.y + jitter() },
          { x: waypointThree.x + jitter(), y: waypointThree.y + jitter() },
          end,
        ],
        spawnDelayMs: index * config.spawnStaggerMs,
        spawned: false,
        elapsed: 0,
        duration: config.durationMs,
      });
    });
    if (!this.rewardFrameGlow && PIXI.filters?.GlowFilter) {
      this.rewardFrameGlow = new PIXI.filters.GlowFilter({
        distance: config.frameGlowDistance,
        outerStrength: 0,
        innerStrength: config.frameGlowInnerStrength,
        color: config.frameGlowColor,
        quality: config.frameGlowQuality,
      });
      this.frameLayer.filters = [...(this.frameLayer.filters || []), this.rewardFrameGlow];
    }
    return {
      id: presentationId,
      durationMs: config.durationMs + Math.max(0, itemIndices.length - 1) * config.spawnStaggerMs,
    };
  }

  resolveGodEssenceRewardFlight(presentationId, cells = []) {
    const matching = this.rewardFlights.filter((flight) => flight.presentationId === presentationId);
    if (!matching.length || !cells.length) return;
    const total = cells.reduce((sum, cell) => ({
      x: sum.x + cell.x + 0.5,
      y: sum.y + cell.y + 0.5,
    }), { x: 0, y: 0 });
    const target = {
      x: this.localLayout.x + total.x / cells.length * this.localLayout.scale * CELL,
      y: this.localLayout.y + total.y / cells.length * this.localLayout.scale * CELL,
    };
    matching.forEach((flight) => {
      flight.merging = true;
      flight.mergeElapsed = 0;
      flight.mergeStart = { x: flight.sprite.x, y: flight.sprite.y };
      flight.mergeTarget = target;
    });
  }

  setPalette(colors = []) {
    this.renderer.setPalette(colors);
    this.physicsRenderer?.setPalette(colors);
  }

  setGodEssenceAtlas(texture, atlas) {
    this.godEssenceAtlas = { texture, atlas };
    this.lineSealSignature = "";
    this.renderer.setGodEssenceAtlas(texture, atlas);
    this.physicsRenderer?.setGodEssenceAtlas(texture, atlas);
    this.hud?.setGodEssenceAtlas(texture, atlas);
  }

  setLineSeals(seals = [], defaultItemIndex = -1) {
    const signature = JSON.stringify([seals, defaultItemIndex, this.godEssenceAtlas?.atlas?.cellSize]);
    if (signature === this.lineSealSignature) return;
    this.lineSealSignature = signature;
    this.lineSealVisualLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.lineSealPulses = [];
    this.lineSealVisuals = [];
    seals.forEach((seal) => {
      const top = seal.startRow * CELL - LINE_SEAL_OVERLAY.frameBleedY;
      const bottom = (seal.endRow + 1) * CELL + LINE_SEAL_OVERLAY.frameBleedY;
      const width = this.cols * CELL + LINE_SEAL_OVERLAY.frameBleedX * 2;
      const left = -LINE_SEAL_OVERLAY.frameBleedX;
      const graphic = new PIXI.Graphics()
        .rect(left, top, width, bottom - top)
        .fill({ color: 0xff3344, alpha: LINE_SEAL_OVERLAY.fillAlpha })
        .moveTo(left, top).lineTo(left + width, top)
        .moveTo(left, bottom).lineTo(left + width, bottom)
        .stroke({ width: LINE_SEAL_OVERLAY.edgeWidth, color: 0xff5260, alpha: LINE_SEAL_OVERLAY.edgeAlpha });
      const GlowFilter = PIXI.filters?.GlowFilter;
      if (GlowFilter) {
        const glow = new GlowFilter({
          color: 0xff0000,
          alpha: 0.6,
          distance: 64,
          outerStrength: 1,
          innerStrength: 0,
          quality: 0.02,
          knockout: false,
        });
        graphic.filters = [glow];
        graphic.lineSealGlow = glow;
      }
      graphic.lineSealStartRow = seal.startRow;
      graphic.lineSealEndRow = seal.endRow;
      this.lineSealVisualLayer.addChild(graphic);
      this.lineSealVisuals.push(graphic);
      const centreX = this.cols * CELL / 2;
      const centreY = (top + bottom) / 2;
      const content = new PIXI.Container();
      const atlas = this.godEssenceAtlas?.atlas;
      const textureSource = this.godEssenceAtlas?.texture?.source;
      //const itemIndex = Number.isInteger(seal.itemIndex) ? seal.itemIndex : defaultItemIndex;
      const itemIndex = 0; // this is the correct icon here
      const itemCell = atlas?.itemCells?.[itemIndex];
      if (textureSource && atlas && itemCell) {
        const icon = new PIXI.Sprite(new PIXI.Texture({
          source: textureSource,
          frame: new PIXI.Rectangle((itemCell.column - 1) * atlas.cellSize, (itemCell.row - 1) * atlas.cellSize, atlas.cellSize, atlas.cellSize),
        }));
        icon.width = icon.height = LINE_SEAL_OVERLAY.iconSize;
        icon.position.set(-LINE_SEAL_OVERLAY.iconSize - LINE_SEAL_OVERLAY.textGap, -LINE_SEAL_OVERLAY.iconSize / 2);
        content.addChild(icon);
      }
      const count = new PIXI.Text({
        text: `x ${seal.remaining}`,
        style: { fontFamily: "Quantico", fontSize: 20, fontWeight: "bold", fill: 0xffffff, stroke: { color: 0x3a0710, width: 4 } },
      });
      count.anchor.set(0, 0.5);
      content.addChild(count);
      content.position.set(centreX, centreY);
      this.lineSealVisualLayer.addChild(content);
    });
  }

  // A rejected line scan makes the existing seal overlay itself glow. This is
  // separate from the long-lived per-mino outlines below and never moves the
  // camera or paints a second rectangle over the board.
  pulseLineSealRange(cells = []) {
    const rows = [...new Set(cells.map(({ y }) => Math.floor(y)))];
    if (!rows.length) return;
    this.lineSealVisuals
      .filter((graphic) => rows.some((row) =>
        row >= graphic.lineSealStartRow && row <= graphic.lineSealEndRow,
      ))
      .forEach((graphic) => {
        if (!graphic.lineSealGlow) return;
        const existing = this.lineSealPulses.find((pulse) => pulse.graphic === graphic);
        if (existing) {
          existing.elapsed = 0;
          return;
        }
        this.lineSealPulses.push({ graphic, elapsed: 0, duration: 440 });
      });
  }

  // This mirrors the marked-clear mino treatment (rounded outline plus glow),
  // but red and independently timed because a sealed chain must remain on
  // the board instead of entering the normal vanish path.
  markLineSealBlockedTiles(cells = [], duration = 5_000) {
    cells.forEach(({ x, y }) => {
      const layer = new PIXI.Container();
      layer.label = "lineSealBlockedMinoOutline";
      if (PIXI.filters?.GlowFilter) {
        layer.filters = [new PIXI.filters.GlowFilter({
          distance: 12,
          outerStrength: 1.4,
          innerStrength: 0.2,
          color: 0xff5260,
          quality: 0.3,
          knockout: false,
        })];
      }
      const graphic = new PIXI.Graphics()
        .roundRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4, 5)
        .stroke({ width: 3, color: 0xff5260, alpha: 1 });
      layer.addChild(graphic);
      this.lineSealOutlineLayer.addChild(layer);
      this.lineSealOutlines.push({ graphic: layer, elapsed: 0, duration: Math.max(1, duration) });
    });
  }

  setTrashAppearance(appearance = {}) {
    this.renderer.setTrashAppearance(appearance);
    this.physicsRenderer?.setTrashAppearance(appearance);
  }

  addPresentationFilter(filter) {
    if (!filter || (this.root.filters || []).includes(filter)) return;
    this.root.filters = [...(this.root.filters || []), filter];
  }

  removePresentationFilter(filter) {
    if (!filter) return;
    this.root.filters = (this.root.filters || []).filter((entry) => entry !== filter);
  }

  setGodEssencePresentation({
    blind = false,
    desaturated = false,
    upsideDown = false,
    astigmatism = false,
    chromaticEcho = false,
    queueJam = false,
    timeMs = 0,
  } = {}) {
    this.presentationTimeMs = Math.max(0, Number(timeMs) || 0);
    this.blindTarget = Boolean(blind);
    this.desaturationTarget = Boolean(desaturated);
    this.upsideDownTarget = Boolean(upsideDown);
    this.astigmatismTarget = Boolean(astigmatism);
    this.chromaticEchoTarget = Boolean(chromaticEcho);
    this.queueJamTarget = Boolean(queueJam);
    const neutralMinoColor = this.godEssenceAtlas?.atlas?.neutralMinoColor ?? "#777777";
    const presentation = {
      blind: this.blindTarget,
      blindBlend: this.blindBlend,
      desaturated: this.desaturationBlend >= 0.999,
      desaturationAmount: this.desaturationBlend,
      neutralMinoColor,
      timeMs: this.presentationTimeMs,
    };
    this.renderer.setGodEssencePresentation(presentation);
    this.physicsRenderer?.setGodEssencePresentation(presentation);
    this.hud?.setGodEssencePresentation({
      chromaticEchoAmount: this.chromaticEchoBlend,
      queueJamAmount: this.queueJamBlend,
    });

    if (this.desaturationTarget && !this.desaturationFilter) {
      this.desaturationFilter = new PIXI.ColorMatrixFilter();
      this.addPresentationFilter(this.desaturationFilter);
    }
    if (this.astigmatismTarget && !this.astigmatismFilter) {
      this.astigmatismFilter = new PIXI.BlurFilter({ strength: 0, quality: 1 });
      this.addPresentationFilter(this.astigmatismFilter);
    }
  }

  createPhysicsWorld(api, preset, config) {
    this.physics = new PhysicsWorld(api, preset, {
      ...config,
      cols: this.layout.cols,
      rows: this.layout.rows,
    });
    this.physicsLayer = new PIXI.Container();
    this.physicsLayer.label = "physicsMinoLayer";
    this.gridRoot.addChildAt(
      this.physicsLayer,
      this.gridRoot.getChildIndex(this.frameLayer),
    );
    // Physics bodies are inserted above the pre-existing effects layer.
    // Move effects back above bodies (but below the frame) so particles and
    // electric bolts never disappear behind Box2D minos.
    this.gridRoot.setChildIndex(
      this.effectsLayer,
      this.gridRoot.getChildIndex(this.frameLayer) - 1,
    );
    this.physicsRenderer = new PhysicsRenderer(
      this.physicsLayer,
      this.material,
      this.trashMaterial,
      { attachment: this.attachmentMaterial, gem: this.gemMaterial, metal: this.metalMaterial, slippery: this.iceMaterial, bounce: this.jellyMaterial, filler: this.trashMaterial },
    );
    if (this.godEssenceAtlas)
      this.physicsRenderer.setGodEssenceAtlas(
        this.godEssenceAtlas.texture,
        this.godEssenceAtlas.atlas,
      );
    this.physicsRenderer.setPalette(this.renderer.palette);
    this.physicsRenderer.setTrashAppearance(this.renderer.trashAppearance);
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
  async loadAttachmentSkin() {
    try {
      const response = await fetch(`${this.skinBaseUrl}/skin-mino-attachment.json`);
      if (response.ok) loadSkin(await response.json(), this.attachmentMaterial);
    } catch { /* The regular mino skin remains the safe fallback. */ }
  }
  async loadGemSkin() {
    try {
      const response = await fetch(`${this.skinBaseUrl}/skin-god-gem.json`);
      if (response.ok) loadSkin(await response.json(), this.gemMaterial);
    } catch { /* The regular mino skin remains the safe fallback. */ }
  }
  async loadMetalSkin() {
    try {
      const response = await fetch(`${this.skinBaseUrl}/skin-metal.json`);
      if (response.ok) loadSkin(await response.json(), this.metalMaterial);
    } catch { /* The regular mino skin remains the safe fallback. */ }
  }
  async loadIceSkin() {
    try {
      const response = await fetch(`${this.skinBaseUrl}/skin-ice.json`);
      if (response.ok) loadSkin(await response.json(), this.iceMaterial);
    } catch { /* The regular mino skin remains the safe fallback. */ }
  }
  async loadJellySkin() {
    try {
      const response = await fetch(`${this.skinBaseUrl}/skin-jelly.json`);
      if (response.ok) loadSkin(await response.json(), this.jellyMaterial);
    } catch { /* The regular mino skin remains the safe fallback. */ }
  }

  matchPunch() {
    this.addPunch(PLAYFIELD_MATCH_PUNCH);
  }
  spinPunch(rotationDirection = 1) {
    // Spin feedback rotates board-space only. Rotating the outer Playfield
    // container also rotates and can clip sibling HUD/effect render passes.
    this.spinRotation = {
      value: PLAYFIELD_SPIN_PUNCH.rotation * (Math.sign(rotationDirection) || 1),
      life: PLAYFIELD_SPIN_PUNCH.duration,
      total: PLAYFIELD_SPIN_PUNCH.duration,
    };
  }
  hardDropPunch() {
    this.addPunch(PLAYFIELD_HARD_DROP_PUNCH);
  }
  earthquakePunch(strength = 1) {
    const amount = Math.max(1, Number(strength) || 1) * 2;
    this.addPunch({
      scale: 0,
      y: 0,
      rotation: 0,
      shake: 5 + amount * 2,
      duration: 420 + amount * 45,
    });
  }
  pulsePunch(strength = 1) {
    const amount = Math.max(1, Number(strength) || 1);
    this.addPunch({
      scale: 0.025 + amount * 0.003,
      y: 0,
      rotation: 0,
      shake: 3 + amount,
      duration: 220 + amount * 30,
    });
  }
  lifeLossPunch() {
    this.addPunch(PLAYFIELD_LIFE_LOSS_PUNCH);
    const GlowFilter = PIXI.filters?.GlowFilter;
    if (!GlowFilter) return;
    const filter = new GlowFilter({
      color: PLAYFIELD_LIFE_LOSS_PUNCH.glowColor,
      distance: PLAYFIELD_LIFE_LOSS_PUNCH.glowDistance,
      outerStrength: PLAYFIELD_LIFE_LOSS_PUNCH.glowStrength,
      innerStrength: 0.25,
    });
    this.root.filters = [...(this.root.filters || []), filter];
    this.lifeLossGlow = { filter, elapsed: 0 };
  }
  addPunch({ scale, y, rotation, duration, shake = 0 }) {
    this.punch = { scale, y, rotation, shake, life: duration, total: duration };
  }
  update(deltaMS) {
    this.effects.update(deltaMS);
    if (this.spinRotation.life > 0) {
      this.spinRotation.life = Math.max(0, this.spinRotation.life - deltaMS);
      const amount = this.spinRotation.total ? this.spinRotation.life / this.spinRotation.total : 0;
      this.gridRoot.rotation = this.spinRotation.value * amount;
    } else this.gridRoot.rotation = 0;
    this.rewardFlights = this.rewardFlights.filter((flight) => {
      flight.elapsed += deltaMS;
      if (flight.merging) {
        flight.mergeElapsed += deltaMS;
        const progress = Math.min(1, flight.mergeElapsed / GOD_ESSENCE_REWARD_FLIGHT.mergeDurationMs);
        const eased = progress * progress * (3 - 2 * progress);
        flight.sprite.position.set(
          flight.mergeStart.x + (flight.mergeTarget.x - flight.mergeStart.x) * eased,
          flight.mergeStart.y + (flight.mergeTarget.y - flight.mergeStart.y) * eased,
        );
        flight.sprite.alpha = 1 - progress;
        flight.sprite.scale.set(0.85 * (1 - progress));
        if (progress < 1) return true;
        flight.sprite.removeFromParent();
        flight.sprite.destroy();
        return false;
      }
      if (flight.elapsed < flight.spawnDelayMs) return true;
      if (!flight.spawned) {
        flight.spawned = true;
        this.rewardFlightLayer.addChild(flight.sprite);
      }
      const progress = Math.min(1, (flight.elapsed - flight.spawnDelayMs) / flight.duration);
      const position = pointOnCatmullRom(flight.route, progress);
      flight.sprite.position.set(position.x, position.y);
      flight.sprite.alpha = 1;
      const parked = progress >= 1;
      flight.sprite.scale.set(parked
        ? 0.85 + Math.sin((flight.elapsed - flight.spawnDelayMs - flight.duration) / 160) * 0.08
        : 0.85 + Math.sin(progress * Math.PI) * 0.35);
      // Keep the three selected choices beside the Queue until the hidden
      // reward PM actually enters the playfield.
      return true;
    });
    if (this.rewardFrameGlow) {
      const target = this.rewardFlights.length > 0 ? 1 : 0;
      const step = Math.max(0, deltaMS) / GOD_ESSENCE_REWARD_FLIGHT.glowFadeMs;
      this.rewardFrameGlowBlend += Math.max(
        -step,
        Math.min(step, target - this.rewardFrameGlowBlend),
      );
      this.rewardFrameGlow.outerStrength = this.rewardFrameGlowBlend *
        (GOD_ESSENCE_REWARD_FLIGHT.frameGlowBaseStrength +
          Math.sin(this.presentationTimeMs / GOD_ESSENCE_REWARD_FLIGHT.frameGlowPulsePeriodMs) *
            GOD_ESSENCE_REWARD_FLIGHT.frameGlowPulseStrength);
      if (!target && this.rewardFrameGlowBlend <= 0) {
        this.frameLayer.filters = (this.frameLayer.filters || []).filter((filter) => filter !== this.rewardFrameGlow);
        this.rewardFrameGlow.destroy();
        this.rewardFrameGlow = null;
        this.rewardFrameGlowBlend = 0;
      }
    }
    this.lineSealPulses = this.lineSealPulses.filter((pulse) => {
      pulse.elapsed += deltaMS;
      const progress = Math.min(1, pulse.elapsed / pulse.duration);
      const envelope = Math.sin(progress * Math.PI);
      pulse.graphic.lineSealGlow.outerStrength = 3.4 * envelope;
      pulse.graphic.lineSealGlow.innerStrength = 0.6 * envelope;
      if (progress < 1) return true;
      pulse.graphic.lineSealGlow.outerStrength = 0;
      pulse.graphic.lineSealGlow.innerStrength = 0;
      return false;
    });
    this.lineSealOutlines = this.lineSealOutlines.filter((outline) => {
      outline.elapsed += deltaMS;
      const progress = Math.min(1, outline.elapsed / outline.duration);
      outline.graphic.alpha = 1 - progress;
      if (progress < 1) return true;
      outline.graphic.removeFromParent();
      outline.graphic.destroy({ children: true });
      return false;
    });
    const transitionStep = Math.max(0, deltaMS) / 350;
    this.blindBlend = Math.max(0, Math.min(1, this.blindBlend + (this.blindTarget ? transitionStep : -transitionStep)));
    this.desaturationBlend = Math.max(0, Math.min(1, this.desaturationBlend + (this.desaturationTarget ? transitionStep : -transitionStep)));
    this.chromaticEchoBlend = Math.max(0, Math.min(1, this.chromaticEchoBlend + (this.chromaticEchoTarget ? transitionStep : -transitionStep)));
    this.queueJamBlend = Math.max(0, Math.min(1, this.queueJamBlend + (this.queueJamTarget ? transitionStep : -transitionStep)));
    const targetRotation = this.upsideDownTarget ? Math.PI : 0;
    this.upsideDownRotation += Math.max(-transitionStep * Math.PI, Math.min(transitionStep * Math.PI, targetRotation - this.upsideDownRotation));
    if (this.desaturationFilter) {
      this.desaturationFilter.reset();
      this.desaturationFilter.saturate(-this.desaturationBlend);
      if (!this.desaturationTarget && this.desaturationBlend === 0) {
        this.removePresentationFilter(this.desaturationFilter);
        this.desaturationFilter.destroy();
        this.desaturationFilter = null;
      }
    }
    const astigmatismStep = Math.max(0, deltaMS) / 350;
    this.astigmatismBlend = Math.max(
      0,
      Math.min(1, this.astigmatismBlend + (this.astigmatismTarget ? astigmatismStep : -astigmatismStep)),
    );
    if (this.astigmatismFilter) {
      // Heavy but deliberately low-quality: the instability is part of the
      // impairment rather than an expensive cinematic blur.
      const minBlur = 16;
      const maxBlur = 18;
      this.astigmatismFilter.strength = this.astigmatismBlend * (
        minBlur + (Math.sin(this.presentationTimeMs / 360) + 1) * 0.5 * (maxBlur - minBlur)
      );
      if (!this.astigmatismTarget && this.astigmatismBlend === 0) {
        this.removePresentationFilter(this.astigmatismFilter);
        this.astigmatismFilter.destroy();
        this.astigmatismFilter = null;
      }
    }
    if (this.lifeLossGlow) {
      this.lifeLossGlow.elapsed += deltaMS;
      const duration = PLAYFIELD_LIFE_LOSS_PUNCH.duration;
      const progress = Math.min(1, this.lifeLossGlow.elapsed / duration);
      const pulse = (Math.sin(progress * Math.PI * PLAYFIELD_LIFE_LOSS_PUNCH.glowPulseCycles) + 1) / 2;
      this.lifeLossGlow.filter.outerStrength =
        PLAYFIELD_LIFE_LOSS_PUNCH.glowMinimumStrength +
        (PLAYFIELD_LIFE_LOSS_PUNCH.glowStrength - PLAYFIELD_LIFE_LOSS_PUNCH.glowMinimumStrength) *
          pulse * (1 - progress);
    }
    if (this.punch.life <= 0) {
      this.root.scale.set(1);
      this.root.rotation = this.upsideDownRotation;
      return;
    }
    this.punch.life = Math.max(0, this.punch.life - deltaMS);
    const amount = this.punch.total ? this.punch.life / this.punch.total : 0;
    const scale = 1 + this.punch.scale * amount;
    this.root.scale.set(scale);
    this.root.x = this.layout.centerX +
      this.punch.shake * amount * Math.sin((1 - amount) * Math.PI * 12);
    this.root.y = this.layout.centerY + this.punch.y * amount;
    this.root.rotation = this.upsideDownRotation + this.punch.rotation * amount;
    if (!this.punch.life) {
      this.root.scale.set(1);
      this.root.x = this.layout.centerX;
      this.root.y = this.layout.centerY;
      this.root.rotation = this.upsideDownRotation;
      if (this.lifeLossGlow) {
        this.root.filters = (this.root.filters || []).filter(
          (filter) => filter !== this.lifeLossGlow.filter,
        );
        this.lifeLossGlow = null;
      }
    }
  }
  destroy() {
    this.physicsRenderer?.releaseRemovedBodies(new Set());
    this.effects.destroy();
    this.astigmatismFilter?.destroy();
    this.desaturationFilter?.destroy();
    this.hud.destroy();
    destroyShaderSettings(this.material);
    destroyShaderSettings(this.trashMaterial);
    destroyShaderSettings(this.attachmentMaterial);
    destroyShaderSettings(this.gemMaterial);
    destroyShaderSettings(this.metalMaterial);
    destroyShaderSettings(this.iceMaterial);
    destroyShaderSettings(this.jellyMaterial);
    this.root.removeFromParent();
    this.announcements.removeFromParent();
    this.root.destroy({ children: true });
    this.announcements.destroy({ children: true });
  }
}
