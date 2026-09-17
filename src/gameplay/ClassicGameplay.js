/**
 * Implements the discrete, board-backed Classic gameplay mode.
 * This class owns classic locking, line clears, scoring, and spin callouts.
 * The shared GameManager supplies input, timing, state, and common rendering.
 * No simulation bodies are created for this mode.
 * Its exports are constructed through the application mode registry.
 *
 * This module is part of the gameplay layer of PhysTrix.
 */

import { GameplayContract } from "./GameplayContract.js";
import { GameManager } from "../game/GameManager.js";
import {
  guidelineAllClearScore,
  guidelineComboScore,
  guidelineScore,
  guidelineSpinScore,
} from "../game/Scoring.js";
import { chainName, findColorChainGroups } from "../game/ChainSystem.js";
import { godEssenceValue, isDifficultClear, minoDropAttackValue, pmOrderAttackValue } from "../game/AttackValue.js";
import {
  CLASSIC_VANISH_DURATION_MS,
  CELL,
} from "../config/gameplayConstants.js";
import {
  CLEAR_PARTICLE_COUNT_PER_MINO,
  LINE_CLEAR_PARTICLE_HORIZONTAL_FORCE,
  LINE_CLEAR_PARTICLE_VERTICAL_FORCE,
  PLACEMENT_OUTLINE_PARTICLE_COUNT,
} from "../config/effectsConstants.js";
import { COLORS } from "../config/colors.js";
import {
  TRASH_UP_CALLOUT_COLOR,
  TRASH_UP_TRANSITION_MS,
} from "../config/trashConstants.js";

export class ClassicGameplay extends GameplayContract {
  constructor({ mount, session = null, app = null, sceneRoot = null }) {
    super();
    this.mount = mount;
    this.session = session;
    this.app = app;
    this.sceneRoot = sceneRoot;
  }
  start() {
    this.game = new GameManager({
      mount: this.mount,
      gameplay: this,
      session: this.session,
      app: this.app,
      sceneRoot: this.sceneRoot,
    });
  }
  reset() {
    this.resolve = null;
    this.pendingSpin = "";
    this.pendingSpinOrder = 4;
    this.backToBack = false;
    this.minoDropsAfterInitialScan = false;
    this.minoDropsAfterResolve = false;
  }
  spawnTrash(game, trash) {
    if (trash.enabled) trash.populateBoard(game.board);
  }
  isControlFrozen() {
    return Boolean(this.resolve);
  }
  gravityType(game) {
    return game.session?.roomRules?.grid?.gravityType === "classic"
      ? "classic"
      : "clustered";
  }

  beginPendingMinoDrops(game) {
    const drops = game.takePendingMinoDrops();
    if (!drops) return false;
    const chain = game.session?.roomRules?.chain || {};
    const clustered = this.gravityType(game) === "clustered";
    game.board.spawnMetalDrops(drops, game.queueRandom, {
      colorMode: ["color-lines", "color-clusters"].includes(chain.mode),
      colorCount: chain.colorCount,
      settleImmediately: !clustered,
      animateFall: !clustered,
    });
    if (clustered) game.board.settle(true);
    this.resolve = { phase: "fall", initialScan: false };
    return true;
  }

