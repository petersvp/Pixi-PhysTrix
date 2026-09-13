/**
 * Calculates and renders the 1P playfield HUD composition.
 * Board-space layers use the field origin and scale from this module.
 * HOLD, stats, NEXT, garbage, and items derive from the same rails.
 * Side columns are intentionally narrow so the field remains dominant.
 * The geometry export contains no Pixi objects and is safe to reuse elsewhere.
 */

import { PreviewPanel } from "./PreviewPanel.js";
import {
  CALLOUT_COMBO_FONT_SIZE,
  CALLOUT_COMBO_Y_OFFSET,
  CALLOUT_MAIN_FONT_SIZE,
  CALLOUT_MAJOR_CLEAR_SCALE,
  CALLOUT_PERFECT_CLEAR_DURATION_MULTIPLIER,
  CALLOUT_PERFECT_CLEAR_SCALE,
  CALLOUT_POP_DURATION_MS,
  CALLOUT_POP_SCALE,
  CALLOUT_POINTS_FONT_SIZE,
  CALLOUT_POINTS_Y_OFFSET,
  GAME_OVER_DETAIL_FONT_SIZE,
  GAME_OVER_PANEL_MIN_HEIGHT,
  GAME_OVER_PANEL_PADDING,
  GAME_OVER_PANEL_ROW_HEIGHT,
  GAME_OVER_PANEL_WIDTH,
  GAME_OVER_BACKDROP_BLUR_QUALITY,
  GAME_OVER_BACKDROP_BLUR_STRENGTH,
  GAME_OVER_RESTART_INPUT_DELAY_MS,
  GAME_OVER_PLAY_AGAIN_GAP,
  GAME_OVER_PLAY_AGAIN_HEIGHT,
  GAME_OVER_PLAY_AGAIN_WIDTH,
  GAME_OVER_SCORE_FONT_SIZE,
  GAME_OVER_SCORE_SUFFIX_FONT_SIZE,
  GAME_OVER_ENTER_DURATION_MS,
  GAME_OVER_ENTER_START_SCALE,
  GAME_OVER_TEXT_ENTER_DURATION_MS,
  GAME_OVER_TEXT_ENTER_STAGGER_MS,
  GAME_OVER_TEXT_ENTER_START_SCALE,
  COUNTDOWN_ENTER_DURATION_MS,
  COUNTDOWN_ENTER_START_SCALE,
  GAME_OVER_SHADOW_PADDING,
  GAME_OVER_TITLE_SHADOW_ALPHA,
  GAME_OVER_TITLE_SHADOW_BLUR,
  GAME_OVER_TITLE_SHADOW_DISTANCE,
  GAME_VIEWPORT_HEIGHT,
  GAME_VIEWPORT_WIDTH,
  HOLD_PANEL_HEIGHT,
  HOLD_PANEL_DETACHED_BLOCK_OFFSET,
  HOLD_PANEL_X_OFFSET,
  HOLD_PREVIEW_SCALE,
  HOLD_PREVIEW_Y,
  HOLD_PREVIEW_SLOT_BOTTOM,
  HUD_LIVES_FONT_SIZE,
  HUD_LIVES_Y_OFFSET,
  HUD_PANEL_CORE_ALPHA,
  HUD_PANEL_GLOW_ALPHA,
  HUD_PANEL_GLOW_SPREAD,
  HUD_PANEL_LINE_WIDTH,
  HUD_PANEL_PARTICLE_MIDDLE_U,
  HUD_PANEL_RADIUS,
  HUD_SIDE_WIDTH,
  HUD_STATS_RIGHT_PADDING,
  HUD_STATS_CONTENT_HEIGHT,
  HUD_STATS_CURRENT_COLOR,
  HUD_STATS_CURRENT_FONT_SIZE,
  HUD_STATS_COMPLETED_CURRENT_COLOR,
  HUD_STATS_COMPLETED_LABEL_COLOR,
  HUD_STATS_COMPLETED_TARGET_COLOR,
  HUD_STATS_FONT_FAMILY,
  HUD_STATS_GROUP_GAP,
  HUD_STATS_GROUP_LINE_HEIGHT,
  HUD_STATS_LABEL_COLOR,
  HUD_STATS_LABEL_FONT_SIZE,
  HUD_STATS_SCORE_TARGET_FONT_SIZE,
  HUD_STATS_TARGET_COLOR,
  HUD_STATS_TARGET_FONT_SIZE,
  HUD_STATS_Y_OFFSET,
  ITEM_PANEL_DETACHED_BLOCK_OFFSET,
  ITEM_PANEL_HEIGHT,
  ITEM_PANEL_WIDTH,
  ITEM_PANEL_Y_OFFSET,
  ITEM_SLOT_COUNT,
  ITEM_SLOT_GAP,
  ITEM_SLOT_SIZE,
  ITEM_SLOT_Y,
  NEXT_PANEL_BOTTOM_PADDING,
  NEXT_PANEL_DETACHED_BLOCK_OFFSET,
  NEXT_PANEL_X_OFFSET,
  NEXT_PREVIEW_SCALE,
  NEXT_PREVIEW_Y,
  NEXT_PREVIEW_SLOT_HEIGHT,
  NEXT_QUEUE_SLOTS,
  NEXT_SLOT_SPACING,
  PREVIEW_SLOT_INSET,
  PREVIEW_SLOT_PADDING,
  SHOW_GARBAGE_METER,
  SHOW_ITEM_PANEL,
  START_MESSAGE_SHADOW_ALPHA,
  START_MESSAGE_SHADOW_BLUR,
  START_MESSAGE_SHADOW_DISTANCE,
} from "../config/uiConstants.js";
import { COLORS } from "../config/colors.js";
import { chainName } from "../game/ChainSystem.js";
import { AdvancedLineRenderer } from "../render/AdvancedLineRenderer.js";

const pluralizeClearRank = (rank) =>
  rank.endsWith("X") ? `${rank}ES` : rank.endsWith("E") ? `${rank}S` : `${rank}S`;

const statMarkup = (label, current, target = null, score = false, completed = false) =>
  `<div class="stat${completed ? " completed" : ""}"><span class="label">${label}</span><br><span class="current">${current}</span>${target === null ? "" : score ? `<br><span class="scoreTarget">/${target}</span>` : `<span class="target">/${target}</span>`}</div>`;

