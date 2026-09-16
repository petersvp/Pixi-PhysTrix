/**
 * Implements the Box2D-backed Physics gameplay mode.
 * This class owns the physics world, controlled body, release, and simulation.
 * The shared GameManager supplies input, timing, state, and common rendering.
 * It converts physics line vanishes into shared score and chain callouts.
 * Its exports are constructed through the application mode registry.
 *
 * This module is part of the gameplay layer of PhysTrix.
 */

import { GameplayContract } from "./GameplayContract.js";
import { GameManager } from "../game/GameManager.js";
import { godEssenceValue, isDifficultClear, pmOrderAttackValue } from "../game/AttackValue.js";
import {
  guidelineAllClearScore,
  guidelineComboScore,
  guidelineScore,
  guidelineSpinScore,
} from "../game/Scoring.js";
import {
  CELL,
  COLS,
  PHYSICS_RELEASE_SPAWN_MAX_WAIT_MS,
  PHYSICS_RELEASE_SPAWN_MIN_WAIT_MS,
  ROWS,
} from "../config/gameplayConstants.js";
import {
  CLEAR_PARTICLE_COUNT_PER_MINO,
  LINE_CLEAR_PARTICLE_HORIZONTAL_FORCE,
  LINE_CLEAR_PARTICLE_VERTICAL_FORCE,
  MINO_BREAK_PARTICLE_HORIZONTAL_FORCE,
  MINO_BREAK_PARTICLE_VERTICAL_FORCE,
  PLACEMENT_OUTLINE_PARTICLE_COUNT,
} from "../config/effectsConstants.js";
import {
  TRASH_UP_CALLOUT_COLOR,
  TRASH_UP_TRANSITION_MS,
} from "../config/trashConstants.js";

export class PhysicsGameplay extends GameplayContract {
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

  attach(game) {
    this.physics = game.playfield.createPhysicsWorld(
      globalThis.Box2D,
      game.session?.physicsPreset,
      {
        ...game.session?.roomRules?.physics,
        chain: game.session?.roomRules?.chain,
      },
    );
    game.physics = this.physics;
    game.board.isValid = (cells) =>
      cells.every(
        ({ x, y }) =>
          x >= 0 && x < game.cols && y < game.rows && !this.physics.pointOccupied(x, y),
      );
    game.board.raycastClear = (_from, to) => game.board.isValid(to);
    game.physicsLayer = game.playfield.physicsLayer;
  }

  reset() {
    this.physics.clear();
    this.combo = 0;
    this.backToBack = false;
    this.pendingSpin = "";
    this.pendingSpinOrder = 4;
    this.awaitingPostLockScan = false;
    this.releaseWaitElapsed = 0;
    this.releasePending = false;
    this.trashUpRemaining = 0;
  }

  spawnTrash(_game, trash) {
    if (trash.enabled) this.physics.spawnTrash(trash.cells());
  }

  onSpawn(_game, piece) {
    this.physics.createControlled(piece);
  }

  onGameOver() {
    this.physics.destroyControlled();
  }

  lock(
    game,
    {
      spawn = true,
      emitPlacementParticles = true,
      scanImmediately = true,
      hardDrop = false,
    } = {},
  ) {
    const piece = game.active;
    if (!piece) return null;
    if (piece.cells().length > game.rows * game.cols) {
      console.error("[Physics] Refusing oversized active polyomino before lock.", {
        cells: piece.cells().length,
        maximum: game.rows * game.cols,
      });
      return [];
    }
    // A fresh lock closes the prior turn's spin window, whether or not this
    // newly locked polyomino itself qualifies as a spin.
    this.pendingSpin = game.detectSpin(piece);
    this.pendingSpinOrder = piece.order;
    game.statistics.recordDrop();
    this.awaitingPostLockScan = true;
    const cells = piece.cells().filter((cell) => cell.y >= 0);
    this.physics.destroyControlled();
    const lockedBodies = this.physics.lock(piece) || [];
    if (hardDrop)
      lockedBodies.forEach((body) => this.physics.beginHardDropMass(body));
    if (emitPlacementParticles)
      game.playfield.effects.outlineBurst(
        cells,
        piece.color,
        PLACEMENT_OUTLINE_PARTICLE_COUNT,
      );
    if (scanImmediately) {
      const scan = this.physics.scanImmediately();
      // This lock already received its post-lock scan, so do not let a later
      // periodic scan incorrectly reset the combo while its vanish resolves.
      if (!scan.rows.length) {
        this.combo = 0;
        this.backToBack = false;
      }
      this.awaitingPostLockScan = false;
    }
    if (spawn) game.spawn();
    return lockedBodies;
  }

