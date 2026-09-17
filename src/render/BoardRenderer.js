/**
 * Draws the classic board, active polyomino, and ghost projection with Pixi Graphics.
 * Adjacent minos share a solid silhouette instead of rounded independent tiles.
 * Only corners exposed to empty space are rounded, matching the reference visuals.
 * Ghost cells use a plain Pixi outline so they never inherit the mino material.
 * Physics bodies are drawn separately by PhysicsRenderer from Box2D transforms.
 */

import { CELL, COLS, ROWS } from "../config/gameplayConstants.js";
import { COLORS } from "../config/colors.js";
import {
  PLAYFIELD_FRAME_EXTENSION,
  PLAYFIELD_FRAME_Y_OFFSET,
  PLAYFIELD_GLOW_CAP_LENGTH,
  PLAYFIELD_GLOW_CORNER_RADIUS,
  PLAYFIELD_GLOW_CURVE_SEGMENTS,
  PLAYFIELD_GLOW_DEBUG_POINTS,
  PLAYFIELD_GLOW_DEBUG_POINT_COLOR,
  PLAYFIELD_GLOW_DEBUG_POINT_RADIUS,
  PLAYFIELD_GLOW_MIDDLE_U,
  PLAYFIELD_HIGHLIGHT_LINE_WIDTH,
  PLAYFIELD_MAIN_LINE_WIDTH,
  PLAYFIELD_OUTER_LINE_WIDTH,
  PLAYFIELD_OUTER_GLOW_ALPHA,
  PLAYFIELD_OUTER_GLOW_OUTSET,
  PLAYFIELD_OUTER_GLOW_SPREAD,
} from "../config/uiConstants.js";
import { MinoQuadRenderer } from "./MinoQuadRenderer.js";
import { metalTint, normalTrashTint } from "./MetalTint.js";
import { AdvancedLineRenderer } from "./AdvancedLineRenderer.js";

const lightenColor = (color, amount) => {
  const lift = (channel) => Math.round(channel + (255 - channel) * amount);
  return (
    (lift((color >> 16) & 0xff) << 16) |
    (lift((color >> 8) & 0xff) << 8) |
    lift(color & 0xff)
  );
};

const MAX_GLOW_CURVE_SEGMENTS = 64;

export class BoardRenderer {
  constructor(
    backgroundGraphics,
    minoGraphics,
    glowLayer,
    frameLayer,
    material,
    trashMaterial = material,
    cols = COLS,
    rows = ROWS,
    specialMaterials = {},
  ) {
    this.cols = cols;
    this.rows = rows;
    // The playfield background, the active mino layer, and the border overlay are
    // all separate Pixi Graphics/Container objects so they can be redrawn and
    // updated independently during the render loop.
    this.background = backgroundGraphics;
    this.graphics = minoGraphics;
    this.glowLayer = glowLayer;
    this.frameLayer = frameLayer;
    this.background.label = "playfieldGrid";
    this.graphics.label = "classicMinoLayer";
    this.glowLayer.label = "playfieldGlowUnderlay";
    this.frameLayer.label = "playfieldFrameOverlay";
    this.crispFrame = new PIXI.Graphics();
    this.crispFrame.label = "playfieldCrispFrame";
    this.frameLayer.addChild(this.crispFrame);
    this.palette = [];
    this.trashAppearance = { desaturation: 0.5, damagedBrightness: 0.55 };
    // The fixed board must not be destroyed merely because an active mino
    // moves. These owned sublayers isolate expensive settled meshes from the
    // short-lived active piece, ghost, and marked-clear overlays.
    this.settledLayer = new PIXI.Container();
    this.settledLayer.label = "classicSettledMinoLayer";
    this.markedLayer = new PIXI.Container();
    this.markedLayer.label = "classicMarkedMinoLayer";
    this.ghostLayer = new PIXI.Container();
    this.ghostLayer.label = "classicGhostLayer";
    this.activeLayer = new PIXI.Container();
    this.activeLayer.label = "classicActiveMinoLayer";
    this.graphics.addChild(
      this.settledLayer,
      this.markedLayer,
      this.ghostLayer,
      this.activeLayer,
    );
    this.createTexturedGlowPath();
    this.drawStaticFrame();
    // Reuse a shared quad renderer to build connected, stylized mino tiles.
    this.quads = new MinoQuadRenderer(material);
    this.trashQuads = new MinoQuadRenderer(trashMaterial);
    this.specialQuads = new Map(Object.entries(specialMaterials).map(([name, settings]) => [name, new MinoQuadRenderer(settings)]));
  }