export const createPlayfieldLayout = ({
  cols,
  rows,
  cell,
  width = GAME_VIEWPORT_WIDTH,
  height = GAME_VIEWPORT_HEIGHT,
}) => {
  const boardWidth = cols * cell;
  const boardHeight = rows * cell;
  const scale = Math.min(1, 370 / boardWidth, 610 / boardHeight);
  const scaledWidth = boardWidth * scale;
  const scaledHeight = boardHeight * scale;
  const x = (width - scaledWidth) / 2;
  const y = 72 + (610 - scaledHeight) / 2;
  const sideWidth = HUD_SIDE_WIDTH;
  const panelInset = 18;
  const nextHeight =
    NEXT_PREVIEW_Y +
    (NEXT_QUEUE_SLOTS - 1) * NEXT_SLOT_SPACING +
    NEXT_PREVIEW_SLOT_HEIGHT +
    NEXT_PANEL_BOTTOM_PADDING;
  const nextDetached = nextHeight > scaledHeight;
  const holdDetached = HOLD_PANEL_HEIGHT > scaledHeight;
  const leftAreaHeight =
    HOLD_PANEL_HEIGHT + HUD_STATS_Y_OFFSET + HUD_STATS_CONTENT_HEIGHT;
  const holdY = holdDetached
    ? y + (scaledHeight - leftAreaHeight) / 2
    : y + panelInset;
  const itemsDetached = ITEM_PANEL_WIDTH > scaledWidth;
  return {
    x,
    y,
    width: boardWidth,
    height: boardHeight,
    cols,
    cell,
    rows,
    scale,
    scaledWidth,
    scaledHeight,
    centerX: x + scaledWidth / 2,
    centerY: y + scaledHeight / 2,
    hold: {
      x:
        x -
        sideWidth -
        HOLD_PANEL_X_OFFSET -
        (holdDetached ? cell * scale * HOLD_PANEL_DETACHED_BLOCK_OFFSET : 0),
      y: holdY,
      width: sideWidth,
      height: HOLD_PANEL_HEIGHT,
      detached: holdDetached,
    },
    stats: {
      x:
        x -
        sideWidth -
        HOLD_PANEL_X_OFFSET -
        (holdDetached ? cell * scale * HOLD_PANEL_DETACHED_BLOCK_OFFSET : 0),
      y: holdY + HOLD_PANEL_HEIGHT + HUD_STATS_Y_OFFSET,
      width: sideWidth,
    },
    next: {
      x:
        x +
        scaledWidth +
        NEXT_PANEL_X_OFFSET +
        (nextDetached ? cell * scale * NEXT_PANEL_DETACHED_BLOCK_OFFSET : 0),
      y: nextDetached ? y + (scaledHeight - nextHeight) / 2 : y + panelInset,
      width: sideWidth,
      height: nextHeight,
      detached: nextDetached,
    },
    garbage: {
      x: x - 22,
      y: y + Math.max(0, scaledHeight - 250),
      width: 22,
      height: 250,
    },
    items: {
      x: x + (scaledWidth - ITEM_PANEL_WIDTH) / 2,
      y:
        y +
        scaledHeight +
        ITEM_PANEL_Y_OFFSET +
        (itemsDetached ? cell * scale * ITEM_PANEL_DETACHED_BLOCK_OFFSET : 0),
      width: ITEM_PANEL_WIDTH,
      height: ITEM_PANEL_HEIGHT,
      detached: itemsDetached,
    },
  };
};

export const applyPlayfieldLayout = (layout, layers) => {
  layers.filter(Boolean).forEach((layer) => {
    layer.position.set(layout.x, layout.y);
    layer.scale.set(layout.scale);
  });
};

/**
 * Owns the connected 1P HUD composition around a playfield.
 * Static Pixi frame graphics are constructed once in the constructor.
 * Runtime updates only change values and preview minos.
 * Optional garbage and item frames use the shared layout geometry.
 * GameManager supplies state but does not own HUD construction or placement.
 */
export class SinglePlayerHud {
  constructor({
    root,
    layout,
    overlayRoot = root,
    overlayLayout = layout,
    material,
  }) {
    this.root = root;
    this.layout = layout;
    this.overlayRoot = overlayRoot;
    this.overlayLayout = overlayLayout;
    this.material = material;
    this.create();
    this.createOverlays();
  }

  drawPanelFrame(graphics, rect, outerSide = null) {
    const { width, height } = rect;
    const radius = HUD_PANEL_RADIUS;
    if (outerSide === "left") {
      // Field-facing corners are reverse fillets: the horizontal panel edge
      // turns outward above or below itself before it meets the shared rail.
      graphics
        .moveTo(radius, 0)
        .lineTo(width - radius, 0)
        .quadraticCurveTo(width, 0, width, -radius)
        .lineTo(width, height + radius)
        .quadraticCurveTo(width, height, width - radius, height)
        .lineTo(radius, height)
        .quadraticCurveTo(0, height, 0, height - radius)
        .lineTo(0, radius)
        .quadraticCurveTo(0, 0, radius, 0);
    } else if (outerSide === "right") {
      graphics
        .moveTo(radius, 0)
        .lineTo(width - radius, 0)
        .quadraticCurveTo(width, 0, width, radius)
        .lineTo(width, height - radius)
        .quadraticCurveTo(width, height, width - radius, height)
        .lineTo(radius, height)
        .quadraticCurveTo(0, height, 0, height + radius)
        .lineTo(0, -radius)
        .quadraticCurveTo(0, 0, radius, 0);
    } else if (outerSide === "bottom") {
      // The top edge is supplied by the playfield's shared bottom rail. Only
      // the item panel's outer U-shape is filled and outlined here.
      graphics
        .moveTo(0, 0)
        .lineTo(width, 0)
        .lineTo(width, height - radius)
        .quadraticCurveTo(width, height, width - radius, height)
        .lineTo(radius, height)
        .quadraticCurveTo(0, height, 0, height - radius)
        .lineTo(0, 0);
    } else {
      graphics.roundRect(0, 0, width, height, radius);
    }
    graphics.fill({ color: COLORS.PANEL_BG_DEEP, alpha: 0.96 });
    return graphics;
  }

  drawPanelPath(
    panel,
    points,
    name,
    {
      reverse = false,
      closed = false,
      glowThickness = HUD_PANEL_GLOW_SPREAD,
      railThickness = HUD_PANEL_LINE_WIDTH,
    } = {},
  ) {
    const safeGlowThickness = Math.max(0, glowThickness);
    const safeRailThickness = Math.max(0, railThickness);
    const glowTexture = AdvancedLineRenderer.getHalfParticleTexture(
      safeGlowThickness || 2,
    );
    const pathPoints = reverse ? [...points].reverse() : points;
    const finalPoint = pathPoints.length - 1;
    // The two end segments consume the two particle halves. Every interior
    // segment samples the particle centre, producing a constant line body.
    const particleUvs = pathPoints.map((_point, index) => {
      if (closed) return HUD_PANEL_PARTICLE_MIDDLE_U;
      if (index === 0) return 0;
      if (index === finalPoint) return 1;
      return HUD_PANEL_PARTICLE_MIDDLE_U;
    });
    // Match the playfield glow exactly: one half-particle ribbon extrudes from
    // the authored baseline, rather than combining two mirrored glow meshes.
    new AdvancedLineRenderer({
      texture: glowTexture,
      tint: COLORS.PANEL_ACCENT,
      leftWidth: safeGlowThickness,
      alpha: HUD_PANEL_GLOW_ALPHA,
      closed,
      name: `${name}GlowPath`,
    }).draw(panel, pathPoints, particleUvs);
    // The visible rail is also made from the half-particle texture. Do not put
    // a flat white strip above it: that would hide the authored particle caps.
    new AdvancedLineRenderer({
      texture: glowTexture,
      tint: COLORS.PANEL_ACCENT,
      leftWidth: safeRailThickness / 2,
      alpha: HUD_PANEL_CORE_ALPHA,
      closed,
      name: `${name}OuterCore`,
    }).draw(panel, pathPoints, particleUvs);
    new AdvancedLineRenderer({
      texture: glowTexture,
      tint: COLORS.PANEL_ACCENT,
      rightWidth: safeRailThickness / 2,
      alpha: HUD_PANEL_CORE_ALPHA,
      flipV: true,
      closed,
      name: `${name}InnerCore`,
    }).draw(panel, pathPoints, particleUvs);
  }

