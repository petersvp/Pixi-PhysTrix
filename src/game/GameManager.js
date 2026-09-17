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
  GAME_OVER_RESTART_INPUT_DELAY_MS,
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
import { safeTickerDelta } from "../app/TickerSafety.js";
import { COLORS } from "../config/colors.js";

// The reflection shader path remains authored and available, but its separate
// mino-only render-texture capture pass is deliberately disabled for now.
const ENABLE_REFLECTION_CAPTURE = false;
const MAX_GRAVITY_CATCH_UP_STEPS = 512;

const seededRandom = (seed) => {
  if (seed === undefined || seed === null || seed === "") return Math.random;
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

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
    const grid = this.session?.roomRules?.grid || {};
    this.cols = Math.max(4, Math.min(99, Math.floor(Number(grid.width) || COLS)));
    this.rows = Math.max(4, Math.min(99, Math.floor(Number(grid.height) || ROWS)));
    this.settings = loadPersistentSettings();
    this.board = new Board(this.cols, this.rows);
    this.resetRandomSources();
    this.queue = new PieceQueue(this.queueRandom, this.session?.polyominoPreset, this.session?.roomRules);
    this.holdEnabled = this.session?.roomRules?.mutators?.enableHold !== false;
    this.input = new InputManager();
    this.sound = new SoundEngine(this.settings);
    this.state = GameState.START;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.elapsedMs = 0;
    this.gameOverInputRemaining = 0;
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
    this.goalProgress = { combos: 0, chains: 0, megaspins: 0, perfectClears: 0 };
    this.lives = this.initialLives();
    this.godEssence = 0;
    this.id = 1;
    // Sessions always run inside AppShell's persistent v8 Application.
    // Creating a second renderer here would violate scene routing and can
    // invalidate the shared reflection targets.
    if (!app) {
      console.error("[GameManager] Missing shared AppShell application.");
      this.failed = true;
      return;
    }
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
      cols: this.cols,
      rows: this.rows,
      cell: CELL,
      skinBaseUrl: this.session?.skinBaseUrl,
      queueSize: this.session?.roomRules?.mutators?.queueSize,
    });
    this.playfield.loadSkin(this.session?.skin);
    const chain = this.session?.roomRules?.chain || {};
    const renderPalette = ["color-lines", "color-clusters"].includes(chain.mode);
    this.playfield.setPalette(
      renderPalette
        ? (chain.colors || []).slice(0, Math.max(1, Math.floor(Number(chain.colorCount) || 1)))
        : [],
    );
    this.playfield.setTrashAppearance({
      desaturation: Number(this.session?.roomRules?.mutators?.trashDesaturation ?? 0.5),
      damagedBrightness: Number(this.session?.roomRules?.mutators?.trashDamagedBrightness ?? 0.55),
    });
    this.playfield.setHoldAction(() => this.holdPiece());
    this.playfield.setRestartAction(() => this.restartAfterGameOver());
    this.trash = new TrashSystem(this.session?.trash, this.trashRandom, this.session?.roomRules);
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

  resetRandomSources() {
    const seed = this.session?.randomSeed;
    this.queueRandom = seededRandom(
      seed === undefined || seed === null || seed === "" ? null : `${seed}:queue`,
    );
    this.trashRandom = seededRandom(
      seed === undefined || seed === null || seed === "" ? null : `${seed}:trash`,
    );
  }

  start() {
    if (this.failed) return false;
    this.board.reset();
    this.gameplay.reset(this);
    this.resetRandomSources();
    this.trash = new TrashSystem(this.session?.trash, this.trashRandom, this.session?.roomRules);
    this.gameplay.spawnTrash?.(this, this.trash);
    this.queue = new PieceQueue(this.queueRandom, this.session?.polyominoPreset, this.session?.roomRules);
    this.holdEnabled = this.session?.roomRules?.mutators?.enableHold !== false;
    this.score = this.lines = 0;
    this.elapsedMs = 0;
    this.gameOverInputRemaining = 0;
    this.statistics.reset();
    // The menu exposes Guideline-style starting levels 0 through 15, while
    // the internal scoring and gravity formulas use level 1 as their base.
    const requestedStartLevel = Number(this.session?.startLevel ?? 0);
    this.startLevel = Number.isFinite(requestedStartLevel)
      ? Math.max(0, requestedStartLevel)
      : 0;
    this.level = this.startLevel + 1;
    this.hold = null;
    this.canHold = this.holdEnabled;
    this.pendingMinoDrops = 0;
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
    this.goalProgress = { combos: 0, chains: 0, megaspins: 0, perfectClears: 0 };
    this.lives = this.initialLives();
    this.playfield.hud.resetCallout();
    this.state = GameState.PLAYING;
    this.onGameStarted?.({ game: this });
    this.spawn();
    if (this.state === GameState.PLAYING) this.playfield.hud.hideStateMessage();
  }
  canSpawn(type = this.queue.peek()) {
    const piece = new Polyomino(type);
    piece.x = (this.cols - Math.max(...piece.matrix.map((row) => row.length))) >> 1;
    return this.board.isValid(piece.cells());
  }
  spawn(type = this.queue.next()) {
    // Queue generation may spend a proportional God Essence allotment on the
    // newly entering PM. Keep the manager's hidden balance aligned with it.
    this.godEssence = this.queue.pendingGems;
    this.active = new Polyomino(type);
    this.active.x = (this.cols - Math.max(...this.active.matrix.map((row) => row.length))) >> 1;
    this.statistics.recordSpawn(this.active.type);
    this.touchSoftDropTargetY = null;
    this.active.id = this.id++;
    this.irsPending = true;
    this.gameplay.onSpawn(this, this.active);
    // A presentation/networking consumer may mirror the newly controlled
    // polyomino without owning gameplay timing or input.
    this.onPolyominoSpawned?.(this, this.active);
    this.canHold = this.holdEnabled;
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
  addGodEssence(amount = 0) {
    if (this.session?.roomRules?.pvp?.godEssence === false) return;
    const essence = Math.max(0, Math.floor(Number(amount) || 0));
    if (!essence) return;
    this.queue.addGems(essence);
    // This is the hidden unspent Essence balance. PieceQueue spends it only
    // as new queue entries are generated using its queue-size distribution.
    this.godEssence = this.queue.pendingGems;
  }
  applyPVPAttack(type, value = 0) {
    const count = Math.max(0, Math.floor(Number(value) || 0));
    if (type === "attachments" && this.session?.roomRules?.pvp?.pmOrderAttack !== false) this.queue.addAttachments(count);
    if (type === "gems" && this.session?.roomRules?.pvp?.godEssence !== false) this.queue.addGems(count);
    if (type === "mino-drops" && this.session?.roomRules?.pvp?.minoDropsAttack !== false)
      this.pendingMinoDrops = (this.pendingMinoDrops || 0) + count;
  }
  takePendingMinoDrops(limit = Math.floor((this.cols * 3) / 2)) {
    // One attack point plans two lane rolls. A lane accepts at most three
    // rolls, so consume as much attack value as this turn can represent and
    // retain only the true excess for the next lock.
    const maximumAttackThisTurn = Math.floor((this.cols * 3) / 2);
    const count = Math.min(
      maximumAttackThisTurn,
      Math.max(0, Math.floor(Number(limit) || 0)),
      Math.max(0, Math.floor(Number(this.pendingMinoDrops) || 0)),
    );
    this.pendingMinoDrops = Math.max(0, (this.pendingMinoDrops || 0) - count);
    return count;
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
  fallingDisabled() {
    return Boolean(this.session?.roomRules?.mutators?.disableFalling);
  }
  updateLockState(successfulAction = false) {
    if (this.fallingDisabled()) {
      this.grounded = false;
      this.lockTimer = 0;
      this.lockResets = 0;
      return;
    }
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
    if (this.fallingDisabled()) {
      this.grounded = false;
      this.lockTimer = 0;
      this.lockResets = 0;
      return false;
    }
    this.updateLockState();
    if (!this.grounded) return false;
    this.lockTimer += ms;
    if (this.lockTimer < this.lockDelay()) return false;
    this.lock();
    return true;
  }
  holdPiece() {
    if (!this.holdEnabled || !this.canAcceptDirectControl() || !this.canHold)
      return false;
    // Pocket stores the active piece's current geometry and minos.  Its
    // definition matrix is the spawn orientation, so using it after a rotate
    // would pair a rotated mino list with the old matrix and silently repair
    // the missing minos with replacement colours.
    const outgoing = {
      ...this.active.definition,
      matrix: this.active.matrix.map((row) => row.slice()),
      color: this.active.color,
      colorIndex: this.active.colorIndex,
      palette: this.active.palette,
      minos: this.active.minos.map((mino) => ({ ...mino })),
    };
    if (this.hold) {
      const incoming = this.hold;
      this.hold = outgoing;
      this.spawn(incoming);
    } else {
      this.hold = outgoing;
      this.spawn();
    }
    this.canHold = Boolean(this.session?.roomRules?.mutators?.infiniteHold);
    this.sound.hold();
    this.onHoldChanged?.({ hold: this.hold, canHold: this.canHold });
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
    let steps = 0;
    while (direction && this.active.x !== targetX) {
      if (++steps > this.cols + 2) {
        console.error("[Game] Horizontal move safety limit reached.", { targetX, x: this.active.x, steps });
        break;
      }
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
    let steps = 0;
    while (this.active.move(this.board, 0, 1)) {
      if (++steps > this.rows + 8) {
        console.error("[Game] Hard-drop safety limit reached.", { y: this.active.y, steps });
        break;
      }
      this.score += 2;
    }
    this.playfield.effects.hardDropTrail(
      hardDropStart,
      this.active.cells(),
      this.active.color,
    );
    this.onHardDrop?.({
      fromCells: hardDropStart,
      toCells: this.active.cells(),
      colorIndex: this.active.colorIndex,
      baseColor: this.active.color,
    });
    this.playfield.hardDropPunch();
    this.lock({ hardDrop: true });
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
  clearTouchSoftDropTarget() {
    this.touchSoftDropTargetY = null;
  }
  gameOver({ preserveActive = false } = {}) {
    if (DEBUG_NO_GAME_OVER) return false;
    if (this.lives > 1) return this.consumeLife();
    if (!preserveActive) {
      this.gameplay.onGameOver(this);
      this.active = null;
    }
    this.state = GameState.GAME_OVER;
    this.gameOverInputRemaining = GAME_OVER_RESTART_INPUT_DELAY_MS;
    const summary = this.statistics.snapshot(this.elapsedMs);
    this.playfield.hud.showGameOver(this.score, summary);
    this.onGameOver?.({ score: this.score, summary });
    return true;
  }
  initialLives() {
    const configuredLives = Number(this.session?.roomRules?.series?.lives);
    if (Number.isFinite(configuredLives)) return Math.max(1, Math.floor(configuredLives));
    return 1 + Math.max(0, Math.floor(Number(this.winningConditions()?.extraLives) || 0));
  }
  consumeLife() {
    this.lives -= 1;
    this.gameplay.onGameOver(this);
    this.active = null;
    this.board.reset();
    this.gameplay.reset(this);
    if (this.trash.enabled) this.gameplay.spawnTrash?.(this, this.trash);
    this.grounded = false;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.touchSoftDropTargetY = null;
    this.playfield.hud.resetCallout();
    this.playfield.hud.hideStateMessage();
    this.playfield.hud.showScoringCallout("OUCH!", {
      color: COLORS.LIFE_LOSS_TEXT,
      centered: true,
      prominent: true,
    });
    this.playfield.lifeLossPunch();
    this.onLifeLost?.({ lives: this.lives });
    this.resumingAfterLifeLoss = true;
    this.state = GameState.START;
    this.startCountdownMS = 3500;
    this.startCountdownStage = -1;
    this.updateStartCountdown();
    return true;
  }
  restartAfterGameOver() {
    if (
      this.state !== GameState.GAME_OVER ||
      this.gameOverInputRemaining > 0
    )
      return false;
    this.start();
    return true;
  }
  setPaused(paused) {
    if (this.state !== GameState.PLAYING && this.state !== GameState.PAUSED)
      return;
    this.state = paused ? GameState.PAUSED : GameState.PLAYING;
    // The pause overlay is owned by the host application, but the state
    // belongs to this playfield. Keep the local pause marker attached to the
    // field just as the game-over report is.
    if (paused) this.playfield.hud.showPaused();
    else this.playfield.hud.hideStateMessage();
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
  updateSpeed() {
    const rules = this.session?.roomRules?.mutators;
    if (!rules) {
      this.level = this.startLevel + ((this.lines / 10) | 0) + 1;
      return;
    }
    const byLines = rules.linesSpeedup
      ? Math.floor(this.lines / Math.max(1, Number(rules.linesPerSpeedup) || 10))
      : 0;
    const bySeconds = rules.secondsSpeedup
      ? Math.floor(this.elapsedMs / 1000 / Math.max(1, Number(rules.secondsPerSpeedup) || 20))
      : 0;
    this.level = this.startLevel + Math.max(byLines, bySeconds) + 1;
  }
  winningConditions() {
    // Score and Survival never evaluate or display room win objectives.
    return ["versus", "survival"].includes(this.session?.roomRules?.matchMode)
      ? {}
      : this.session?.roomRules?.win;
  }
  bottomTrashLineCleared() {
    return this.trash?.bottomLineCleared(this.board, this.gameplay?.physics);
  }
  checkWinConditions() {
    const win = this.winningConditions();
    if (!win || this.state !== GameState.PLAYING) return;
    const active = [];
    if (win.score) active.push(this.score >= Number(win.scoreTarget));
    if (win.speed) active.push(this.level >= Number(win.speedTarget));
    if (win.chains) active.push(this.lines >= Number(win.chainTarget));
    if (win.combos) active.push(this.goalProgress.combos >= Number(win.comboCount));
    if (win.chainGoals) active.push(this.goalProgress.chains >= Number(win.chainCount));
    if (win.megaspins) active.push(this.goalProgress.megaspins >= Number(win.megaspinCount));
    if (win.perfectClears) active.push(this.goalProgress.perfectClears >= Number(win.perfectClearCount));
    if (win.trashWin === "reach-level") active.push(this.trash.level >= Number(win.trashLevel));
    if (win.trashWin === "clear-bottom-line") active.push(this.bottomTrashLineCleared());
    if (active.length && active.every(Boolean)) {
      this.state = GameState.WON;
      this.active = null;
      this.playfield.hud.showGameOver(
        this.score,
        this.statistics.snapshot(this.elapsedMs),
      );
      this.playfield.hud.replaceGameOverTitle("VICTORY", "#a8ff77");
      this.playfield.hud.hideGameOverAction();
      this.onGameWon?.({ score: this.score, progress: { ...this.goalProgress } });
    }
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
  lock(options) {
    this.gameplay.lock(this, options);
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
    ms = safeTickerDelta(ms, "GameManager.tick");
    if (ms === null) {
      this.input.endFrame();
      return;
    }
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
    // Modes decide whether a pause request is allowed. This lets online modes
    // reject local pause while solo modes can open their own pause UI before
    // approving the state transition.
    if (this.input.take("pause") && this.state === GameState.PLAYING) {
      const approved = this.onPauseRequest?.({ game: this }) === true;
      if (approved) this.setPaused(true);
    }
    if (this.state === GameState.START) {
      this.startCountdownMS -= ms;
      this.updateStartCountdown();
      if (this.startCountdownMS <= 0) {
        if (this.resumingAfterLifeLoss) this.resumeAfterLifeLoss();
        else this.start();
      }
      this.render();
      this.input.endFrame();
      return;
    }
    if (this.state === GameState.GAME_OVER) {
      this.gameOverInputRemaining = Math.max(
        0,
        this.gameOverInputRemaining - ms,
      );
      if (this.input.take("start")) this.restartAfterGameOver();
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
    if (this.fallingDisabled()) {
      this.gravity = 0;
    } else this.gravity += ms;
    const gravityInterval = this.interval();
    // Keep the unused time remainder. A delayed frame may span several
    // gravity intervals, especially at high levels, and must advance once
    // for every elapsed interval instead of silently losing fall steps.
    let gravitySteps = 0;
    while (!this.fallingDisabled() && this.gravity >= gravityInterval) {
      if (++gravitySteps > MAX_GRAVITY_CATCH_UP_STEPS) {
        console.error("[Game] Gravity catch-up safety limit reached; dropping remaining gravity time.", {
          gravity: this.gravity,
          gravityInterval,
          gravitySteps,
        });
        this.gravity = 0;
        break;
      }
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
    this.checkWinConditions();
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
    this.playfield.hud.showCountdown(stage > 0 ? String(stage) : "GO!", {
      color: this.resumingAfterLifeLoss ? COLORS.LIFE_LOSS_TEXT : COLORS.FIELD_TEXT,
    });
  }

  resumeAfterLifeLoss() {
    this.resumingAfterLifeLoss = false;
    this.state = GameState.PLAYING;
    this.playfield.hud.hideStateMessage();
    this.spawn();
  }
  render() {
    this.playfield.hud.update({
      score: this.score,
      lines: this.lines,
      level: this.level,
      goals: this.winningConditions(),
      goalProgress: this.goalProgress,
      trashLevel: this.trash?.level || 0,
      trashCleared: this.bottomTrashLineCleared(),
      lives: this.lives,
      elapsedMs: this.elapsedMs,
      hold: this.hold,
      next: this.queue.items,
      showHold: this.holdEnabled,
      showQueue: this.queue.targetSize > 0,
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