  setPalette(colors = []) {
    this.palette = colors.map((color) => Number.isFinite(color)
      ? color
      : Number.parseInt(String(color).replace("#", ""), 16));
    this.lastBoardSignature = null;
    this.lastActiveSignature = null;
  }

  setTrashAppearance({ desaturation, damagedBrightness } = {}) {
    if (Number.isFinite(desaturation)) this.trashAppearance.desaturation = Math.max(0, Math.min(1, desaturation));
    if (Number.isFinite(damagedBrightness)) this.trashAppearance.damagedBrightness = Math.max(0, Math.min(1, damagedBrightness));
    this.lastBoardSignature = null;
    this.lastActiveSignature = null;
  }

  colorFor(cell, fallback) {
    const color = Number.isInteger(cell.colorIndex) && cell.colorIndex >= 0
      ? this.palette[cell.colorIndex] ?? fallback
      : cell.baseColor ?? fallback;
    if (cell.trash && cell.material === "trash" && cell.trashHp === 1)
      return normalTrashTint(color, this.trashAppearance.desaturation);
    if (cell.material !== "metal") return color;
    return metalTint(color, cell.trash ? cell.trashHp : cell.metalLives, this.trashAppearance.desaturation, this.trashAppearance.damagedBrightness);
  }

  // The particle is authored in white. Pixi applies the rail color through
  // the path tint, letting the same half-particle texture serve every skin.
  createGlowTexture() {
    return AdvancedLineRenderer.getHalfParticleTexture(
      PLAYFIELD_OUTER_GLOW_SPREAD,
    );
  }

  appendArc(points, centerX, centerY, radius, startAngle, endAngle) {
    const configuredSegments = Number(PLAYFIELD_GLOW_CURVE_SEGMENTS);
    const segments = Math.min(
      MAX_GLOW_CURVE_SEGMENTS,
      Math.max(0, Math.floor(configuredSegments) || 0),
    );
    if (segments !== configuredSegments)
      console.error("[BoardRenderer] Invalid glow curve segment count.", {
        configuredSegments,
        segments,
      });
    for (let index = 1; index <= segments; index++) {
      const angle =
        startAngle +
        ((endAngle - startAngle) * index) / segments;
      points.push(
        new PIXI.Point(
          centerX + Math.cos(angle) * radius,
          centerY + Math.sin(angle) * radius,
        ),
      );
    }
  }

  buildGlowPoints() {
    const fieldHeight = this.rows * CELL;
    const outerInset = -PLAYFIELD_OUTER_GLOW_OUTSET;
    const railY = fieldHeight + Math.abs(outerInset) + 2;
    const leftX = outerInset;
    const rightX = this.cols * CELL - outerInset;
    const radius = Math.min(PLAYFIELD_GLOW_CORNER_RADIUS, (rightX - leftX) / 2);
    const capLength = Math.min(PLAYFIELD_GLOW_CAP_LENGTH, railY - radius);
    const points = [
      new PIXI.Point(leftX, -capLength),
      new PIXI.Point(leftX, capLength),
      new PIXI.Point(leftX, railY - radius),
    ];
    this.appendArc(
      points,
      leftX + radius,
      railY - radius,
      radius,
      Math.PI,
      Math.PI / 2,
    );
    points.push(new PIXI.Point(rightX - radius, railY));
    this.appendArc(
      points,
      rightX - radius,
      railY - radius,
      radius,
      Math.PI / 2,
      0,
    );
    points.push(
      new PIXI.Point(rightX, capLength),
      new PIXI.Point(rightX, -capLength),
    );
    return points;
  }

