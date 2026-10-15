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

const METAL_CRUSH_LOCK_DISPLAY_MS = 90;

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
    this.resolveChainCount = 0;
    this.backToBack = false;
    this.trashUpPending = false;
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
  playClusteredImpacts(game) {
    // Clustered mode is discrete Board gravity, not Box2D physics. Board
    // records only groups which reached settled support during this solve.
    // Tune clustered impacts here. Its value is the number of rows the group
    // dropped: a group that falls six rows sends 6 / this divider to FMOD.
    const CLUSTERED_IMPACT_DIVIDER = 5;
    // Consume completed landings once. The fall animation steps every frame,
    // so retaining a completed record would replay the same impact each step.
    game.board.lastStickyImpacts.splice(0).forEach(({ fallDistance, position, material, health }) =>
      game.emitAudioEvent(material === "metal" ? "impactMetal" : "impactPlastic", {
        intensity: fallDistance / CLUSTERED_IMPACT_DIVIDER,
        position,
        ...(material === "metal" ? { health: Math.max(1, Number(health) || 1) } : {}),
      }),
    );
  }

  beginPendingMinoDrops(game) {
    if (game.hasGodEssencePassiveEffect("shield")) {
      this.clearPendingMinoDrops();
      return false;
    }
    const drops = game.takePendingMinoDrops();
    if (!drops) return false;
    const chain = game.session?.roomRules?.chain || {};
    const clustered = this.gravityType(game) === "clustered";
    game.board.spawnMetalDrops(drops, game.queueRandom, {
      colorMode: ["color-lines", "color-clusters"].includes(chain.mode),
      colorCount: chain.colorCount,
      settleImmediately: !clustered,
      animateFall: !clustered,
      resilient: game.session?.roomRules?.pvp?.minoDropsResilient === true,
    });
    if (clustered) game.board.beginClusteredFall();
    this.resolve = { phase: "fall", initialScan: false };
    return true;
  }
  clearPendingMinoDrops() {
    this.minoDropsAfterInitialScan = false;
    this.minoDropsAfterResolve = false;
  }
  recordDestroyedTrash(destroyed = []) {
    if (destroyed.some((tile) => tile?.trash)) this.trashUpPending = true;
  }
  beginTrashUpIfCleared(game, announce = false) {
    if (!this.trashUpPending || !game.trash.enabled || game.trash.boardHasTrash(game.board))
      return false;
    this.trashUpPending = false;
    game.board.reset();
    game.trash.advance();
    this.resolve = { phase: "trashUp", remaining: TRASH_UP_TRANSITION_MS };
    if (announce) {
      game.playfield.matchPunch();
      game.playfield.hud.showScoringCallout("TRASH\nUP!", {
        combo: game.classicCombo,
        points: 0,
        color: TRASH_UP_CALLOUT_COLOR,
        perfectClear: true,
        y: game.playfield.layout.y + (game.playfield.layout.rows / 2) * CELL * game.playfield.layout.scale,
      });
      game.emitAudioEvent("chainClear", {
        chainCount: 1,
        comboLevel: game.classicCombo,
        isSpin: 0,
        perfectClear: false,
        trashUp: true,
        gameSpeed: game.level,
      });
    }
    return true;
  }
  resolveMaterialBreaks(game) {
    const destroyed = game.board.takeMaterialDestroyedTiles();
    if (!destroyed.length) return 0;
    // A material break is a real destruction, not a silent board rewrite:
    // it resolves God Essence, collects gems, awards score and visibly tears
    // adjacent minos through Board.markTornEdges.
    game.emitAudioEvent("materialBreak", {
      tiles: destroyed.map((tile) => ({ ...tile })),
    });
    game.consumeDestroyedGodEssenceTiles(destroyed);
    game.collectGodGems(destroyed);
    this.recordDestroyedTrash(destroyed);
    const points = destroyed.length * guidelineScore(1, game.level);
    game.score += points;
    destroyed.forEach((tile) =>
      game.playfield.effects.burst(
        tile.x,
        tile.y,
        game.playfield.renderer.colorFor(tile, tile.baseColor),
        CLEAR_PARTICLE_COUNT_PER_MINO,
        LINE_CLEAR_PARTICLE_HORIZONTAL_FORCE,
        LINE_CLEAR_PARTICLE_VERTICAL_FORCE,
      ));
    return destroyed.length;
  }
  destroyGodEssenceTiles(
    game,
    cells,
    { applyGravity = true, preservePendingResolve = false } = {},
  ) {
    const gravity = this.gravityType(game);
    const destroyed = game.board.destroyCells(cells, gravity, {
      applyGravity,
    });
    if (!destroyed.length) return false;
    // A Classic direct item effect is inserted before the match that revealed
    // its item is removed. Preserve that already-detected match so its normal
    // rows/cells still own the sole Classic gravity pass afterwards.
    if (!applyGravity && preservePendingResolve && this.resolve?.phase === "mark")
      game.godEssencePreserveMarkedResolve = true;
    // Item destruction can run while a chain scan is still collecting its
    // coordinates. Board gravity invalidates those coordinates, so the caller
    // must discard that old scan rather than clear whatever moved into them.
    game.godEssenceBoardMutationEpoch = (game.godEssenceBoardMutationEpoch || 0) + 1;
    game.consumeDestroyedGodEssenceTiles(destroyed);
    game.collectGodGems(destroyed);
    this.recordDestroyedTrash(destroyed);
    game.score += destroyed.length * guidelineScore(1, game.level);
    destroyed.forEach((tile) => game.playfield.effects.burst(
      tile.x, tile.y, game.playfield.renderer.colorFor(tile, tile.baseColor),
      CLEAR_PARTICLE_COUNT_PER_MINO, LINE_CLEAR_PARTICLE_HORIZONTAL_FORCE,
      LINE_CLEAR_PARTICLE_VERTICAL_FORCE,
    ));
    game.emitAudioEvent("materialsClear", {
      tiles: destroyed.map((tile) => ({ ...tile })),
      mode: game.session?.roomRules?.chain?.mode || "lines-out",
    });
    // A Clustered Grid destruction changes the settled field outside the ordinary
    // lock path. `destroyCells` has already calculated the sticky-gravity
    // destinations and assigned renderY to moving minos; finish it through
    // the ordinary clustered fall resolver. Classic deliberately remains on
    // its direct per-column gravity path and does not enter collapse.
    if (applyGravity && gravity === "clustered")
      this.resolve = { phase: "fall", initialScan: false };
    return true;
  }
  fractureGodEssenceTiles(game, cells) {
    const fractured = game.board.disconnectCells(cells, this.gravityType(game)).length > 0;
    if (fractured)
      game.godEssenceBoardMutationEpoch = (game.godEssenceBoardMutationEpoch || 0) + 1;
    // disconnectCells has already assigned clustered destinations and their
    // renderY origins. Keep gameplay in its normal fall resolver so that
    // visual motion completes before another scan/spawn can replace it.
    if (fractured && this.gravityType(game) === "clustered")
      this.resolve = { phase: "fall", initialScan: false };
    return fractured;
  }

  lock(game) {
    game.beginGodEssenceTurn();
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
    this.resolveMaterialBreaks(game);
    game.completeGodEssenceLock(piece);
    game.active = null;
    this.pendingSpin = spin;
    this.pendingSpinOrder = piece.order;
    // A turn owns one possible drop batch. It becomes eligible only after
    // this lock has received its first chain scan.
    this.minoDropsAfterInitialScan = true;
    this.minoDropsAfterResolve = false;
    if (game.board.resolveSlipperyBreakGravity(this.gravityType(game))) {
      // In Classic this animates affected columns into the opened Ice space.
      // In Clustered it starts a full collapse; the existing fall completion
      // path then runs the ordinary line/colour scan for the next chain.
      this.resolve = { phase: "fall", initialScan: true };
      return;
    }
    if (game.board.hasPendingFillerFall()) {
      // Filler's vertical relocation is a visible fall before the newly
      // filled cells may participate in a scan or the next piece may spawn.
      this.resolve = { phase: "fall", initialScan: true };
      return;
    }
    if (game.board.hasPendingMetalCrush()) {
      // Display the ordinary lock first, then the board performs its one-row
      // Metal crush and uses renderY for the animated fall to its destination.
      this.resolve = {
        phase: "metal-crush",
        remaining: METAL_CRUSH_LOCK_DISPLAY_MS,
        initial: true,
      };
      return;
    }
    // A disconnected authored shape is still scanned at its lock position.
    // Clustered gravity starts only after that instant scan found no clear.
    if (partCount > 1 && this.gravityType(game) === "clustered") {
      const clearedAtLock = this.scan(game, true, { spawn: false });
      if (clearedAtLock || this.resolve) return;
      game.board.beginClusteredFall();
      this.resolve = { phase: "fall", initialScan: false };
      return;
    }
    this.scan(game, true);
  }
  scan(game, initial = false, { spawn = true } = {}) {
    // Every path that can destroy trash records it. The actual level advance
    // is deliberately centralized at the next chain scan, so bombs, electric
    // clears, material breaks, and ordinary line clears all agree.
    if (this.beginTrashUpIfCleared(game, true)) return true;
    const chainRules = game.session?.roomRules?.chain || {};
    if (game.hasGodEssencePassiveEffect("no-chains")) {
      const groups = findColorChainGroups(game.board, chainRules);
      const rows = chainRules.mode === "lines-out"
        ? game.board.findFullLines(game.hasGodEssencePassiveEffect("catalyst") ? 1 : 0)
          .flatMap((y) => Array.from({ length: game.board.cols }, (_unused, x) => ({ x, y })))
        : [];
      game.notifyNoChainsBlocked([...groups.flatMap((group) => group.cells), ...rows]);
      this.resolve = null;
      if (spawn) game.spawn();
      return false;
    }
    const chainBreak = game.pendingGodEssenceChainBreak || game.hasGodEssencePassiveEffect("chain-break");
    const scanRules = chainBreak
      ? {
        ...chainRules,
        ...(chainRules.mode === "color-lines" ? { chainBreakLineReduction: 1 } : {}),
        ...(chainRules.mode === "color-clusters" ? { chainBreakClusterReduction: 4 } : {}),
      }
      : chainRules;
    // First inspect the unsealed board for feedback only. A would-be chain
    // touching a seal pulses once, then the real pass below treats that area
    // as empty and cannot resolve it.
    if (game.lineSeals.length) {
      const rawGroups = findColorChainGroups(game.board, scanRules);
      const rawCells = rawGroups.flatMap((group) => group.cells);
      const rawRows = chainRules.mode === "lines-out"
        ? game.board.findFullLines(game.hasGodEssencePassiveEffect("catalyst") ? 1 : 0)
          .flatMap((y) => Array.from({ length: game.board.cols }, (_unused, x) => ({ x, y })))
        : [];
      const blocked = [...rawCells, ...rawRows].filter(({ x, y }) => game.isLineSealed(x, y));
      game.notifyLineSealBlocked(blocked);
    }
    const colorGroups = findColorChainGroups(game.board, {
      ...scanRules,
      isSealedCell: (x, y) => game.isLineSealed(x, y),
    });
    const colorCells = [
      ...new Map(
        colorGroups.flatMap((group) =>
          group.cells.map((cell) => [`${cell.x},${cell.y}`, cell]),
        ),
      ).values(),
    ];
    // A colour mode owns removal exclusively; do not fall through to Lines
    // Out simply because the current scan has no qualifying colour chain.
    const rows = chainRules.mode === "lines-out"
      ? game.board.findFullLines(game.hasGodEssencePassiveEffect("catalyst") ? 1 : 0)
        .filter((y) => !game.isLineSealed(0, y))
      : [];
    if (game.pendingGodEssenceChainBreak && ["color-lines", "color-clusters"].includes(chainRules.mode))
      game.pendingGodEssenceChainBreak = false;
    if (rows.length || colorCells.length) {
      game.consumeLineSealsForMatch();
      if (initial && this.minoDropsAfterInitialScan) {
        this.minoDropsAfterInitialScan = false;
        this.minoDropsAfterResolve = true;
      }
      const isColorClear = colorCells.length > 0;
      const matchedCells = colorCells.length
        ? colorCells
        : rows.flatMap((y) => Array.from({ length: game.board.cols }, (_value, x) => ({ x, y })));
      // Detection itself always marks first. Metal/trash durability changes
      // only after the vanish delay, alongside the normal removal step.
      // This keeps protected matches inside the same visible chain lifecycle.
      game.board.markCells(matchedCells);
      this.resolve = {
        phase: "mark",
        remaining: CLASSIC_VANISH_DURATION_MS,
        initial,
        rows,
        colorCells,
        matchedCells,
        isColorClear,
        cellClear: true,
        colorGroups,
      };
      return true;
    }
    // The initial clear may have earned a pending falling-mino batch. It must
    // begin only after every marked removal and clustered fall has settled;
    // starting it in the mark phase overwrote renderY and made clusters snap.
    if (this.minoDropsAfterResolve) {
      this.minoDropsAfterResolve = false;
      if (this.beginPendingMinoDrops(game)) return true;
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
  awardClear(
    game,
    lines,
    clearedRows = [],
    trashUp = false,
    extraMinos = 0,
    clearedTiles = game.board.lastClearedTiles,
  ) {
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
    const minoDrops = minoDropAttackValue(
      lines,
      spin,
      game.session?.roomRules?.pvp,
      game.classicCombo - 1,
      backToBack,
    );
    const attacks = [
      attack && { attackType: "attachments", value: game.modifyOutgoingAttack(attack) },
      minoDrops && { attackType: "mino-drops", value: game.modifyOutgoingAttack(minoDrops) },
    ].filter(Boolean);
    const selectedAttack = attacks.length > 1
      ? attacks[Math.floor(game.queueRandom() * attacks.length)]
      : attacks[0];
    if (selectedAttack && game.onAttack) {
      game.awardAttackDefense(selectedAttack.value, lines);
      game.onAttack({
        ...selectedAttack,
        source: game,
        vaporizedCells: (clearedTiles || []).map(({ x, y }) => ({ x, y })),
      });
    }
    game.updateSpeed();
    if (game.classicCombo >= (Number(game.session?.roomRules?.win?.comboLength) || Infinity))
      game.goalProgress.combos += 1;
    if (lines >= (Number(game.session?.roomRules?.win?.chainLength) || Infinity))
      game.goalProgress.chains += 1;
    if (spin === "MEGASPIN") game.goalProgress.megaspins += 1;
    if (allClear) game.goalProgress.perfectClears += 1;
    game.sound.clear(lines);
    game.emitAudioEvent("materialsClear", {
      tiles: clearedTiles.map((tile) => ({ ...tile })),
      mode: game.session?.roomRules?.chain?.mode || "lines-out",
    });
    game.emitAudioEvent("chainClear", {
      chainCount: Math.max(1, this.resolveChainCount ?? 1),
      comboLevel: game.classicCombo,
      isSpin: game.spinAudioValue(spin, lines, this.pendingSpinOrder),
      perfectClear: allClear,
      trashUp,
      gameSpeed: game.level,
    });
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
    this.resolveChainCount = 0;
  }
  step(game, ms) {
    if (!this.resolve) return;
    if (this.resolve.phase === "metal-crush") {
      this.resolve.remaining -= ms;
      if (this.resolve.remaining > 0) return;
      const moved = game.board.resolvePendingMetalCrush();
      const impact = game.board.takeMetalCrushImpact();
      if (impact)
        game.emitAudioEvent("impactMetal", {
          intensity: 1,
          position: impact.position,
          health: impact.health,
        });
      this.resolveMaterialBreaks(game);
      if (game.board.resolveSlipperyBreakGravity(this.gravityType(game))) {
        this.resolve = { phase: "fall", initialScan: true };
        return;
      }
      if (!moved) {
        this.resolve = null;
        this.scan(game, true);
        return;
      }
      // A metal crush can destroy a stationary trash mino. In Clustered mode
      // that newly opened cell must start the ordinary component-collapse
      // pass before the next scan, just like a falling-mino attack. That
      // resolver's follow-up scans are chain continuations, not a new lock.
      const clustered = this.gravityType(game) === "clustered";
      // Do not start clustered gravity yet: it rebuilds the board and erases
      // Metal's existing renderY origin, making its mandatory one-row crush
      // visibly snap. Begin that secondary collapse after Metal lands.
      this.resolve = { phase: "fall", initialScan: !clustered, afterMetalCrushFall: clustered };
      return;
    }
    if (this.resolve.phase === "mark") {
      this.resolve.remaining -= ms;
      if (this.resolve.remaining > 0) return;
      const gravity = this.gravityType(game);
      const initial = this.resolve.initial;
      const matchedCells = this.resolve.matchedCells;
      // Metal has three states: intact metal, cracked metal, then a normal
      // mino. Trash follows its own 3 -> 2 -> 1 durability path. Do this at
      // the moment marked cells resolve, not while the highlight is starting.
      const clearCells = game.board.protectTrashCells(
        game.board.protectMetalCells(matchedCells, game.queueRandom),
      );
      const clearKeys = new Set(clearCells.map(({ x, y }) => `${x},${y}`));
      matchedCells.forEach(({ x, y }) => {
        if (clearKeys.has(`${x},${y}`)) return;
        const tile = game.board.get(x, y);
        if (tile) tile.marked = false;
      });
      const boardMutationEpoch = game.godEssenceBoardMutationEpoch || 0;
      game.consumeGodEssenceItemsAt(clearCells);
      // Color Remover and Lightning Bolt hold the resolver at its marked
      // state until their one-second electric telegraph destroys its targets.
      // Do not collapse or begin the next chain beneath that presentation.
      if (game.godEssenceEffectLocked) return;
      const preserveMarkedResolve = game.godEssencePreserveMarkedResolve === true;
      game.godEssencePreserveMarkedResolve = false;
      if (
        (game.godEssenceBoardMutationEpoch || 0) !== boardMutationEpoch &&
        !preserveMarkedResolve
      ) {
        // Item effects can perform their own destruction/gravity pass. The
        // marked coordinates are stale in that case. A Clustered direct
        // destruction has already entered the fall resolver; do not replace
        // it with an immediate scan or its logical positions and renderY
        // animation diverge until some later collapse repairs the display.
        game.board.forEachCell((tile) => { delete tile.marked; });
        if (this.resolve?.phase === "fall") return;
        this.resolve = null;
        this.scan(game, initial);
        return;
      }
      // If a Classic bomb opened a hole in an already-detected Lines Out
      // clear, resolve the stored full rows. Their y+line-count shifts remain
      // authoritative even where the bomb removed a tile first.
      const cleared = preserveMarkedResolve && this.resolve.rows.length
        ? game.board.clearRows(this.resolve.rows, gravity, true)
        : this.resolve.cellClear
          ? game.board.resolveMarkedCells(gravity)
          : game.board.resolveMarkedLines(gravity);
      // A durability-only detection removes no cells, so Board has no reason
      // to invoke gravity itself. Clustered mode still needs its full animated
      // collapse before the next detection.
      if (!cleared && gravity === "clustered") game.board.beginClusteredFall();
      const lines = this.resolve.isColorClear
        ? Math.max(1, this.resolve.colorGroups.length)
        : this.resolve.rows.length || cleared;
      const resolvedRows = this.resolve.rows;
      const extraMinos = this.resolve.colorGroups.reduce(
        (sum, group) => sum + (Number(group.extraMinoCount) || 0),
        0,
      );
      const clearedTiles = game.board.lastClearedTiles.map((tile) => ({ ...tile }));
      game.collectDefenseFromDestroyedTiles(clearedTiles);
      this.resolveChainCount = this.resolve.isColorClear
        ? this.resolve.colorGroups.length
        : this.resolve.rows.length;
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
      game.collectGodGems(game.board.lastClearedTiles);
      this.recordDestroyedTrash(clearedTiles);
      const trashUp = this.beginTrashUpIfCleared(game);
      this.awardClear(game, lines, resolvedRows, trashUp, extraMinos, clearedTiles);
      if (trashUp) {
        // beginTrashUpIfCleared already installed the transition state.
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
    const stillFalling = game.board.updateFallAnimation(ms);
    // Board releases each queued clustered impact at that group's individual
    // visual landing time, even while other groups remain in the air.
    this.playClusteredImpacts(game);
    if (stillFalling) return;
    if (this.resolve.afterMetalCrushFall) {
      const moved = game.board.beginClusteredFall();
      this.resolve = { phase: "fall", initialScan: false };
      if (moved) return;
    }
    this.scan(game, Boolean(this.resolve.initialScan));
  }

  destroy() {
    this.game?.destroy();
  }
}