  drawPanelOutline(panel, rect, outerSide) {
    const { width, height } = rect;
    const radius = HUD_PANEL_RADIUS;
    if (outerSide === "left") {
      // One continuous outline prevents independent mesh caps from appearing
      // where the HOLD panel's reverse fillets meet the field-facing rail.
      const outline = [new PIXI.Point(width, -radius)];
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(width, 0),
        new PIXI.Point(width - radius, 0),
      );
      outline.push(new PIXI.Point(radius, 0));
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(0, 0),
        new PIXI.Point(0, radius),
      );
      outline.push(new PIXI.Point(0, height - radius));
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(0, height),
        new PIXI.Point(radius, height),
      );
      outline.push(new PIXI.Point(width - radius, height));
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(width, height),
        new PIXI.Point(width, height + radius),
      );
      this.drawPanelPath(panel, outline, "holdPanelOutline");
    } else if (outerSide === "right") {
      // The NEXT outline is likewise one path, then reversed so the same
      // one-sided half-particle extrusion continues outward to the right.
      const outline = [new PIXI.Point(0, -radius)];
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(0, 0),
        new PIXI.Point(radius, 0),
      );
      outline.push(new PIXI.Point(width - radius, 0));
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(width, 0),
        new PIXI.Point(width, radius),
      );
      outline.push(new PIXI.Point(width, height - radius));
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(width, height),
        new PIXI.Point(width - radius, height),
      );
      outline.push(new PIXI.Point(radius, height));
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(0, height),
        new PIXI.Point(0, height + radius),
      );
      this.drawPanelPath(panel, outline, "nextPanelOutline", { reverse: true });
    } else if (outerSide === "bottom") {
      // Run clockwise so the standard left-side half-particle extrusion sits
      // outside the item bar all the way around its shared bottom connection.
      const outline = [new PIXI.Point(width + radius, 0)];
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(width, 0),
        new PIXI.Point(width, radius),
      );
      outline.push(new PIXI.Point(width, height - radius));
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(width, height),
        new PIXI.Point(width - radius, height),
      );
      outline.push(new PIXI.Point(radius, height));
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(0, height),
        new PIXI.Point(0, height - radius),
      );
      outline.push(new PIXI.Point(0, radius));
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(0, 0),
        new PIXI.Point(-radius, 0),
      );
      this.drawPanelPath(panel, outline, "itemsPanelOutline");
    } else {
      // Detached panels are ordinary rounded cards. Keep their outline as one
      // continuous path so the half-particle end caps are not exposed at joins.
      const outline = [
        new PIXI.Point(radius, 0),
        new PIXI.Point(width - radius, 0),
      ];
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(width, 0),
        new PIXI.Point(width, radius),
      );
      outline.push(new PIXI.Point(width, height - radius));
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(width, height),
        new PIXI.Point(width - radius, height),
      );
      outline.push(new PIXI.Point(radius, height));
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(0, height),
        new PIXI.Point(0, height - radius),
      );
      outline.push(new PIXI.Point(0, radius));
      AdvancedLineRenderer.appendQuadratic(
        outline,
        new PIXI.Point(0, 0),
        new PIXI.Point(radius, 0),
      );
      this.drawPanelPath(panel, outline, "roundedPanelOutline", {
        closed: true,
        reverse: true,
      });
    }
  }

  createItemSlots(panel, rect) {
    const slots = new PIXI.Graphics();
    slots.label = "itemSlots";
    const totalWidth =
      ITEM_SLOT_COUNT * ITEM_SLOT_SIZE + (ITEM_SLOT_COUNT - 1) * ITEM_SLOT_GAP;
    const firstX = (rect.width - totalWidth) / 2;
    for (let index = 0; index < ITEM_SLOT_COUNT; index++) {
      const x = firstX + index * (ITEM_SLOT_SIZE + ITEM_SLOT_GAP);
      slots
        .roundRect(x, ITEM_SLOT_Y, ITEM_SLOT_SIZE, ITEM_SLOT_SIZE, 7)
        .fill({ color: COLORS.PANEL_BG, alpha: 0.7 })
        .stroke({ width: 2, color: COLORS.PANEL_ACCENT, alpha: 0.55 });
    }
    panel.addChild(slots);
  }

  createPreviewSlots(panel, slots, name) {
    const outlines = new PIXI.Graphics();
    outlines.label = name;
    slots.forEach((slot) => {
      outlines
        .roundRect(slot.x, slot.y, slot.width, slot.height, 6)
        .fill({ color: COLORS.PANEL_BG, alpha: 0.2 })
        .stroke({ width: 1, color: COLORS.PANEL_ACCENT, alpha: 0.32 });
    });
    panel.addChild(outlines);
  }

  createFrame(title, rect, outerSide = null) {
    const panel = new PIXI.Container();
    panel.label = `${(title || "unnamed").toLowerCase()}Panel`;
    panel.position.set(rect.x, rect.y);
    panel.addChild(this.drawPanelFrame(new PIXI.Graphics(), rect, outerSide));
    this.drawPanelOutline(panel, rect, outerSide);
    if (title) {
      const heading = new PIXI.Text({
        text: title,
        style: {
          fontFamily: "Quantico",
          fontSize: 16,
          fontWeight: "bold",
          fill: COLORS.HUD_LABEL,
        },
      });
      heading.anchor.set(0.5, 0);
      heading.position.set(rect.width / 2, 12);
      panel.addChild(heading);
    }
    this.root.addChild(panel);
    return panel;
  }

  create() {
    this.holdPanel = this.createFrame(
      "POCKET",
      this.layout.hold,
      this.layout.hold.detached ? null : "left",
    );
    this.nextPanel = this.createFrame(
      "QUEUE",
      this.layout.next,
      this.layout.next.detached ? null : "right",
    );
    if (SHOW_GARBAGE_METER)
      this.garbagePanel = this.createFrame("", this.layout.garbage);
    if (SHOW_ITEM_PANEL) {
      this.itemPanel = this.createFrame(
        "",
        this.layout.items,
        this.layout.items.detached ? null : "bottom",
      );
      this.itemPanel.label = "itemsPanel";
      this.createItemSlots(this.itemPanel, this.layout.items);
    }
    this.livesText = new PIXI.Text({
      text: "",
      style: { fontFamily: "sans-serif", fontSize: HUD_LIVES_FONT_SIZE },
    });
    this.livesText.label = "livesIndicator";
    this.livesText.anchor.set(0.5, 1);
    this.livesText.position.set(this.layout.hold.width / 2, HUD_LIVES_Y_OFFSET);
    this.livesText.visible = false;
    this.holdPanel.addChild(this.livesText);

    this.statsPanel = new PIXI.Container();
    this.statsPanel.label = "statisticsPanel";
    this.statsPanel.position.set(this.layout.stats.x, this.layout.stats.y);
    this.statsText = new PIXI.HTMLText({
      text: "",
      style: {
        fontFamily: HUD_STATS_FONT_FAMILY,
        fontSize: HUD_STATS_LABEL_FONT_SIZE,
        fontWeight: "bold",
        fill: HUD_STATS_LABEL_COLOR,
        align: "right",
        cssOverrides: `
          .stat { line-height: ${HUD_STATS_GROUP_LINE_HEIGHT}px; margin-bottom: ${HUD_STATS_GROUP_GAP}px; }
          .label { color: ${HUD_STATS_LABEL_COLOR}; font-size: ${HUD_STATS_LABEL_FONT_SIZE}px; }
          .current { color: ${HUD_STATS_CURRENT_COLOR}; font-size: ${HUD_STATS_CURRENT_FONT_SIZE}px; }
          .target { color: ${HUD_STATS_TARGET_COLOR}; font-size: ${HUD_STATS_TARGET_FONT_SIZE}px; }
          .scoreTarget { color: ${HUD_STATS_TARGET_COLOR}; font-size: ${HUD_STATS_SCORE_TARGET_FONT_SIZE}px; }
          .stat.completed .label { color: ${HUD_STATS_COMPLETED_LABEL_COLOR}; }
          .stat.completed .current { color: ${HUD_STATS_COMPLETED_CURRENT_COLOR}; }
          .stat.completed .target, .stat.completed .scoreTarget { color: ${HUD_STATS_COMPLETED_TARGET_COLOR}; }
        `,
        tagStyles: {
          ".stat": {
            lineHeight: HUD_STATS_GROUP_LINE_HEIGHT,
          },
          ".label": { color: HUD_STATS_LABEL_COLOR, fontSize: HUD_STATS_LABEL_FONT_SIZE },
          ".current": { color: HUD_STATS_CURRENT_COLOR, fontSize: HUD_STATS_CURRENT_FONT_SIZE },
          ".target": { color: HUD_STATS_TARGET_COLOR, fontSize: HUD_STATS_TARGET_FONT_SIZE },
          ".scoreTarget": { color: HUD_STATS_TARGET_COLOR, fontSize: HUD_STATS_SCORE_TARGET_FONT_SIZE },
        },
      },
    });
    this.statsText.label = "statisticsText";
    this.statsText.anchor.set(1, 0);
    this.statsText.position.set(this.layout.stats.width - HUD_STATS_RIGHT_PADDING, 0);
    this.statsPanel.addChild(this.statsText);
    this.root.addChild(this.statsPanel);

    this.holdPreview = new PIXI.Container();
    this.nextPreview = new PIXI.Container();
    this.holdPreview.label = "holdPreview";
    this.nextPreview.label = "nextQueuePreview";
    const slotWidth = this.layout.hold.width - PREVIEW_SLOT_INSET * 2;
    this.holdPreviewSlots = [
      {
        x: PREVIEW_SLOT_INSET,
        y: HOLD_PREVIEW_Y,
        width: slotWidth,
        height:
          this.layout.hold.height - HOLD_PREVIEW_Y - HOLD_PREVIEW_SLOT_BOTTOM,
        padding: PREVIEW_SLOT_PADDING,
      },
    ];
    this.nextPreviewSlots = Array.from(
      { length: NEXT_QUEUE_SLOTS },
      (_, index) => ({
        x: PREVIEW_SLOT_INSET,
        y: NEXT_PREVIEW_Y + index * NEXT_SLOT_SPACING,
        width: this.layout.next.width - PREVIEW_SLOT_INSET * 2,
        height: NEXT_PREVIEW_SLOT_HEIGHT,
        padding: PREVIEW_SLOT_PADDING,
      }),
    );
    // Slot geometry remains the authoritative fit boundary for previews.
    // Intentionally disabled: visible slot outlines are too noisy in the HUD,
    // but the renderer is kept for quick visual debugging when needed.
    // this.createPreviewSlots(this.holdPanel, this.holdPreviewSlots, "holdPreviewSlots");
    // this.createPreviewSlots(this.nextPanel, this.nextPreviewSlots, "nextPreviewSlots");
    this.holdPanel.addChild(this.holdPreview);
    this.nextPanel.addChild(this.nextPreview);
    this.holdRenderer = new PreviewPanel(this.layout.hold.width, this.material);
    this.nextRenderer = new PreviewPanel(this.layout.next.width, this.material);
  }

  setHoldAction(callback) {
    this.holdAction = callback;
    this.holdPanel.eventMode = "static";
    this.holdPanel.cursor = "pointer";
    this.holdPanel.removeAllListeners("pointertap");
    this.holdPanel.on("pointertap", (event) => {
      this.holdAction?.({
        source: event.pointerType === "touch" ? "touch" : "pointer",
        originalEvent: event,
      });
    });
  }

  // The game-over panel is part of the Pixi HUD, so its replay action stays
  // local to the active Playfield rather than depending on DOM tap handling.
  setRestartAction(callback) {
    this.restartAction = callback;
  }

  // State and scoring text are HUD presentation, not GameManager state. The
  // manager only asks this object to announce a change in the game session.
  createOverlays() {
    this.overlay = new PIXI.Container();
    this.overlay.label = "hudOverlay";
    this.overlayRoot.addChild(this.overlay);
    this.message = new PIXI.Text({
      text: "3",
      style: {
        fontFamily: "Quantico",
        fontSize: 26,
        fontWeight: "bold",
        align: "center",
        fill: COLORS.FIELD_TEXT,
        stroke: { color: COLORS.CALLOUT_STROKE, width: 4 },
        dropShadow: true,
        dropShadowColor: COLORS.BLACK,
        dropShadowDistance: START_MESSAGE_SHADOW_DISTANCE,
        dropShadowBlur: START_MESSAGE_SHADOW_BLUR,
        dropShadowAlpha: START_MESSAGE_SHADOW_ALPHA,
      },
    });
    this.message.anchor.set(0.5);
    this.message.label = "stateMessage";
    this.message.position.set(
      this.overlayLayout.centerX,
      this.overlayLayout.centerY,
    );
    this.overlay.addChild(this.message);

    // Keep the top-out treatment separate from the start prompt. The report
    // itself is rebuilt from the completed game's immutable statistics.
    this.gameOverMessage = new PIXI.Container();
    this.gameOverMessage.label = "gameOverMessage";
    this.gameOverMessage.position.set(
      this.overlayLayout.centerX,
      this.overlayLayout.centerY,
    );
    this.gameOverMessage.visible = false;
    this.overlay.addChild(this.gameOverMessage);

    this.callout = new PIXI.Container();
    this.callout.label = "clearCallout";
    this.calloutMain = new PIXI.Text({
      text: "",
      style: {
        fontFamily: "Quantico, sans-serif",
        fontSize: CALLOUT_MAIN_FONT_SIZE,
        fontWeight: "bold",
        fill: COLORS.CALLOUT_TEXT,
        align: "center",
        stroke: { color: COLORS.CALLOUT_STROKE, width: 5 },
      },
    });
    this.calloutCombo = new PIXI.Text({
      text: "",
      style: {
        fontFamily: "Quantico, sans-serif",
        fontSize: CALLOUT_COMBO_FONT_SIZE,
        fontWeight: "bold",
        fill: COLORS.HUD_LABEL,
        align: "center",
        stroke: { color: COLORS.CALLOUT_STROKE, width: 3 },
      },
    });
    this.calloutPoints = new PIXI.Text({
      text: "",
      style: {
        fontFamily: "Quantico, sans-serif",
        fontSize: CALLOUT_POINTS_FONT_SIZE,
        fontWeight: "bold",
        fill: COLORS.SCORE_TEXT,
        align: "center",
        stroke: { color: COLORS.CALLOUT_STROKE, width: 3 },
      },
    });
    this.calloutType = new PIXI.Text({
      text: "",
      style: {
        // The resolved line name is the secondary headline. Combo and points
        // remain supporting text, while SINGLE/DOUBLE/etc. stays prominent.
        fontFamily: "Quantico, sans-serif",
        fontSize: CALLOUT_MAIN_FONT_SIZE,
        fontWeight: "bold",
        fill: COLORS.HUD_LABEL,
        align: "center",
        stroke: { color: COLORS.CALLOUT_STROKE, width: 3 },
      },
    });
    [
      this.calloutMain,
      this.calloutCombo,
      this.calloutType,
      this.calloutPoints,
    ].forEach((line) => line.anchor.set(0.5));
    this.callout.addChild(
      this.calloutCombo,
      this.calloutMain,
      this.calloutType,
      this.calloutPoints,
    );
    this.callout.position.set(
      this.overlayLayout.centerX,
      this.overlayLayout.y + 55,
    );
    this.callout.alpha = 0;
    this.overlay.addChild(this.callout);
    this.calloutLife = 0;
    this.calloutPopTime = 0;
    this.perfectClearCallout = false;
    this.perfectClearPulseTime = 0;
  }

  hideStateMessage() {
    this.message.visible = false;
    this.gameOverMessage.visible = false;
  }

  showCountdown(text, { color = COLORS.FIELD_TEXT } = {}) {
    this.gameOverMessage.visible = false;
    this.message.text = text;
    this.message.style.fill = color;
    // Countdown callouts are deliberately dominant; the normal HUD prompt is
    // never used during scene entry, so it can safely use this larger style.
    this.message.style.fontSize = 156;
    this.message.style.dropShadowDistance = START_MESSAGE_SHADOW_DISTANCE;
    this.message.style.dropShadowBlur = START_MESSAGE_SHADOW_BLUR;
    this.message.style.dropShadowAlpha = START_MESSAGE_SHADOW_ALPHA;
    this.message.visible = true;
    // GO! stays steady. Only the numeric beats receive the scale-in motion.
    this.countdownEnterElapsed = text === "GO!" ? null : 0;
    this.message.alpha = 1;
    this.message.scale.set(
      text === "GO!" ? 1 : COUNTDOWN_ENTER_START_SCALE,
    );
  }

  showPaused() {
    this.gameOverMessage.visible = false;
    this.message.text = "PAUSED";
    this.message.style.fontSize = 39;
    this.message.style.dropShadowDistance = START_MESSAGE_SHADOW_DISTANCE * 4;
    this.message.style.dropShadowBlur = START_MESSAGE_SHADOW_BLUR * 4;
    this.message.style.dropShadowAlpha = 1;
    this.message.visible = true;
    this.message.alpha = 1;
    this.message.scale.set(1);
    this.countdownEnterElapsed = undefined;
  }

  gameOverTitle(text, color) {
    return new PIXI.Text({
      text,
      style: {
        fontFamily: "Quantico",
        fontSize: 42,
        fontWeight: "bold",
        fill: color,
        stroke: { color: COLORS.CALLOUT_STROKE, width: 5 },
        dropShadow: true,
        dropShadowColor: COLORS.BLACK,
        dropShadowDistance: GAME_OVER_TITLE_SHADOW_DISTANCE,
        dropShadowBlur: GAME_OVER_TITLE_SHADOW_BLUR,
        dropShadowAlpha: GAME_OVER_TITLE_SHADOW_ALPHA,
        padding: GAME_OVER_SHADOW_PADDING,
      },
    });
  }

  drawGameOverFrame(panel, width, height) {
    const left = -width / 2;
    const top = -height / 2;
    const radius = 16;
    const points = [
      new PIXI.Point(left + radius, top),
      new PIXI.Point(left + width - radius, top),
    ];
    AdvancedLineRenderer.appendQuadratic(
      points,
      new PIXI.Point(left + width, top),
      new PIXI.Point(left + width, top + radius),
    );
    points.push(new PIXI.Point(left + width, top + height - radius));
    AdvancedLineRenderer.appendQuadratic(
      points,
      new PIXI.Point(left + width, top + height),
      new PIXI.Point(left + width - radius, top + height),
    );
    points.push(new PIXI.Point(left + radius, top + height));
    AdvancedLineRenderer.appendQuadratic(
      points,
      new PIXI.Point(left, top + height),
      new PIXI.Point(left, top + height - radius),
    );
    points.push(new PIXI.Point(left, top + radius));
    AdvancedLineRenderer.appendQuadratic(
      points,
      new PIXI.Point(left, top),
      new PIXI.Point(left + radius, top),
    );
    new AdvancedLineRenderer({
      texture: AdvancedLineRenderer.getHalfParticleTexture(14),
      tint: COLORS.PANEL_ACCENT,
      leftWidth: 12,
      alpha: 0.78,
      closed: true,
      name: "gameOverPanelGlow",
    }).draw(panel, points.reverse());
  }

  showGameOver(score = 0, summary = {}) {
    this.message.visible = false;
    // A completed report replaces any transient clear or combo announcement.
    this.resetCallout();
    this.gameOverMessage
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }));

    const baseClears = summary.baseClears || [];
    const rows = [
      ["FIGURES DROPPED", summary.figuresDropped || 0],
      ["AVG. DROP RATE", `${(summary.dropsPerSecond || 0).toFixed(2)} / SEC`],
      ...baseClears.map(({ label, count }) => [label, count]),
      ...(summary.extras || []).map(({ label, count, biggest }) => [
        label,
        biggest ? `${count} (${biggest})` : count,
      ]),
    ];
    const spins = summary.spins || {};
    if (spins.all) rows.push(["ALL SPINS", spins.all]);
    if (summary.spawnedTypes?.has("T")) rows.push(["T-SPINS", spins.t || 0]);
    if (spins.tTriple) rows.push(["T-SPIN TRIPLES", spins.tTriple]);
    if (spins.penta) rows.push(["PENTASPINS", spins.penta]);
    if (spins.mega) rows.push(["MEGASPINS", spins.mega]);

    const width = GAME_OVER_PANEL_WIDTH;
    const height = Math.max(
      GAME_OVER_PANEL_MIN_HEIGHT,
      154 +
        rows.length * GAME_OVER_PANEL_ROW_HEIGHT +
        GAME_OVER_PANEL_PADDING +
        GAME_OVER_PLAY_AGAIN_GAP +
        GAME_OVER_PLAY_AGAIN_HEIGHT,
    );
    const panel = new PIXI.Container();
    panel.label = "gameOverPanel";
    const glass = new PIXI.Graphics()
      .roundRect(-width / 2, -height / 2, width, height, 16)
      .fill({ color: COLORS.PANEL_BG, alpha: 0.94 });
    glass.filters = [
      new PIXI.filters.BackdropBlurFilter({
        strength: GAME_OVER_BACKDROP_BLUR_STRENGTH,
        quality: GAME_OVER_BACKDROP_BLUR_QUALITY,
      }),
    ];
    panel.addChild(glass);
    this.drawGameOverFrame(panel, width, height);
    const animatedText = [];
    const animateText = (text) => {
      animatedText.push(text);
      return text;
    };

    const gameWord = this.gameOverTitle("GAME", COLORS.MENU_LOGO);
    const overWord = this.gameOverTitle("OVER", COLORS.MENU_LOGO_TEXT);
    this.gameOverTitleWords = { gameWord, overWord };
    const titleWidth = gameWord.width + overWord.width + 12;
    gameWord.anchor.set(0, 0.5);
    overWord.anchor.set(0, 0.5);
    const top = -height / 2 + GAME_OVER_PANEL_PADDING + 28;
    gameWord.position.set(-titleWidth / 2, top);
    overWord.position.set(-titleWidth / 2 + gameWord.width + 12, top);
    panel.addChild(animateText(gameWord), animateText(overWord));

    const scoreLabel = new PIXI.Text({
      text: score.toLocaleString(),
      style: {
        fontFamily: "Quantico",
        fontSize: GAME_OVER_SCORE_FONT_SIZE,
        fontWeight: "bold",
        fill: COLORS.HUD_VALUE,
        stroke: { color: COLORS.CALLOUT_STROKE, width: 3 },
      },
    });
    const scoreSuffix = new PIXI.Text({
      text: "PTS.",
      style: {
        fontFamily: "Quantico",
        fontSize: GAME_OVER_SCORE_SUFFIX_FONT_SIZE,
        fontWeight: "bold",
        fill: COLORS.HUD_LABEL,
      },
    });
    const scoreWidth = scoreLabel.width + scoreSuffix.width + 8;
    scoreLabel.anchor.set(0, 0.5);
    scoreSuffix.anchor.set(0, 0.5);
    scoreLabel.position.set(-scoreWidth / 2, top + 52);
    scoreSuffix.position.set(
      -scoreWidth / 2 + scoreLabel.width + 8,
      top + 56,
    );
    panel.addChild(animateText(scoreLabel), animateText(scoreSuffix));

    rows.forEach(([label, value], index) => {
      const y = top + 92 + index * GAME_OVER_PANEL_ROW_HEIGHT;
      const key = new PIXI.Text({
        text: label,
        style: {
          fontFamily: "Quantico",
          fontSize: GAME_OVER_DETAIL_FONT_SIZE,
          fontWeight: "bold",
          fill: COLORS.HUD_LABEL,
        },
      });
      const amount = new PIXI.Text({
        text: String(value),
        style: {
          fontFamily: "Quantico",
          fontSize: GAME_OVER_DETAIL_FONT_SIZE,
          fontWeight: "bold",
          fill: COLORS.HUD_VALUE,
        },
      });
      key.anchor.set(0, 0.5);
      amount.anchor.set(1, 0.5);
      key.position.set(-width / 2 + GAME_OVER_PANEL_PADDING, y);
      amount.position.set(width / 2 - GAME_OVER_PANEL_PADDING, y);
      panel.addChild(animateText(key), animateText(amount));
    });

    const playAgain = new PIXI.Container();
    playAgain.label = "gameOverPlayAgain";
    playAgain.eventMode = "static";
    playAgain.cursor = "pointer";
    const buttonX = -GAME_OVER_PLAY_AGAIN_WIDTH / 2;
    const buttonY =
      height / 2 + GAME_OVER_PLAY_AGAIN_GAP;
    this.gameOverPlacementY =
      top +
      92 +
      rows.length * GAME_OVER_PANEL_ROW_HEIGHT +
      GAME_OVER_PLAY_AGAIN_GAP +
      GAME_OVER_PLAY_AGAIN_HEIGHT / 2;
    const buttonFace = new PIXI.Graphics()
      .roundRect(
        buttonX,
        buttonY,
        GAME_OVER_PLAY_AGAIN_WIDTH,
        GAME_OVER_PLAY_AGAIN_HEIGHT,
        8,
      )
      .fill(COLORS.PANEL_ACCENT)
      .stroke({ width: 2, color: COLORS.MENU_LOGO_TEXT });
    buttonFace.label = "gameOverActionFace";
    const buttonLabel = new PIXI.Text({
      text: "PLAY AGAIN",
      style: {
        fontFamily: "Quantico",
        fontSize: 18,
        fontWeight: "bold",
        fill: COLORS.APP_BACKGROUND,
      },
    });
    buttonLabel.label = "gameOverActionLabel";
    buttonLabel.anchor.set(0.5);
    buttonLabel.position.set(0, buttonY + GAME_OVER_PLAY_AGAIN_HEIGHT / 2);
    playAgain.addChild(buttonFace, animateText(buttonLabel));
    playAgain.filters = [
      new PIXI.filters.DropShadowFilter({
        color: "#00aa00",
        alpha: 0.7,
        blur: 6,
        distance: 4,
        rotation: 90,
        quality: 4,
        padding: 16,
      }),
    ];
    playAgain.on("pointertap", (event) => {
      event.stopPropagation?.();
      if (this.gameOverRestartRemaining > 0) return;
      const action = this.gameOverAction?.onTrigger || this.restartAction;
      action?.({
        source: event.pointerType === "touch" ? "touch" : "pointer",
        originalEvent: event,
      });
    });
    // Keep the action outside the result panel: series placement text can use
    // the panel's lower area without being covered by a lobby action.
    this.gameOverMessage.addChild(panel, playAgain);
    this.gameOverEnterElapsed = 0;
    this.gameOverRestartRemaining = GAME_OVER_RESTART_INPUT_DELAY_MS;
    this.gameOverPlayAgain = playAgain;
    this.gameOverAction = { buttonFace, buttonLabel, onTrigger: null };
    this.gameOverTextEntries = animatedText.map((text, index) => ({
      text,
      delay: index * GAME_OVER_TEXT_ENTER_STAGGER_MS,
    }));
    this.gameOverTextElapsed = 0;
    this.gameOverTextEntries.forEach(({ text }) => {
      text.alpha = 0;
      text.scale.set(GAME_OVER_TEXT_ENTER_START_SCALE);
    });
    playAgain.alpha = 0.42;
    this.gameOverMessage.alpha = 0;
    this.gameOverMessage.scale.set(GAME_OVER_ENTER_START_SCALE);
    this.gameOverMessage.visible = true;
  }

  replaceGameOverTitle(text, color) {
    const title = this.gameOverTitleWords;
    if (!title) return;
    title.gameWord.text = text;
    title.gameWord.style.fill = color;
    title.gameWord.anchor.set(0.5);
    title.gameWord.x = 0;
    title.overWord.visible = false;
  }

  replaceGameOverTitleWords(first, firstColor, second, secondColor) {
    const title = this.gameOverTitleWords;
    if (!title) return;
    title.gameWord.text = first;
    title.gameWord.style.fill = firstColor;
    title.overWord.text = second;
    title.overWord.style.fill = secondColor;
    title.gameWord.anchor.set(0, 0.5);
    title.overWord.anchor.set(0, 0.5);
    title.overWord.visible = true;
    const gap = 12;
    const width = title.gameWord.width + title.overWord.width + gap;
    const left = -width / 2;
    title.gameWord.x = left;
    title.overWord.x = left + title.gameWord.width + gap;
  }

  replaceGameOverAction({ label, onTrigger, fill = 0xa8ff77, textColor = 0x061523, immediate = false } = {}) {
    const action = this.gameOverAction;
    if (!action) return;
    this.gameOverPlayAgain.visible = true;
    this.gameOverPlayAgain.alpha =
      this.gameOverRestartRemaining > 0 ? 0.42 : 1;
    if (immediate) {
      this.gameOverRestartRemaining = 0;
      this.gameOverPlayAgain.alpha = 1;
    }
    if (label) action.buttonLabel.text = label;
    action.buttonLabel.style.fill = textColor;
    action.buttonFace
      .clear()
      .roundRect(
        -GAME_OVER_PLAY_AGAIN_WIDTH / 2,
        action.buttonLabel.y - GAME_OVER_PLAY_AGAIN_HEIGHT / 2,
        GAME_OVER_PLAY_AGAIN_WIDTH,
        GAME_OVER_PLAY_AGAIN_HEIGHT,
        8,
      )
      .fill(fill)
      .stroke({ width: 2, color: COLORS.MENU_LOGO_TEXT });
    action.onTrigger = onTrigger || null;
  }

  hideGameOverAction() {
    if (this.gameOverPlayAgain) this.gameOverPlayAgain.visible = false;
  }

  resetCallout() {
    this.calloutLife = 0;
    this.callout.alpha = 0;
    this.perfectClearCallout = false;
  }

  showScoringCallout(
    primary,
    {
      combo = 0,
      points = 0,
      color = COLORS.CALLOUT_TEXT,
      x = this.overlayLayout.centerX,
      y = 115,
      majorClear = false,
      lineType = "",
      perfectClear = false,
      centered = perfectClear,
      prominent = perfectClear,
    } = {},
  ) {
    if (!primary) return;
    this.calloutMain.text = primary;
    this.calloutMain.style.fill = color;
    this.calloutMain.scale.set(
      prominent
        ? CALLOUT_PERFECT_CLEAR_SCALE
        : majorClear
          ? CALLOUT_MAJOR_CLEAR_SCALE
          : 1,
    );
    this.calloutMain.position.y = centered ? -34 : 0;
    this.calloutCombo.text = `COMBO ${combo}`;
    this.calloutCombo.position.set(
      0,
      centered ? 42 : CALLOUT_COMBO_Y_OFFSET,
    );
    this.calloutCombo.visible = combo > 1;
    this.calloutType.text = lineType;
    this.calloutType.position.set(0, centered ? 70 : 42);
    this.calloutType.visible = Boolean(lineType);
    this.calloutPoints.text = `+${points}`;
    this.calloutPoints.position.set(
      0,
      centered ? 98 : CALLOUT_POINTS_Y_OFFSET,
    );
    this.calloutPoints.visible = points > 0;
    // A Perfect Clear is a board-wide event, rather than a local line event.
    this.callout.position.set(
      centered ? this.overlayLayout.centerX : x,
      centered ? this.overlayLayout.centerY : y,
    );
    this.callout.alpha = 1;
    this.callout.scale.set(CALLOUT_POP_SCALE);
    this.calloutLife =
      850 * (perfectClear ? CALLOUT_PERFECT_CLEAR_DURATION_MULTIPLIER : 1);
    this.calloutPopTime = 0;
    this.perfectClearCallout = perfectClear;
    this.perfectClearPulseTime = 0;
  }

  showChainCallout(
    lines,
    row,
    combo = 0,
    spin = "",
    points = 0,
    perfect = false,
    allClear = false,
    extraMinos = 0,
  ) {
    const y =
      this.overlayLayout.y +
      Math.max(2, Math.min(this.overlayLayout.rows - 2, row)) *
        this.overlayLayout.cell *
        this.overlayLayout.scale;
    const clearName = `${chainName(lines)}${extraMinos > 0 ? `+${extraMinos}` : ""}!`;
    const primary = allClear
      ? "PERFECT\nCLEAR!!!"
      : [spin, perfect ? "PERFECT" : "", clearName].filter(Boolean).join(" ");
    this.showScoringCallout(primary, {
      combo,
      points,
      y,
      color: spin
        ? COLORS.SPIN_TEXT
        : lines >= 4
          ? COLORS.MAJOR_CLEAR_TEXT
          : COLORS.CALLOUT_CHAIN,
      majorClear: lines >= 4,
      lineType: allClear ? clearName : "",
      perfectClear: allClear,
    });
  }

  updateCallout(deltaMS) {
    if (this.gameOverRestartRemaining > 0) {
      this.gameOverRestartRemaining = Math.max(
        0,
        this.gameOverRestartRemaining - deltaMS,
      );
      if (this.gameOverRestartRemaining === 0 && this.gameOverPlayAgain)
        this.gameOverPlayAgain.alpha = 1;
    }
    if (this.gameOverEnterElapsed !== undefined) {
      this.gameOverEnterElapsed += deltaMS;
      const amount = Math.min(1, this.gameOverEnterElapsed / GAME_OVER_ENTER_DURATION_MS);
      const eased = 1 - Math.pow(1 - amount, 3);
      this.gameOverMessage.alpha = eased;
      this.gameOverMessage.scale.set(
        GAME_OVER_ENTER_START_SCALE + (1 - GAME_OVER_ENTER_START_SCALE) * eased,
      );
      if (amount >= 1) this.gameOverEnterElapsed = undefined;
    }
    if (this.gameOverTextElapsed !== undefined) {
      this.gameOverTextElapsed += deltaMS;
      let complete = true;
      this.gameOverTextEntries?.forEach(({ text, delay }) => {
        const amount = Math.max(
          0,
          Math.min(
            1,
            (this.gameOverTextElapsed - delay) / GAME_OVER_TEXT_ENTER_DURATION_MS,
          ),
        );
        const eased = 1 - Math.pow(1 - amount, 3);
        text.alpha = eased;
        text.scale.set(
          GAME_OVER_TEXT_ENTER_START_SCALE +
            (1 - GAME_OVER_TEXT_ENTER_START_SCALE) * eased,
        );
        if (amount < 1) complete = false;
      });
      if (complete) this.gameOverTextElapsed = undefined;
    }
    if (this.countdownEnterElapsed !== null && this.countdownEnterElapsed !== undefined) {
      this.countdownEnterElapsed += deltaMS;
      const amount = Math.min(1, this.countdownEnterElapsed / COUNTDOWN_ENTER_DURATION_MS);
      const eased = 1 - Math.pow(1 - amount, 3);
      this.message.scale.set(
        COUNTDOWN_ENTER_START_SCALE + (1 - COUNTDOWN_ENTER_START_SCALE) * eased,
      );
      if (amount >= 1) this.countdownEnterElapsed = undefined;
    }
    if (this.calloutLife <= 0) return;
    this.calloutLife -= deltaMS;
    this.calloutPopTime += deltaMS;
    if (this.perfectClearCallout) {
      this.perfectClearPulseTime += deltaMS;
      const pulse = (Math.sin(this.perfectClearPulseTime * 0.012) + 1) * 0.5;
      const gold = COLORS.PERFECT_CLEAR_GOLD;
      const green = COLORS.PERFECT_CLEAR_GREEN;
      const channel = (shift) =>
        Math.round(
          ((gold >> shift) & 0xff) * (1 - pulse) +
            ((green >> shift) & 0xff) * pulse,
        );
      this.calloutMain.style.fill =
        (channel(16) << 16) | (channel(8) << 8) | channel(0);
    }
    this.callout.alpha = Math.max(0, this.calloutLife / 250);
    // Pop size is intentionally independent from the callout lifetime. A
    // Perfect Clear stays longer, but must not keep growing while it does.
    const pop = Math.max(0, 1 - this.calloutPopTime / CALLOUT_POP_DURATION_MS);
    this.callout.scale.set(1 + (CALLOUT_POP_SCALE - 1) * pop);
    if (this.calloutLife <= 0) this.perfectClearCallout = false;
  }

  update({
    score,
    lines,
    level,
    elapsedMs = 0,
    hold,
    next,
    goals = {},
    goalProgress = {},
    trashLevel = 0,
    trashCleared = false,
    lives = 1,
    showHold = true,
    showQueue = true,
  }) {
    // Callers that deliberately have no objectives may pass null. Normalize it
    // here so the HUD always treats that as an empty objective set.
    goals = goals || {};
    goalProgress = goalProgress || {};
    this.holdPanel.visible = showHold;
    this.holdPanel.eventMode = showHold ? "static" : "none";
    this.nextPanel.visible = showQueue;
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    const missions = [];
    if (goals.score) missions.push(["SCORE", score, goals.scoreTarget, "score", score >= Number(goals.scoreTarget)]);
    if (goals.trashWin === "reach-level") missions.push(["TRASH", trashLevel, goals.trashLevel, "trash", trashLevel >= Number(goals.trashLevel)]);
    if (goals.trashWin === "clear-bottom-line")
      missions.push(["TRASH", "Clear bottom line", null, "trash", trashCleared]);
    if (goals.chains) missions.push(["LINES", lines, goals.chainTarget, "lines", lines >= Number(goals.chainTarget)]);
    if (goals.speed) missions.push(["SPEED", level, goals.speedTarget, "speed", level >= Number(goals.speedTarget)]);
    if (goals.combos) {
      const rank = Math.max(1, Number(goals.comboLength) || 1);
      missions.push([`${rank}-COMBOS`, goalProgress.combos || 0, goals.comboCount, "combos", (goalProgress.combos || 0) >= Number(goals.comboCount)]);
    }
    if (goals.chainGoals) {
      const rank = chainName(Math.max(1, Number(goals.chainLength) || 1));
      missions.push([pluralizeClearRank(rank), goalProgress.chains || 0, goals.chainCount, "chainGoals", (goalProgress.chains || 0) >= Number(goals.chainCount)]);
    }
    if (goals.megaspins)
      missions.push(["MEGASPINS", goalProgress.megaspins || 0, goals.megaspinCount, "megaspins", (goalProgress.megaspins || 0) >= Number(goals.megaspinCount)]);
    if (goals.perfectClears)
      missions.push(["ALL-CLEARS", goalProgress.perfectClears || 0, goals.perfectClearCount, "perfectClears", (goalProgress.perfectClears || 0) >= Number(goals.perfectClearCount)]);

    const defaults = [
      ["SCORE", score, null, "score"],
      ["CHAINS", lines, null, "lines"],
      ["SPEED", level, null, "speed"],
      ["TIME", `${minutes}:${seconds}`, null, "time"],
    ];
    const used = new Set(missions.map(([, , , key]) => key));
    const stats = [...missions, ...defaults.filter(([, , , key]) => !used.has(key))]
      .slice(0, 5);
    this.statsText.text = stats
      .map(([label, current, target, key, completed]) => statMarkup(label, current, target, key === "score", completed))
      .join("");
    // `lives` includes the board currently being played. The HUD deliberately
    // shows only the remaining retries, so three total lives starts as two
    // hearts and the final life shows no heart at all.
    const extraLives = Math.max(0, Math.floor(Number(lives) || 1) - 1);
    this.livesText.visible = extraLives > 0;
    this.livesText.text = extraLives > 4
      ? `💙 x ${extraLives}`
      : "💙".repeat(extraLives);
    this.holdRenderer.draw(
      this.holdPreview,
      hold ? [hold] : [],
      this.holdPreviewSlots,
      HOLD_PREVIEW_SCALE,
    );
    this.nextRenderer.draw(
      this.nextPreview,
      next.slice(0, NEXT_QUEUE_SLOTS),
      this.nextPreviewSlots,
      NEXT_PREVIEW_SCALE,
    );
  }

  destroy() {
    [
      this.holdPanel,
      this.nextPanel,
      this.statsPanel,
      this.garbagePanel,
      this.itemPanel,
    ]
      .filter(Boolean)
      .forEach((panel) => panel.destroy({ children: true }));
    this.overlay.destroy({ children: true });
  }
}