  createTexturedGlowPath() {
    const texture = this.createGlowTexture();
    this.glowPoints = this.buildGlowPoints();
    const last = this.glowPoints.length - 1;
    const capUvs = this.glowPoints.map((_point, index) =>
      index === 0 ? 0 : index === last ? 1 : PLAYFIELD_GLOW_MIDDLE_U,
    );
    this.outerGlow = new AdvancedLineRenderer({
      texture,
      tint: COLORS.FIELD_FRAME_OUTER,
      leftWidth: PLAYFIELD_OUTER_GLOW_SPREAD,
      rightWidth: 0,
      alpha: PLAYFIELD_OUTER_GLOW_ALPHA,
      name: "playfieldOuterGlowPath",
    }).draw(this.glowLayer, this.glowPoints, capUvs);
    this.drawGlowDebugPoints();
  }

  drawGlowDebugPoints() {
    if (!PLAYFIELD_GLOW_DEBUG_POINTS) return;
    this.glowDebugPoints = new PIXI.Graphics();
    this.glowDebugPoints.label = "playfieldGlowControlPoints";
    this.glowPoints.forEach((point) => {
      this.glowDebugPoints
        .circle(point.x, point.y, PLAYFIELD_GLOW_DEBUG_POINT_RADIUS)
        .fill({ color: PLAYFIELD_GLOW_DEBUG_POINT_COLOR, alpha: 1 })
        .stroke({ width: 1, color: COLORS.BLACK, alpha: 0.9 });
    });
    // The rope stays beneath fused panels, but its authoring markers need to
    // remain visible while tuning caps, so this debug-only overlay is above UI.
    this.frameLayer.addChild(this.glowDebugPoints);
  }

  drawStaticFrame() {
    const fieldHeight = this.rows * CELL;
    const frameExtension = PLAYFIELD_FRAME_EXTENSION;
    const frameYOffset = PLAYFIELD_FRAME_Y_OFFSET;
    const frame = this.crispFrame;
    frame.clear();
    // Keep these as actual Graphics strokes above the particle ribbon. The
    // ribbon supplies only the soft neon bloom; these three paths are the
    // white/cyan/blue physical playfield rail and deliberately have no top.
    [
      [
        PLAYFIELD_OUTER_LINE_WIDTH,
        COLORS.FIELD_FRAME_OUTER,
        0.52,
        -(frameExtension + 2),
      ],
      [
        PLAYFIELD_MAIN_LINE_WIDTH,
        COLORS.FIELD_FRAME_MAIN,
        0.48,
        -frameExtension,
      ],
      [
        PLAYFIELD_HIGHLIGHT_LINE_WIDTH,
        COLORS.FIELD_FRAME_HIGHLIGHT,
        0.92,
        -Math.max(1, frameExtension - 4),
      ],
    ].forEach(([width, color, alpha, inset]) => {
      frame
        .moveTo(inset, frameYOffset)
        .lineTo(inset, fieldHeight + Math.abs(inset) + 2 + frameYOffset)
        .lineTo(
          this.cols * CELL - inset,
          fieldHeight + Math.abs(inset) + 2 + frameYOffset,
        )
        .lineTo(this.cols * CELL - inset, frameYOffset)
        .stroke({ width, color, alpha, cap: "butt", join: "miter" });
    });
  }