  release(game) {
    if (this.releasePending) return false;
    // Releasing is not a Guideline lock: it silently hands the body to the
    // simulation, without a forced line scan or placement-impact particles.
    const releasedBodies = this.lock(game, {
      spawn: false,
      emitPlacementParticles: false,
      scanImmediately: false,
    });
    releasedBodies.forEach((body) => this.physics.beginReleaseMass(body));
    game.active = null;
    game.grounded = false;
    game.lockTimer = 0;
    this.releaseWaitElapsed = 0;
    this.releasePending = true;
    return true;
  }

  isControlFrozen() {
    return Boolean(
      this.releasePending ||
        this.trashUpRemaining > 0 ||
        this.physics?.hasPendingVanish(),
    );
  }

  step(game, ms) {
    // Freeze the full simulation while the Trash Up celebration is readable.
    // The next random static field appears only after this short transition.
    if (this.trashUpRemaining > 0) {
      this.trashUpRemaining -= ms;
      if (this.trashUpRemaining <= 0) {
        this.trashUpRemaining = 0;
        this.physics.spawnTrash(game.trash.cells());
      }
      return;
    }
    if (this.releasePending) {
      this.releaseWaitElapsed += ms;
      const minimumElapsed =
        this.releaseWaitElapsed >= PHYSICS_RELEASE_SPAWN_MIN_WAIT_MS;
      const maximumElapsed =
        this.releaseWaitElapsed >= PHYSICS_RELEASE_SPAWN_MAX_WAIT_MS;
      // After the grace period, wait for the real Box2D point queries to say
      // the queued spawn is free. The max timeout forces a visible top-out.
      if (
        maximumElapsed ||
        (minimumElapsed && game.canSpawn(game.queue.peek()))
      ) {
        this.releasePending = false;
        game.spawn();
      }
    }
    // A marked line is a short resolve phase. Leave the kinematic body where
    // it is, but do not resync it from player input until the vanish finishes.
    if (!this.isControlFrozen() && game.active)
      this.physics.syncControlled(game.active, ms);
    const result = this.physics.step(ms);
    // Combo expiry is evaluated only by the first actual frame-rule scan after
    // a lock. Empty ticker frames and the vanish delay cannot reset it.
    if (this.awaitingPostLockScan && result.scanned) {
      if (!result.rows.length) {
        this.combo = 0;
        this.backToBack = false;
      }
      this.awaitingPostLockScan = false;
    }
    if (result.broken.length) {
      // Each penetrated mino is worth half of a guideline single. This is
      // separate from line statistics and combo progression.
      const breakPoints = Math.round(
        result.broken.length * guidelineScore(1, game.level) * 0.5,
      );
      game.score += breakPoints;
      result.broken.forEach((tile) =>
        game.playfield.effects.burst(
          tile.x,
          tile.y,
          game.playfield.physicsRenderer.colorFor(tile, tile.baseColor),
          CLEAR_PARTICLE_COUNT_PER_MINO * 3,
          MINO_BREAK_PARTICLE_HORIZONTAL_FORCE,
          MINO_BREAK_PARTICLE_VERTICAL_FORCE,
          tile.angle,
        ),
      );
      const averageRow =
        result.broken.reduce((sum, tile) => sum + tile.y, 0) /
        result.broken.length;
      const averageColumn =
        result.broken.reduce((sum, tile) => sum + tile.x, 0) /
        result.broken.length;
      game.playfield.hud.showScoringCallout(`+${breakPoints}`, {
        color: game.playfield.physicsRenderer.colorFor(
          result.broken[0],
          result.broken[0].baseColor,
        ),
        x:
          game.playfield.layout.x +
          (averageColumn + 0.5) * CELL * game.playfield.layout.scale,
        y:
          game.playfield.layout.y +
          averageRow * CELL * game.playfield.layout.scale,
      });
    }
    const vanished = result.vanished;
    if (!vanished.length) return;
    const lines =
      result.vanishedLines.length || Math.floor(vanished.length / game.cols);
    if (!lines) return;
    game.playfield.matchPunch();
    vanished.forEach((tile) =>
      game.playfield.effects.burst(
        tile.x,
        tile.y,
        game.playfield.physicsRenderer.colorFor(tile, tile.baseColor),
        CLEAR_PARTICLE_COUNT_PER_MINO,
        LINE_CLEAR_PARTICLE_HORIZONTAL_FORCE,
        LINE_CLEAR_PARTICLE_VERTICAL_FORCE,
      ),
    );
    this.combo += 1;
    game.lines += lines;
    game.sound.clear(Math.min(4, lines));
    const spin = this.pendingSpin;
    const straightnessMultiplier = result.vanishedLines.length
      ? result.vanishedLines.reduce(
          (sum, row) => sum + row.scoreMultiplier,
          0,
        ) / result.vanishedLines.length
      : 1;
    const perfect =
      result.vanishedLines.length > 0 &&
      result.vanishedLines.every((row) => row.perfect);
    const extraMinos = result.vanishedLines.reduce(
      (sum, row) => sum + (Number(row.extraMinoCount) || 0),
      0,
    );
    const baseScore = spin
      ? guidelineSpinScore(
          spin,
          Math.min(3, lines),
          game.level,
          this.pendingSpinOrder,
        )
      : guidelineScore(Math.min(4, lines), game.level);
    const trashUp = game.trash.enabled && !this.physics.hasTrash();
    if (trashUp) {
      // Trash progression clears every locked body, but deliberately leaves
      // the current controlled piece alone. The next random trash level then
      // becomes the only settled field and is never a Perfect Clear.
      this.physics.clearLockedBodies();
      game.trash.advance();
      this.trashUpRemaining = TRASH_UP_TRANSITION_MS;
    }
    const allClear = !trashUp && this.physics.bodies.length === 0;
    game.statistics.recordClear(lines, allClear);
    game.statistics.recordSpin(spin, lines, this.pendingSpinOrder);
    const pointsAwarded =
      Math.round(baseScore * straightnessMultiplier) +
      guidelineComboScore(this.combo, game.level) +
      (allClear ? guidelineAllClearScore(lines, game.level) : 0);
    game.score += pointsAwarded;
    const difficult = isDifficultClear(lines, spin);
    const backToBack = difficult && this.backToBack;
    this.backToBack = difficult;
    const attack = pmOrderAttackValue(
      lines,
      spin,
      game.session?.roomRules?.pvp,
      this.combo - 1,
      backToBack,
    );
    game.addGodEssence(godEssenceValue(
      lines,
      spin,
      game.session?.roomRules?.pvp,
      this.combo - 1,
      backToBack,
    ));
    if (attack) { console.info("[PhysTrix] Generated attack", attack); game.onAttack?.({ attackType: "attachments", value: attack, source: game }); }
    game.updateSpeed();
    if (this.combo >= (Number(game.session?.roomRules?.win?.comboLength) || Infinity))
      game.goalProgress.combos += 1;
    if (lines >= (Number(game.session?.roomRules?.win?.chainLength) || Infinity))
      game.goalProgress.chains += 1;
    if (spin === "MEGASPIN") game.goalProgress.megaspins += 1;
    if (allClear) game.goalProgress.perfectClears += 1;
    const averageRow =
      vanished.reduce((sum, tile) => sum + tile.y, 0) / vanished.length;
    if (trashUp)
      game.playfield.hud.showScoringCallout("TRASH\nUP!", {
        combo: this.combo,
        points: pointsAwarded,
        color: TRASH_UP_CALLOUT_COLOR,
        perfectClear: true,
        y:
          game.playfield.layout.y +
          averageRow * CELL * game.playfield.layout.scale,
      });
    else
      game.playfield.hud.showChainCallout(
        lines,
        averageRow,
        this.combo,
        spin,
        pointsAwarded,
        perfect,
        allClear,
        extraMinos,
      );
    // The spin belongs to the piece that was locked before the currently
    // controlled polyomino. A successful vanish consumes that one-turn flag.
    this.pendingSpin = "";
    this.pendingSpinOrder = 4;
  }

  render(game) {
    game.playfield.physicsRenderer.render(this.physics);
  }

  dispose() {
    this.physics?.clear();
  }

  destroy() {
    this.game?.destroy();
  }
}
