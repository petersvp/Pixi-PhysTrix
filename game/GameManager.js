/**
 * Runs a single gameplay session, including state, input, scoring, and rendering.
 *
 * This module is part of the game layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

import { Board } from "./Board.js";
import { GameState } from "./GameState.js";
import { PieceQueue } from "./PieceQueue.js";
import { loadPersistentSettings } from "./Settings.js";
import { InputManager } from "./InputManager.js";
import { Polyomino } from "./Polyomino.js";
import { projectGhost } from "./GhostProjection.js";
import { SoundEngine } from "../audio/SoundEngine.js";
import {
  CELL,
  COLS,
  DEBUG_NO_GAME_OVER,
  FIRST_MAX_GRAVITY_LEVEL,
  gravityIntervalForLevel,
  MIN_GRAVITY_INTERVAL_MS,
  MIN_LOCK_DELAY_MS,
  POST_MAX_GRAVITY_LOCK_REDUCTION_MS,
  ROWS,
} from "../config/gameplayConstants.js";
import {
  GAME_VIEWPORT_HEIGHT,
  GAME_VIEWPORT_WIDTH,
  PORTRAIT_PLAYFIELD_HORIZONTAL_BLEED,
} from "../config/uiConstants.js";
import {
  SPIN_OUTLINE_PARTICLE_COUNT,
  SPIN_OUTLINE_PARTICLE_FORCE,
} from "../config/effectsConstants.js";
import { ReflectionCapture } from "../render/ReflectionCapture.js";
import { Playfield } from "./Playfield.js";
import { TouchController } from "./TouchController.js";
import { TrashSystem } from "./TrashSystem.js";
import { GameStatistics } from "./GameStatistics.js";

// The reflection shader path remains authored and available, but its separate
// mino-only render-texture capture pass is deliberately disabled for now.
const ENABLE_REFLECTION_CAPTURE = false;

/** Shared Guideline controller; gameplay modes provide mode-specific world behavior. */
export class GameManager {
  constructor({
    mount,
    gameplay,
    session = null,
    app = null,
    sceneRoot = null,
  }) {
    this.mount = mount;
    this.gameplay = gameplay;
    this.session = session;
    this.settings = loadPersistentSettings();
    this.board = new Board();
    this.queue = new PieceQueue(Math.random, this.session?.polyominoPreset);
    this.input = new InputManager();
    this.sound = new SoundEngine(this.settings);
    this.state = GameState.START;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.elapsedMs = 0;
    this.statistics = new GameStatistics();
    this.startLevel = 0;
    this.gravity = 0;
    this.horizontalDirection = 0;
    this.horizontalRepeat = 0;
    this.horizontalInitial = true;
    this.softDropRepeat = 0;
    this.touchSoftDropTargetY = null;
    this.grounded = false;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.classicCombo = 0;
    this.id = 1;
    // Sessions always run inside AppShell's persistent v8 Application.
    // Creating a second renderer here would violate scene routing and can
    // invalidate the shared reflection targets.
    if (!app)
      throw new Error("GameManager requires the shared AppShell application.");
    this.app = app;
    this.root = sceneRoot || new PIXI.Container();
    this.root.label = "gameRoot";
    this.app.stage.label = "stage";
    if (!sceneRoot) this.app.stage.addChild(this.root);
    // PixiJS DevTools discovers global-script applications through this hook.
    // Keep it assigned to the current session when modes are switched.
    globalThis.__PIXI_DEVTOOLS__ = { app: this.app };
    this.playfield = new Playfield({
      root: this.root,
      cols: COLS,
      rows: ROWS,
      cell: CELL,
    });
    this.playfield.loadSkin(this.session?.skin);
    this.playfield.setHoldAction(() => this.holdPiece());
    this.playfield.setRestartAction(() => this.start());
    this.trash = new TrashSystem(this.session?.trash);
    this.gameplay.attach(this);
    this.reflectionCapture = ENABLE_REFLECTION_CAPTURE
      ? new ReflectionCapture(
          this.app,
          this.root,
          [this.playfield.minoLayer, this.physicsLayer].filter(Boolean),
        )
      : null;
    this.resize = () => {
      if (innerHeight > innerWidth) {
        // Portrait is a dedicated camera fit, not a scaled-down 900px desktop
        // canvas. Fit the visible HOLD/board/NEXT composition edge-to-edge;
        // glow may naturally extend past either viewport edge.
        const layout = this.playfield.layout;
        const left = Math.min(layout.hold.x, layout.stats.x, layout.x);
        const right = Math.max(
          layout.x + layout.scaledWidth,
          layout.next.x + layout.next.width,
        );
        const bleed = PORTRAIT_PLAYFIELD_HORIZONTAL_BLEED;
        const scale = (innerWidth + bleed * 2) / (right - left);
        this.root.scale.set(scale);
        this.root.position.set(
          -left * scale - bleed,
          (innerHeight - GAME_VIEWPORT_HEIGHT * scale) / 2,
        );
        return;
      }
      const s = Math.min(
        innerWidth / GAME_VIEWPORT_WIDTH,
        innerHeight / GAME_VIEWPORT_HEIGHT,
      );
      this.root.scale.set(s);
      this.root.position.set(
        (innerWidth - GAME_VIEWPORT_WIDTH * s) / 2,
        (innerHeight - GAME_VIEWPORT_HEIGHT * s) / 2,
      );
    };
    addEventListener("resize", this.resize);
    this.resize();
    this.tickCallback = () => this.tick(this.app.ticker.deltaMS);
    this.app.ticker.add(this.tickCallback);
    this.touch = new TouchController(this);
    this.startCountdownMS = 3500;
    this.startCountdownStage = -1;
    this.updateStartCountdown();
    this.render();
  }
  start() {
    this.board.reset();
    this.gameplay.reset(this);
    this.trash = new TrashSystem(this.session?.trash);
    this.gameplay.spawnTrash?.(this, this.trash);
    this.queue = new PieceQueue(Math.random, this.session?.polyominoPreset);
    this.score = this.lines = 0;
    this.elapsedMs = 0;
    this.statistics.reset();
    // The menu exposes Guideline-style starting levels 0 through 15, while
    // the internal scoring and gravity formulas use level 1 as their base.
    const requestedStartLevel = Number(this.session?.startLevel ?? 0);
    this.startLevel = Number.isFinite(requestedStartLevel)
      ? Math.max(0, requestedStartLevel)
      : 0;
    this.level = this.startLevel + 1;
    this.hold = null;
    this.canHold = true;
    this.horizontalDirection = 0;
    this.horizontalRepeat = 0;
    this.horizontalInitial = true;
    this.softDropRepeat = 0;
    this.touchSoftDropTargetY = null;
    this.gravity = 0;
    this.grounded = false;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.classicCombo = 0;
    this.playfield.hud.resetCallout();
    this.state = GameState.PLAYING;
    this.spawn();
    if (this.state === GameState.PLAYING) this.playfield.hud.hideStateMessage();
  }
  canSpawn(type = this.queue.peek()) {
    return this.board.isValid(new Polyomino(type).cells());
  }
  spawn(type = this.queue.next()) {
    this.active = new Polyomino(type);
    this.statistics.recordSpawn(this.active.type);
    this.touchSoftDropTargetY = null;
    this.active.id = this.id++;
    this.irsPending = true;
    this.gameplay.onSpawn(this, this.active);
    this.canHold = true;
    this.grounded = false;
    this.lockTimer = 0;
    this.lockResets = 0;
    // Preserve a top-out piece so the player sees the exact blocked spawn
    // state underneath the game-over overlay instead of a blank playfield.
    if (!this.board.isValid(this.active.cells()))
      this.gameOver({ preserveActive: true });
    else if (!this.gameplay.isControlFrozen(this))
      this.applyInitialRotationSystem();
  }
  applyInitialRotationSystem() {
    if (!this.irsPending || !this.active) return false;
    const action = this.input.held("rotate180")
      ? "rotate180"
      : this.input.held("cw")
        ? "cw"
        : this.input.held("ccw")
          ? "ccw"
          : "";
    this.irsPending = false;
    if (!action) return false;
    this.input.consume(action);
    return this.rotateActive(
      action === "rotate180" ? 2 : action === "cw" ? 1 : -1,
    );
  }
  canMoveDown() {
    if (!this.active) return false;
    const next = this.active.cells(
      this.active.matrix,
      this.active.x,
      this.active.y + 1,
    );
    return (
      this.board.isValid(next) &&
      this.board.raycastClear(this.active.cells(), next)
    );
  }
  updateLockState(successfulAction = false) {
    const groundedNow = !this.canMoveDown();
    if (!groundedNow) {
      this.grounded = false;
      this.lockTimer = 0;
      return;
    }
    if (!this.grounded) {
      this.grounded = true;
      this.lockTimer = 0;
      return;
    }
    if (successfulAction && this.lockResets < this.settings.lockResetLimit) {
      this.lockTimer = 0;
      this.lockResets += 1;
    }
  }
  advanceLockDelay(ms) {
    this.updateLockState();
    if (!this.grounded) return false;
    this.lockTimer += ms;
    if (this.lockTimer < this.lockDelay()) return false;
    this.lock();
    return true;
  }
  holdPiece() {
    if (!this.canAcceptDirectControl() || !this.canHold) return false;
    const outgoing = this.active.definition;
    if (this.hold) {
      const incoming = this.hold;
      this.hold = outgoing;
      this.spawn(incoming);
    } else {
      this.hold = outgoing;
      this.spawn();
    }
    this.canHold = false;
    this.sound.hold();
    return true;
  }
  releaseActive() {
    if (!this.canAcceptDirectControl()) return false;
    return Boolean(this.gameplay.release(this));
  }
  canAcceptDirectControl() {
    return (
      this.state === GameState.PLAYING &&
      !!this.active &&
      !this.gameplay.isControlFrozen(this)
    );
  }
  playfieldCellScreenSize() {
    return CELL * this.playfield.layout.scale * this.root.scale.x;
  }
  moveActiveToX(targetX) {
    if (!this.canAcceptDirectControl()) return false;
    const direction = Math.sign(targetX - this.active.x);
    let moved = false;
    while (direction && this.active.x !== targetX) {
      if (!this.active.move(this.board, direction, 0)) break;
      moved = true;
    }
    this.updateLockState(moved);
    return moved;
  }
  hardDrop() {
    if (!this.canAcceptDirectControl()) return false;
    this.touchSoftDropTargetY = null;
    const hardDropStart = this.active.cells();
    while (this.active.move(this.board, 0, 1)) this.score += 2;
    this.playfield.effects.hardDropTrail(
      hardDropStart,
      this.active.cells(),
      this.active.color,
    );
    this.playfield.hardDropPunch();
    this.lock();
    return true;
  }
  softDrop() {
    if (!this.canAcceptDirectControl()) return false;
    const moved = this.active.move(this.board, 0, 1);
    if (moved) this.score += 1;
    this.updateLockState(moved);
    return moved;
  }
  setTouchSoftDropTargetY(targetY) {
    if (!this.canAcceptDirectControl()) return false;
    this.touchSoftDropTargetY = Math.max(this.active.y, targetY);
    // Let tick() perform every actual descent at the configured SDF rate.
    return true;
  }
  gameOver({ preserveActive = false } = {}) {
    if (DEBUG_NO_GAME_OVER) return false;
    if (!preserveActive) {
      this.gameplay.onGameOver(this);
      this.active = null;
    }
    this.state = GameState.GAME_OVER;
    this.playfield.hud.showGameOver(
      this.score,
      this.statistics.snapshot(this.elapsedMs),
    );
    return true;
  }
  setPaused(paused) {
    if (this.state !== GameState.PLAYING && this.state !== GameState.PAUSED)
      return;
    this.state = paused ? GameState.PAUSED : GameState.PLAYING;
    this.onPauseChange?.(paused);
  }
  detectSpin(piece) {
    if (!piece || piece.lastAction !== "rotate" || piece.type === "O")
      return "";
    // `Board.get` only contains locked matrix tiles in Classic mode. Query
    // validity instead so physics mode uses its live Box2D point occupancy.
    const blocked = (x, y) => !this.board.isValid([{ x, y }]);
    // Non-T all-spins are only recognized when the rotation finishes in a
    // tight, immobile position. This rejects ordinary free-space rotations
    // while supporting I/J/L/S/Z and generated higher-order spin feedback.
    if (piece.type !== "T") {
      if (
        piece.order >= 5 &&
        Polyomino.isFullyRotationallySymmetric(piece.matrix)
      )
        return "";
      const cells = piece.cells();
      const blockedMove = (dx, dy) =>
        !this.board.isValid(
          cells.map((cell) => ({ x: cell.x + dx, y: cell.y + dy })),
        );
      if (!(blockedMove(-1, 0) && blockedMove(1, 0) && blockedMove(0, 1)))
        return "";
      return piece.order > 5 ? "MEGASPIN" : `${piece.type}-SPIN`;
    }
    const pivotX = piece.x + 1;
    const pivotY = piece.y + 1;
    const corners = [
      [pivotX - 1, pivotY - 1],
      [pivotX + 1, pivotY - 1],
      [pivotX - 1, pivotY + 1],
      [pivotX + 1, pivotY + 1],
    ];
    if (corners.filter(([x, y]) => blocked(x, y)).length < 3) return "";
    const fronts = [
      [
        [pivotX - 1, pivotY - 1],
        [pivotX + 1, pivotY - 1],
      ],
      [
        [pivotX + 1, pivotY - 1],
        [pivotX + 1, pivotY + 1],
      ],
      [
        [pivotX - 1, pivotY + 1],
        [pivotX + 1, pivotY + 1],
      ],
      [
        [pivotX - 1, pivotY - 1],
        [pivotX - 1, pivotY + 1],
      ],
    ][piece.facing];
    return piece.lastKick === 5 || fronts.every(([x, y]) => blocked(x, y))
      ? "T-SPIN"
      : "T-SPIN MINI";
  }
  interval() {
    return Math.max(
      MIN_GRAVITY_INTERVAL_MS,
      gravityIntervalForLevel(this.level),
    );
  }
  lockDelay() {
    // The first capped level keeps the configured delay. Each later level
    // removes a fixed amount, with a floor so input remains meaningful.
    const excessLevels = Math.max(0, this.level - FIRST_MAX_GRAVITY_LEVEL);
    return Math.max(
      MIN_LOCK_DELAY_MS,
      this.settings.lockDelay -
        excessLevels * POST_MAX_GRAVITY_LOCK_REDUCTION_MS,
    );
  }
  lock() {
    this.gameplay.lock(this);
  }
  rotateActive(amount) {
    const rotated = this.active?.rotate(this.board, amount);
    this.updateLockState(rotated);
    if (!rotated) return false;
    // This is immediate input feedback only. The gameplay mode still keeps
    // the spin pending until its later lock/clear scoring rules resolve it.
    if (this.detectSpin(this.active)) {
      this.playfield.spinPunch(amount);
      this.playfield.effects.outlineBurst(
        this.active.cells().filter((cell) => cell.y >= 0),
        this.active.color,
        SPIN_OUTLINE_PARTICLE_COUNT,
        SPIN_OUTLINE_PARTICLE_FORCE,
      );
    }
    return true;
  }
  tick(ms) {
    this.input.pollGamepad();
    this.playfield.update(ms);
    this.playfield.hud.updateCallout(ms);
    if (
      this.input.take("hardDrop") &&
      this.state === GameState.PLAYING &&
      !this.gameplay.isControlFrozen(this)
    ) {
      this.hardDrop();
    }
    // Entering pause belongs to gameplay. Once paused, PausePanel owns every
    // resume action so the same P/Escape press cannot close and re-open it.
    if (this.input.take("pause") && this.state === GameState.PLAYING)
      this.setPaused(true);
    if (this.state === GameState.START) {
      this.startCountdownMS -= ms;
      this.updateStartCountdown();
      if (this.startCountdownMS <= 0) this.start();
      this.render();
      this.input.endFrame();
      return;
    }
    if (this.state === GameState.GAME_OVER) {
      if (this.input.take("start")) this.start();
      this.render();
      this.input.endFrame();
      return;
    }
    if (this.state !== GameState.PLAYING) {
      this.input.endFrame();
      return;
    }
    // The session clock pauses with gameplay. Future timed modes can replace
    // this source with their configured countdown without changing the HUD.
    this.elapsedMs += ms;
    if (this.gameplay.isControlFrozen(this)) {
      this.horizontalDirection = 0;
      this.horizontalRepeat = 0;
      this.softDropRepeat = 0;
      this.gameplay.step(this, ms);
      this.render();
      this.input.endFrame();
      return;
    }
    this.applyInitialRotationSystem();
    if (this.input.take("release") && this.releaseActive()) {
      this.render();
      this.input.endFrame();
      return;
    }
    if (this.input.take("hold")) this.holdPiece();
    if (this.input.take("cw")) this.rotateActive(1);
    if (this.input.take("ccw")) this.rotateActive(-1);
    if (this.input.take("rotate180")) this.rotateActive(2);
    const desiredDirection =
      this.input.held("left") && this.input.held("right")
        ? 0
        : this.input.held("left")
          ? -1
          : this.input.held("right")
            ? 1
            : 0;
    if (desiredDirection !== this.horizontalDirection) {
      const reversing =
        desiredDirection !== 0 &&
        this.horizontalDirection !== 0 &&
        desiredDirection !== this.horizontalDirection;
      this.horizontalDirection = desiredDirection;
      // Delayed auto-shift cancellation delay applies only when the player
      // reverses an already repeating horizontal direction.
      this.horizontalRepeat = reversing ? this.settings.dcd : 0;
      this.horizontalInitial = true;
    }
    if (desiredDirection) {
      this.horizontalRepeat -= ms;
      if (this.horizontalRepeat <= 0) {
        this.updateLockState(this.active.move(this.board, desiredDirection, 0));
        this.horizontalRepeat = this.horizontalInitial
          ? this.settings.das
          : this.settings.arr;
        this.horizontalInitial = false;
      }
    }
    const softDropPressed = this.input.take("softDrop");
    const keyboardSoftDrop = this.input.held("softDrop");
    const touchSoftDrop =
      this.touchSoftDropTargetY !== null &&
      this.active.y < this.touchSoftDropTargetY;
    if (keyboardSoftDrop || touchSoftDrop) {
      if (softDropPressed) this.softDropRepeat = 0;
      this.softDropRepeat -= ms;
      if (this.softDropRepeat <= 0) {
        const softDropped = this.softDrop();
        if (
          this.touchSoftDropTargetY !== null &&
          (!softDropped || this.active.y >= this.touchSoftDropTargetY)
        ) this.touchSoftDropTargetY = null;
        this.softDropRepeat = 1000 / this.settings.sdf;
      }
    } else {
      this.softDropRepeat = 0;
      if (!keyboardSoftDrop) this.touchSoftDropTargetY = null;
    }
    this.gravity += ms;
    const gravityInterval = this.interval();
    // Keep the unused time remainder. A delayed frame may span several
    // gravity intervals, especially at high levels, and must advance once
    // for every elapsed interval instead of silently losing fall steps.
    while (this.gravity >= gravityInterval) {
      this.gravity -= gravityInterval;
      if (!this.active.move(this.board, 0, 1)) {
        this.gravity = 0;
        break;
      }
      this.updateLockState();
    }
    if (this.advanceLockDelay(ms)) {
      this.render();
      this.input.endFrame();
      return;
    }
    this.gameplay.step(this, ms);
    this.render();
    this.input.endFrame();
  }
  updateStartCountdown() {
    // Three full beats, then a short GO! beat before input begins.
    const stage =
      this.startCountdownMS > 500
        ? Math.ceil((this.startCountdownMS - 500) / 1000)
        : 0;
    if (stage === this.startCountdownStage) return;
    this.startCountdownStage = stage;
    this.playfield.hud.showCountdown(stage > 0 ? String(stage) : "GO!");
  }
  render() {
    this.playfield.hud.update({
      score: this.score,
      lines: this.lines,
      level: this.level,
      elapsedMs: this.elapsedMs,
      hold: this.hold,
      next: this.queue.items,
    });
    this.playfield.renderer.draw(
      this.board,
      this.active,
      this.active ? projectGhost(this.active, this.board) : [],
      this.gameplay.isControlFrozen(this),
    );
    this.gameplay.render(this);
    this.reflectionCapture?.update();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.input.destroy();
    this.touch.destroy();
    removeEventListener("resize", this.resize);
    this.app.ticker.remove(this.tickCallback);
    this.reflectionCapture?.destroy();
    this.gameplay.dispose(this);
    this.playfield.destroy();
    // AppShell owns and disposes the scene root. Do not recursively destroy it
    // here: GameManager owns only its Playfield children, which prevents a
    // mode switch from double-destroying Pixi graphics contexts.
    if (globalThis.__PIXI_DEVTOOLS__?.app === this.app)
      delete globalThis.__PIXI_DEVTOOLS__;
  }
}