  // Rebuild the full board visual each frame: background grid, outer border, and
  // all active/fixed tiles. This keeps the render layer stateful but deterministic.
  draw(board, piece, ghost, activeAsGhost = false) {
    // GameManager ticks at display rate, but the logical board normally does
    // not change at display rate. Avoid rebuilding every Graphics path, mesh,
    // and shader unless the board, active piece, or ghost actually changed.
    const signatureParts = [];
    board.forEachCell((tile, x, y) =>
      signatureParts.push([
        x,
        y,
        tile.colorIndex,
        tile.material,
        tile.metalLives,
        tile.trashHp,
        tile.trash,
        tile.pieceId,
        tile.marked,
        tile.broken,
        tile.renderY,
        tile.visualLinks,
      ]),
    );
    const boardSignature = JSON.stringify(signatureParts);
    const activeSignature = JSON.stringify({
      piece: piece
        ? [piece.type, piece.x, piece.y, piece.rotation, piece.minos.map((mino) => [mino.colorIndex, mino.material])]
        : null,
      ghost: ghost.map((cell) => [cell.x, cell.y, cell.colorIndex]),
      activeAsGhost,
    });
    const clearLayer = (layer) =>
      layer
        .removeChildren()
        .forEach((child) => child.destroy({ children: true }));
    if (!this.backgroundDrawn) {
      this.backgroundDrawn = true;
      const g = this.background;
      // The grid is invariant for a Playfield lifetime, so build it once.
      g.clear()
        .rect(0, 0, this.cols * CELL, this.rows * CELL)
        .fill(COLORS.FIELD_BG);
      for (let x = 0; x <= this.cols; x++)
        g.moveTo(x * CELL, 0)
          .lineTo(x * CELL, this.rows * CELL)
          .stroke({ width: 1, color: COLORS.FIELD_GRID, alpha: 0.22 });
      for (let y = 0; y <= this.rows; y++)
        g.moveTo(0, y * CELL)
          .lineTo(this.cols * CELL, y * CELL)
          .stroke({ width: 1, color: COLORS.FIELD_GRID, alpha: 0.22 });
    }
    // Paint each connected group of tiles as a single silhouette so adjacent minos
    // appear to share edges instead of being drawn as isolated boxes.
    const drawConnected = (target, cells, color, alpha, trash = false, material = "default") => {
      const set = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
      const layer = new PIXI.Container();
      layer.label = "connectedMinoGroup";
      (material === "trash" || (trash && material === "default")
        ? this.trashQuads
        : this.specialQuads.get(material) || this.quads).draw(
        layer,
        cells,
        color,
        (cell) =>
          cell.visualLinks
            ? {
                ...cell.visualLinks,
                broken: cell.broken,
              }
            : {
                top: set.has(`${cell.x},${cell.y - 1}`),
                right: set.has(`${cell.x + 1},${cell.y}`),
                bottom: set.has(`${cell.x},${cell.y + 1}`),
                left: set.has(`${cell.x - 1},${cell.y}`),
                topLeft: set.has(`${cell.x - 1},${cell.y - 1}`),
                topRight: set.has(`${cell.x + 1},${cell.y - 1}`),
                bottomRight: set.has(`${cell.x + 1},${cell.y + 1}`),
                bottomLeft: set.has(`${cell.x - 1},${cell.y + 1}`),
              },
        alpha,
      );
      target.addChild(layer);
    };
    // Ghost pieces are rendered as outlines only so they indicate the landing spot
    // without competing with the actual placed color blocks.
    const drawGhostOutline = (cells, color) => {
      if (!cells.length) return;
      const set = new Set(cells.map((cell) => `${cell.x},${cell.y}`));
      const outline = new PIXI.Graphics();
      outline.label = "ghostOutline";
      cells.forEach((cell) => {
        const x = cell.x * CELL;
        const y = cell.y * CELL;
        if (!set.has(`${cell.x},${cell.y - 1}`))
          outline.moveTo(x, y).lineTo(x + CELL, y);
        if (!set.has(`${cell.x + 1},${cell.y}`))
          outline.moveTo(x + CELL, y).lineTo(x + CELL, y + CELL);
        if (!set.has(`${cell.x},${cell.y + 1}`))
          outline.moveTo(x + CELL, y + CELL).lineTo(x, y + CELL);
        if (!set.has(`${cell.x - 1},${cell.y}`))
          outline.moveTo(x, y + CELL).lineTo(x, y);
      });
      outline.stroke({ width: 2, color, alpha: 0.82 });
      this.ghostLayer.addChild(outline);
    };
    if (boardSignature !== this.lastBoardSignature) {
      this.lastBoardSignature = boardSignature;
      clearLayer(this.settledLayer);
      clearLayer(this.markedLayer);
      // Group tiles by piece identity so each connected block is drawn once, even when
      // multiple cells share the same piece metadata.
      const groups = new Map();
      board.forEachCell((tile, x, y) => {
        const groupKey = `${tile.pieceId}:${tile.material || "default"}`;
        const group = groups.get(groupKey) || {
          color: this.colorFor(tile, tile.baseColor),
          cells: [],
        };
        group.cells.push({
          x,
          y,
          colorIndex: tile.colorIndex,
          color: this.colorFor(tile, tile.baseColor),
          renderY: tile.renderY,
          visualLinks: tile.visualLinks,
          broken: tile.broken,
          marked: tile.marked,
          trash: tile.trash,
          material: tile.material || "default",
        });
        groups.set(groupKey, group);
      });
      // Draw settled board tiles first so the active piece can be layered above them.
      groups.forEach((group) =>
        drawConnected(
          this.settledLayer,
          group.cells,
          group.color,
          1,
          group.cells[0]?.trash,
          group.cells[0]?.material,
        ),
      );
      // Marked classic rows use the same light, outline-only clear treatment as
      // physics minos. The material remains visible under the temporary glow.
      const markedGroups = new Map();
      groups.forEach((group) => {
        group.cells.filter((cell) => cell.marked).forEach((cell) =>
          markedGroups.set(
            cell.color,
            (markedGroups.get(cell.color) || []).concat(cell),
          ));
      });
      markedGroups.forEach((cells, color) => {
        const markedColor = lightenColor(color, 0.45);
        const layer = new PIXI.Container();
        layer.label = "classicMarkedMinoGlow";
        if (PIXI.filters?.GlowFilter)
          layer.filters = [
            new PIXI.filters.GlowFilter({
              distance: 12,
              outerStrength: 1.4,
              innerStrength: 0.2,
              color: markedColor,
              quality: 0.3,
              knockout: false,
            }),
          ];
        const outline = new PIXI.Graphics();
        outline.label = "classicMarkedMinoOutline";
        cells.forEach((cell) =>
          outline.roundRect(
            cell.x * CELL + 2,
            (cell.renderY ?? cell.y) * CELL + 2,
            CELL - 4,
            CELL - 4,
            5,
          ),
        );
        outline.stroke({ width: 3, color: markedColor, alpha: 1 });
        layer.addChild(outline);
        this.markedLayer.addChild(layer);
      });
    }
    if (activeSignature === this.lastActiveSignature) return;
    this.lastActiveSignature = activeSignature;
    clearLayer(this.ghostLayer);
    clearLayer(this.activeLayer);
    if (!piece) return;
    if (activeAsGhost) {
      // Mino material shaders do not expose a reliable global opacity control.
      // During a physics resolve, replace the visible active material with an
      // ordinary Pixi outline and hide the landing ghost altogether.
      drawGhostOutline(
        piece.cells().filter((cell) => cell.y >= 0),
        piece.averageColor(),
      );
      return;
    }
    // Overlay ghost and active piece outlines/tiles after the board is already drawn.
    drawGhostOutline(ghost || [], piece.averageColor());
    const activeCells = piece.cells();
    const activeOccupied = new Set(activeCells.map((cell) => `${cell.x},${cell.y}`));
    const linkedActiveCells = activeCells.map((cell) => ({
      ...cell,
      // Material groups render independently, but topology belongs to the
      // whole PM. Preserve links across ordinary/attachment/gem boundaries.
      visualLinks: {
        top: activeOccupied.has(`${cell.x},${cell.y - 1}`),
        right: activeOccupied.has(`${cell.x + 1},${cell.y}`),
        bottom: activeOccupied.has(`${cell.x},${cell.y + 1}`),
        left: activeOccupied.has(`${cell.x - 1},${cell.y}`),
        topLeft: activeOccupied.has(`${cell.x - 1},${cell.y - 1}`),
        topRight: activeOccupied.has(`${cell.x + 1},${cell.y - 1}`),
        bottomRight: activeOccupied.has(`${cell.x + 1},${cell.y + 1}`),
        bottomLeft: activeOccupied.has(`${cell.x - 1},${cell.y + 1}`),
      },
    }));
    const activeGroups = new Map();
    linkedActiveCells.forEach((cell) => {
      const material = cell.material || "default";
      const group = activeGroups.get(material) || [];
      group.push(cell);
      activeGroups.set(material, group);
    });
    activeGroups.forEach((cells, material) =>
      drawConnected(this.activeLayer, cells, piece.color, 1, false, material));
  }
}