  lock(game) {
    const piece = game.active;
    const spin = game.detectSpin(piece);
    const lockedCells = piece.cells().filter((cell) => cell.y >= 0);
    game.statistics.recordDrop();
    game.playfield.effects.outlineBurst(
      lockedCells,
      piece.color,
      PLACEMENT_OUTLINE_PARTICLE_COUNT,
    );
    const partCount = game.board.lock(piece);
    game.active = null;
    this.pendingSpin = spin;
    this.pendingSpinOrder = piece.order;
    // A turn owns one possible drop batch. It becomes eligible only after
    // this lock has received its first chain scan.
    this.minoDropsAfterInitialScan = true;
    this.minoDropsAfterResolve = false;
    // A disconnected authored shape is still scanned at its lock position.
    // Clustered gravity starts only after that instant scan found no clear.
    if (partCount > 1 && this.gravityType(game) === "clustered") {
      const clearedAtLock = this.scan(game, true, { spawn: false });
      if (clearedAtLock || this.resolve) return;
      game.board.settle(true);
      this.resolve = { phase: "fall", initialScan: false };
      return;
    }
    this.scan(game, true);
  }
  scan(game, initial = false, { spawn = true } = {}) {
    const chainRules = game.session?.roomRules?.chain || {};
    const colorGroups = findColorChainGroups(game.board, chainRules);
    const colorCells = [
      ...new Map(
        colorGroups.flatMap((group) =>
          group.cells.map((cell) => [`${cell.x},${cell.y}`, cell]),
        ),
      ).values(),
    ];
    // A colour mode owns removal exclusively; do not fall through to Lines
    // Out simply because the current scan has no qualifying colour chain.
    const rows = chainRules.mode === "lines-out" ? game.board.findFullLines() : [];
    if (rows.length || colorCells.length) {
      if (initial && this.minoDropsAfterInitialScan) {
        this.minoDropsAfterInitialScan = false;
        this.minoDropsAfterResolve = true;
      }
      const isColorClear = colorCells.length > 0;
      const matchedCells = colorCells.length
        ? colorCells
        : rows.flatMap((y) => Array.from({ length: game.board.cols }, (_value, x) => ({ x, y })));
      // Metal has three states: intact metal, cracked metal, then an ordinary
      // mino. The first two clears mutate it but do not remove it.
      const clearCells = game.board.protectTrashCells(
        game.board.protectMetalCells(matchedCells),
      );
      if (!clearCells.length) {
        this.resolve = null;
        if (initial && this.minoDropsAfterResolve) {
          this.minoDropsAfterResolve = false;
          if (this.beginPendingMinoDrops(game)) return true;
        }
        if (spawn) game.spawn();
        return false;
      }
      if (clearCells.length) game.board.markCells(clearCells);
      // Keep the original scan rows while the marked cells are visible. Once
      // they vanish, board compaction has already changed their coordinates.
      this.resolve = {
        phase: "mark",
        remaining: CLASSIC_VANISH_DURATION_MS,
        initial,
        rows,
        colorCells: clearCells,
        isColorClear,
        cellClear: true,
        colorGroups,
      };
      return true;
    }
    if (initial) {
      game.classicCombo = 0;
      this.backToBack = false;
      this.awardSpinWithoutClear(game);
      if (this.minoDropsAfterInitialScan) {
        this.minoDropsAfterInitialScan = false;
        if (this.beginPendingMinoDrops(game)) return true;
      }
    }
    this.resolve = null;
    if (spawn) game.spawn();
    return false;
  }
  awardSpinWithoutClear(game) {
    if (!this.pendingSpin) return;
    const pointsAwarded = guidelineSpinScore(
      this.pendingSpin,
      0,
      game.level,
      this.pendingSpinOrder,
    );
    game.score += pointsAwarded;
    game.playfield.hud.showScoringCallout(this.pendingSpin, {
      combo: 0,
      points: pointsAwarded,
      color: COLORS.SPIN_TEXT,
      y: game.playfield.layout.y + 2 * CELL * game.playfield.layout.scale,
    });
    this.pendingSpin = "";
  }
  awardClear(game, lines, clearedRows = [], trashUp = false, extraMinos = 0) {
    game.playfield.matchPunch();
    const spin = this.pendingSpin;
    game.lines += lines;
    game.classicCombo += 1;
    const allClear = !trashUp && game.board.isEmpty();
    game.statistics.recordClear(lines, allClear);
    game.statistics.recordSpin(spin, lines, this.pendingSpinOrder);
    const pointsAwarded =
      (spin
        ? guidelineSpinScore(
            spin,
            Math.min(3, lines),
            game.level,
            this.pendingSpinOrder,
          )
        : guidelineScore(Math.min(4, lines), game.level)) +
      guidelineComboScore(game.classicCombo, game.level) +
      (allClear ? guidelineAllClearScore(lines, game.level) : 0);
    game.score += pointsAwarded;
    const difficult = isDifficultClear(lines, spin);
    const backToBack = difficult && this.backToBack;
    this.backToBack = difficult;
    // Core numbers the first successful clear as combo 1; attack tables
    // number it as combo 0.
    const attack = pmOrderAttackValue(
      lines,
      spin,
      game.session?.roomRules?.pvp,
      game.classicCombo - 1,
      backToBack,
    );
    game.addGodEssence(godEssenceValue(
      lines,
      spin,
      game.session?.roomRules?.pvp,
      game.classicCombo - 1,
      backToBack,
    ));
    if (attack) game.onAttack?.({ attackType: "attachments", value: attack, source: game });
    const minoDrops = minoDropAttackValue(
      lines,
      spin,
      game.session?.roomRules?.pvp,
      game.classicCombo - 1,
      backToBack,
    );
    if (minoDrops) game.onAttack?.({ attackType: "mino-drops", value: minoDrops, source: game });
    game.updateSpeed();
    if (game.classicCombo >= (Number(game.session?.roomRules?.win?.comboLength) || Infinity))
      game.goalProgress.combos += 1;
    if (lines >= (Number(game.session?.roomRules?.win?.chainLength) || Infinity))
      game.goalProgress.chains += 1;
    if (spin === "MEGASPIN") game.goalProgress.megaspins += 1;
    if (allClear) game.goalProgress.perfectClears += 1;
    game.sound.clear(lines);
    const clearName = `${chainName(lines)}${extraMinos > 0 ? `+${extraMinos}` : ""}!`;
    const primary = trashUp
      ? "TRASH\nUP!"
      : allClear
      ? "PERFECT\nCLEAR!!!"
      : [spin, clearName].filter(Boolean).join(" ");
    game.playfield.hud.showScoringCallout(primary, {
      combo: game.classicCombo,
      points: pointsAwarded,
      color: trashUp
        ? TRASH_UP_CALLOUT_COLOR
        : spin
        ? COLORS.SPIN_TEXT
        : lines >= 4
          ? COLORS.MAJOR_CLEAR_TEXT
          : COLORS.CLEAR_TEXT,
      majorClear: lines >= 4,
      lineType: allClear ? clearName : "",
      // Trash Up reuses the celebratory All Clear animation without ever
      // presenting it as a Perfect Clear or awarding its bonus.
      perfectClear: allClear || trashUp,
      // The callout belongs to the physical line scan, not the board bottom.
      // Use the center when multiple rows clear together.
      y:
        game.playfield.layout.y +
        Math.max(
          2,
          Math.min(
            game.playfield.layout.rows - 2,
            clearedRows.length
              ? clearedRows.reduce((sum, row) => sum + row, 0) /
                  clearedRows.length
              : game.playfield.layout.rows - 2,
          ),
        ) *
          CELL *
          game.playfield.layout.scale,
    });
    this.pendingSpin = "";
    this.pendingSpinOrder = 4;
  }
  step(game, ms) {
    if (!this.resolve) return;
    if (this.resolve.phase === "mark") {
      this.resolve.remaining -= ms;
      if (this.resolve.remaining > 0) return;
      const gravity = this.gravityType(game);
      const cleared = this.resolve.cellClear
        ? game.board.resolveMarkedCells(gravity)
        : game.board.resolveMarkedLines(gravity);
      const lines = this.resolve.isColorClear
        ? Math.max(1, this.resolve.colorGroups.length)
        : this.resolve.rows.length || cleared;
      const extraMinos = this.resolve.colorGroups.reduce(
        (sum, group) => sum + (Number(group.extraMinoCount) || 0),
        0,
      );
      game.board.lastClearedTiles.forEach((tile) =>
        game.playfield.effects.burst(
          tile.x,
          tile.y,
        game.playfield.renderer.colorFor(tile, tile.baseColor),
        CLEAR_PARTICLE_COUNT_PER_MINO,
        LINE_CLEAR_PARTICLE_HORIZONTAL_FORCE,
        LINE_CLEAR_PARTICLE_VERTICAL_FORCE,
        ),
      );
      const trashUp =
        game.trash.enabled && !game.trash.boardHasTrash(game.board);
      if (trashUp) {
        game.board.reset();
        game.trash.advance();
      }
      this.awardClear(game, lines, this.resolve.rows, trashUp, extraMinos);
      if (trashUp) {
        this.resolve.phase = "trashUp";
        this.resolve.remaining = TRASH_UP_TRANSITION_MS;
      } else if (this.minoDropsAfterResolve) {
        this.minoDropsAfterResolve = false;
        if (!this.beginPendingMinoDrops(game)) this.resolve.phase = "fall";
      } else this.resolve.phase = "fall";
      return;
    }
    if (this.resolve.phase === "trashUp") {
      this.resolve.remaining -= ms;
      if (this.resolve.remaining > 0) return;
      game.trash.populateBoard(game.board);
      this.resolve = null;
      game.spawn();
      return;
    }
    if (game.board.updateFallAnimation(ms)) return;
    this.scan(game, Boolean(this.resolve.initialScan));
  }

  destroy() {
    this.game?.destroy();
  }
}
