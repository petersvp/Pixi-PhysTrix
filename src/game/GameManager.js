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
import { Polyomino, polyominoCentroid } from "./Polyomino.js";
import { projectGhost } from "./GhostProjection.js";
import { SoundEngine } from "../audio/SoundEngine.js";
import {
  CELL,
  COLS,
  DEBUG_NO_GAME_OVER,
  gravityIntervalForLevel,
  LOCK_DELAY_REDUCTION_START_SPEED,
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
import { colorNumber, COLORS } from "../config/colors.js";

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
    this.audioEvents = new EventTarget();
    this.state = GameState.START;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.elapsedMs = 0;
    this.lineSeals = [];
    // Coordinate memory is intentional: physics can rebuild a fixture/tile
    // object while it remains in the same rejected chain. The Disabled cue is
    // therefore once for that sealed board position, not once per frame.
    this.lineSealBlockedTiles = new Set();
    this.gameOverInputRemaining = 0;
    this.statistics = new GameStatistics();
    this.startLevel = 0;
    this.gravity = 0;
    this.horizontalDirection = 0;
    this.horizontalRepeat = 0;
    this.horizontalInitial = true;
    this.softDropRepeat = 0;
    this.softDropDistance = 0;
    this.touchSoftDropTargetY = null;
    this.grounded = false;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.classicCombo = 0;
    this.goalProgress = { combos: 0, chains: 0, megaspins: 0, perfectClears: 0 };
    this.lives = this.initialLives();
    this.godEssence = 0;
    this.godEssenceWallet = [];
    this.godEssenceQueuedWallets = [];
    this.godEssenceRewardFlights = [];
    this.godEssenceTurn = 0;
    this.godEssenceItems = [];
    this.godEssencePolarityTogglePending = false;
    this.activeGodEssencePassiveEffect = null;
    this.godEssencePassiveFlags = new Set();
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
      showGodEssenceWallet: this.session?.roomRules?.pvp?.godEssence === true,
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
    // Entering a match should return keyboard delivery to the game surface.
    // Pointer interaction remains the reliable fallback in embedded browsers
    // that decline a programmatic focus change outside a user gesture.
    this.app.canvas?.focus?.({ preventScroll: true });
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

  emitAudioEvent(type, detail = {}) {
    this.audioEvents.dispatchEvent(new CustomEvent(type, { detail }));
  }

  addLineSeal({ startRow = 0, endRow = startRow, remaining = 1, itemIndex = -1 } = {}) {
    const first = Math.max(0, Math.min(this.rows - 1, Math.floor(startRow)));
    const last = Math.max(first, Math.min(this.rows - 1, Math.floor(endRow)));
    const incoming = {
      startRow: first,
      endRow: last,
      remaining: Math.max(1, Math.floor(remaining)),
      itemIndex,
    };
    const ranges = [...this.lineSeals, incoming]
      .sort((left, right) => left.startRow - right.startRow);
    const merged = [];
    ranges.forEach((range) => {
      const previous = merged.at(-1);
      if (!previous || range.startRow > previous.endRow) {
        merged.push({ ...range, sources: [range] });
        return;
      }
      previous.endRow = Math.max(previous.endRow, range.endRow);
      previous.sources.push(range);
    });
    const coveredRows = merged.reduce(
      (total, seal) => total + seal.endRow - seal.startRow + 1,
      0,
    );
    if (coveredRows > Math.floor(this.rows * 0.75)) return false;
    this.lineSeals = merged.map((seal) => {
      const span = seal.endRow - seal.startRow + 1;
      const weightedDuration = seal.sources.reduce(
        (total, source) => total + source.remaining * (source.endRow - source.startRow + 1),
        0,
      );
      return {
        startRow: seal.startRow,
        endRow: seal.endRow,
        // Retriggered overlap becomes one range. Weight its remaining clears
        // by each contributing range's size, then normalize to its new span.
        remaining: Math.max(1, Math.round(weightedDuration / span)),
        itemIndex: seal.sources.at(-1).itemIndex,
      };
    });
    // A seal is gameplay state immediately, not a deferred board mutation.
    // Paint its range and counter in the same frame that consumed the item.
    this.render();
    return true;
  }
  isLineSealed(_x, y) {
    return this.lineSeals.some((seal) => y >= seal.startRow && y <= seal.endRow);
  }
  consumeLineSealsForMatch() {
    if (!this.lineSeals.length) return;
    this.lineSeals.forEach((seal) => { seal.remaining -= 1; });
    this.lineSeals = this.lineSeals.filter((seal) => seal.remaining > 0);
    this.render();
  }
  notifyLineSealBlocked(cells = []) {
    const fresh = cells.filter(({ x, y, tile: suppliedTile }) => {
      const tile = suppliedTile ?? this.board.get(x, y);
      const key = `${Math.floor(x)},${Math.floor(y)}`;
      if (!tile || this.lineSealBlockedTiles.has(key)) return false;
      this.lineSealBlockedTiles.add(key);
      return true;
    });
    if (!fresh.length) return;
    this.playfield.pulseLineSealRange?.(fresh);
    this.playfield.markLineSealBlockedTiles?.(fresh, 5_000);
    this.emitAudioEvent("godEssenceTrigger", { eventPath: "event:/Items/Disabled" });
  }

  spinAudioValue(spin, lines = 0, order = 4) {
    if (!spin) return 0;
    if (spin === "MEGASPIN" || order >= 5) return 1;
    return Math.min(1, Math.max(0, Number(lines) || 0) / 3);
  }

  onAudioEvent(type, listener) {
    this.audioEvents.addEventListener(type, listener);
    return () => this.audioEvents.removeEventListener(type, listener);
  }

  movementAudioDetail(phase, direction = 0) {
    return {
      phase,
      direction,
      position: polyominoCentroid(this.active?.cells() || []),
    };
  }

  lockedMinoCount() {
    if (this.gameplay?.lockedMinoCount) return this.gameplay.lockedMinoCount(this);
    let count = 0;
    this.board.forEachCell(() => count++);
    return count;
  }

  start() {
    if (this.failed) return false;
    this.endGodEssencePassiveEffect("round-restarted");
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
    this.softDropDistance = 0;
    this.touchSoftDropTargetY = null;
    this.gravity = 0;
    this.grounded = false;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.classicCombo = 0;
    this.goalProgress = { combos: 0, chains: 0, megaspins: 0, perfectClears: 0 };
    this.lives = this.initialLives();
    this.playfield.hud.resetCallout();
    this.godEssenceWallet = [];
    this.lineSeals = [];
    this.godEssenceQueuedWallets = [];
    this.godEssenceRewardFlights = [];
    this.godEssenceTurn = 0;
    this.godEssencePolarityTogglePending = false;
    this.state = GameState.PLAYING;
    this.onGameStarted?.({ game: this });
    this.spawn();
    if (this.state === GameState.PLAYING) this.playfield.hud.hideStateMessage();
  }
  nextSpawnType() {
    // Hidden God Essence rewards are genuine priority queue entries. This
    // gives spawn-safety checks the same O that `next()` will consume.
    return this.queue.peek();
  }
  createSpawnPiece(type) {
    const piece = new Polyomino(type);
    piece.x = (this.cols - Math.max(...piece.matrix.map((row) => row.length))) >> 1;
    piece.discardSpawnOutOfBounds(this.cols);
    return piece;
  }
  canSpawn(type = this.nextSpawnType()) {
    const piece = this.createSpawnPiece(type);
    return piece.cells().length > 0 && this.board.isValid(piece.cells());
  }
  spawn(type = null, { raiseForHold = false } = {}) {
    // Queue generation may spend a proportional God Essence allotment on the
    // newly entering PM. Keep the manager's hidden balance aligned with it.
    this.applyPendingGodEssencePolarity();
    if (!type) type = this.queue.next();
    const reward = type?.godEssenceReward || null;
    const spawnedGodEssenceReward = Boolean(reward);
    this.godEssence = this.queue.pendingGems;
    this.active = this.createSpawnPiece(type);
    if (reward) {
      this.godEssenceQueuedWallets.shift();
      this.active.godEssenceReward = true;
      this.active.godEssenceChoices = reward.choices;
      this.active.godEssenceChoice = 0;
      this.active.godEssenceItemIndex = reward.choices[0];
      this.active.godEssenceItemName = this.godEssenceItems[this.active.godEssenceItemIndex]?.name || "ITEM";
      this.active.godEssenceForeign = this.selfTargetPvpMode;
      this.active.godEssencePolarity = this.active.godEssenceForeign
        ? "foreign"
        : this.godEssenceItems[this.active.godEssenceItemIndex]?.polarity || "self";
      const chain = this.session?.roomRules?.chain || {};
      this.active.color = 0x9aa3ad;
      if (chain.mode === "lines-out")
        this.active.color = this.active.godEssenceForeign
          ? this.godEssenceTint("foreignMino", 0xc56868)
          : this.active.godEssencePolarity === "others"
          ? this.godEssenceTint("othersMino", 0xc57a8b)
          : this.godEssenceTint("selfMino", 0x75af8a);
      this.active.minos.forEach((mino) => { mino.baseColor = this.active.color; });
      if (["color-lines", "color-clusters"].includes(chain.mode)) {
        const count = Math.max(1, Math.floor(Number(chain.colorCount) || 1));
        const colorIndex = Math.floor(this.queueRandom() * count);
        this.active.colorIndex = colorIndex;
        this.active.minos.forEach((mino) => { mino.colorIndex = colorIndex; });
      }
      this.active.minos.forEach((mino) => {
        mino.godEssenceItemIndex = this.active.godEssenceItemIndex;
        mino.godEssencePolarity = this.active.godEssencePolarity;
        mino.godEssenceForeign = this.active.godEssenceForeign;
        mino.godEssenceItemName = this.active.godEssenceItemName;
      });
      console.info("[God Essence] Item block spawned.", {
        choices: reward.choices.map((index) => this.godEssenceItems[index]?.name || index),
        selected: this.active.godEssenceItemName,
      });
    } else if (Number.isInteger(type?.godEssenceItemIndex)) {
      this.active.godEssenceItemIndex = type.godEssenceItemIndex;
      this.active.godEssenceItemName = this.godEssenceItems[type.godEssenceItemIndex]?.name || "ITEM";
      this.active.godEssenceForeign = Boolean(type.godEssenceForeign);
      this.active.godEssencePolarity = this.active.godEssenceForeign
        ? "foreign"
        : this.godEssenceItems[type.godEssenceItemIndex]?.polarity || "self";
      const chain = this.session?.roomRules?.chain || {};
      if (this.active.godEssenceForeign && chain.mode === "lines-out") {
        this.active.color = this.godEssenceTint("foreignMino", 0xc56868);
        this.active.minos.forEach((mino) => { mino.baseColor = this.active.color; });
      }
      this.active.minos.forEach((mino) => {
        mino.godEssenceItemIndex = this.active.godEssenceItemIndex;
        mino.godEssenceItemName = this.active.godEssenceItemName;
        mino.godEssencePolarity = this.active.godEssencePolarity;
        mino.godEssenceForeign = this.active.godEssenceForeign;
      });
    }
    if (raiseForHold && !this.board.isValid(this.active.cells())) {
      // Hold is a player-selected recovery tool. Move its incoming PM upward
      // only as far as needed to give control instead of top-out at the
      // ordinary spawn origin.
      const minimumY = -this.rows - this.active.matrix.length;
      while (this.active.y > minimumY && !this.board.isValid(this.active.cells()))
        this.active.y -= 1;
    }
    this.statistics.recordSpawn(this.active.type);
    this.touchSoftDropTargetY = null;
    this.active.id = this.id++;
    if (Number.isInteger(this.active.godEssenceItemIndex))
      this.active.minos.forEach((mino) => { mino.godEssenceInstanceId = this.active.id; });
    this.irsPending = true;
    this.gameplay.onSpawn(this, this.active);
    if (spawnedGodEssenceReward)
      this.playfield.resolveGodEssenceRewardFlight?.(
        reward.presentationId,
        this.active.cells(),
      );
    // The Obtain cue begins when the wallet becomes a reward and resolves
    // only once that reward has actually entered the playfield.
    if (spawnedGodEssenceReward) this.emitAudioEvent("godEssenceObtainEnd");
    // A presentation/networking consumer may mirror the newly controlled
    // polyomino without owning gameplay timing or input.
    this.onPolyominoSpawned?.(this, this.active);
    this.canHold = this.holdEnabled;
    this.grounded = false;
    this.lockTimer = 0;
    this.lockResets = 0;
    // Preserve a top-out piece so the player sees the exact blocked spawn
    // state underneath the game-over overlay instead of a blank playfield.
    if (!this.active.cells().length || !this.board.isValid(this.active.cells()))
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
  setGodEssenceItems(items = []) {
    this.godEssenceItems = Array.isArray(items) ? items : [];
  }
  setSelfTargetPvpMode(enabled = false) {
    this.selfTargetPvpMode = Boolean(enabled);
  }
  setGodEssenceAtlas(texture, atlas) {
    this.godEssenceAtlas = atlas;
    this.playfield.setGodEssenceAtlas(texture, atlas);
  }
  godEssenceTint(name, fallback) {
    return colorNumber(this.godEssenceAtlas?.tints?.[name], fallback);
  }
  godEssenceDisplayWallet() {
    return this.godEssenceQueuedWallets[0] || this.godEssenceWallet;
  }
  hasPendingGodEssenceReward() {
    return Boolean(this.queue?.hasHiddenItems() || this.godEssenceRewardFlights?.length);
  }
  godEssenceItemMatchesCurrentMode(item) {
    const requiredModes = Array.isArray(item?.modes) ? item.modes : [];
    if (!requiredModes.length) return true;
    const chainMode = this.session?.roomRules?.chain?.mode;
    const gameplayMode = this.session?.gameplayMode;
    const activeModes = new Set();
    if (gameplayMode === "physics") activeModes.add("physics");
    if (gameplayMode === "classic") {
      // "Grid" is the product-facing name; Core's session value is classic.
      activeModes.add("grid");
      activeModes.add("classic");
      if (this.session?.roomRules?.grid?.gravityType === "clustered")
        activeModes.add("grid-clustered");
    }
    if (chainMode === "lines-out") activeModes.add("lines-out");
    if (["color-lines", "color-clusters"].includes(chainMode)) activeModes.add("color");
    return requiredModes.some((mode) => activeModes.has(mode));
  }
  godEssenceItemMeetsRequirements(item) {
    const requirements = Array.isArray(item?.requires) ? item.requires : [];
    return !requirements.includes("falling-minos") ||
      !this.session?.roomRules?.mutators?.disableFalling;
  }
  prepareGodEssenceReward() {
    const capacity = 10;
    if (!this.godEssenceItems.length || this.godEssenceWallet.reduce((sum, value) => sum + value, 0) < capacity)
      return false;
    const distinctPrices = [...new Set(this.godEssenceWallet)]
      .sort((a, b) => b - a)
      .slice(0, 3);
    // A wallet can contain fewer than three distinct section values. It still
    // grants three choices: repeat one of its earned price tiers at random,
    // rather than silently reducing the item block to one or two options.
    const prices = [...distinctPrices];
    while (prices.length < 3 && distinctPrices.length)
      prices.push(distinctPrices[Math.floor(this.queueRandom() * distinctPrices.length)]);
    const colorMode = ["color-lines", "color-clusters"].includes(this.session?.roomRules?.chain?.mode);
    const itemPrice = (entry) => typeof entry.price === "object"
      ? (colorMode ? entry.price.color : entry.price.nonColor)
      : entry.price;
    const compatible = this.godEssenceItems.filter((entry) =>
      this.godEssenceItemMatchesCurrentMode(entry) &&
      this.godEssenceItemMeetsRequirements(entry));
    const choices = [];
    prices.forEach((price) => {
      // Repeated price slots must still present different items.
      let eligible = compatible.filter((entry) =>
        itemPrice(entry) === price && !choices.includes(this.godEssenceItems.indexOf(entry)));
      // A sparse, mode-restricted tier must not reduce the reward below three
      // options. Prefer another earned tier, then any unused legal item.
      if (!eligible.length)
        eligible = compatible.filter((entry) =>
          prices.includes(itemPrice(entry)) && !choices.includes(this.godEssenceItems.indexOf(entry)));
      if (!eligible.length)
        eligible = compatible.filter((entry) => !choices.includes(this.godEssenceItems.indexOf(entry)));
      if (eligible.length)
        choices.push(this.godEssenceItems.indexOf(eligible[Math.floor(this.queueRandom() * eligible.length)]));
    });
    if (!choices.length) return false;
    const reward = { choices };
    // The chosen icons reach the Queue before the hidden O becomes a real
    // priority entry. Gameplay remains live while this presentation runs.
    const rewardFlight = this.playfield.startGodEssenceRewardFlight?.(choices);
    const rewardFlightDurationMs = rewardFlight?.durationMs ?? 1_000;
    this.godEssenceRewardFlights.push({
      remainingMs: rewardFlightDurationMs,
      reward,
      wallet: this.godEssenceWallet,
      presentationId: rewardFlight?.id,
    });
    this.godEssenceWallet = [];
    this.emitAudioEvent("godEssenceObtain");
    console.info("[God Essence] Reward options selected.", {
      prices,
      choices: choices.map((index) => this.godEssenceItems[index]?.name || index),
    });
    return true;
  }
  updateGodEssenceRewardFlights(ms) {
    if (!this.godEssenceRewardFlights.length) return;
    const pending = [];
    this.godEssenceRewardFlights.forEach((flight) => {
      flight.remainingMs -= ms;
      if (flight.remainingMs > 0) {
        pending.push(flight);
        return;
      }
      // Hidden entries are genuine queue pieces, deliberately invisible in
      // `items` until they become the controlled reward PM.
      this.queue.enqueueHidden({
        id: "O",
        godEssenceReward: { ...flight.reward, presentationId: flight.presentationId },
      });
      this.godEssenceQueuedWallets.push(flight.wallet);
    });
    this.godEssenceRewardFlights = pending;
  }
  completeGodEssenceLock() {
    if (this.session?.roomRules?.pvp?.godEssence === true)
      this.godEssencePolarityTogglePending = true;
  }
  applyPendingGodEssencePolarity() {
    if (!this.godEssencePolarityTogglePending) return;
    this.godEssencePolarityTogglePending = false;
    // A Physics item mino already marked for a clear resolves using the
    // allegiance it had when matched; do not flip it underneath that result.
    if (this.gameplay?.physics?.bodies?.some((body) =>
      body.GetUserData?.()?.cells?.some((cell) =>
        cell.marked && !cell.godEssenceForeign &&
        (cell.godEssencePolarity === "self" || cell.godEssencePolarity === "others"))))
      return;
    const linesOut = this.session?.roomRules?.chain?.mode === "lines-out";
    const flip = (cell) => {
      if (cell?.godEssenceForeign) return;
      if (cell?.godEssencePolarity !== "self" && cell?.godEssencePolarity !== "others") return;
      cell.godEssencePolarity = cell.godEssencePolarity === "self" ? "others" : "self";
      if (linesOut)
        cell.baseColor = cell.godEssencePolarity === "others"
          ? this.godEssenceTint("othersMino", 0xc57a8b)
          : this.godEssenceTint("selfMino", 0x75af8a);
    };
    this.board.forEachCell(flip);
    this.gameplay?.physics?.bodies?.forEach((body) =>
      body.GetUserData?.()?.cells?.forEach(flip));
  }
  triggerGodEssenceItem(itemIndex, context = {}) {
    const item = this.godEssenceItems[itemIndex];
    if (!item) return false;
    const amount = Math.max(1, Math.floor(Number(context.destroyedMinoCount) || 1));
    const handled = item.action?.(this, amount, item.id, { itemIndex, ...context }) === true;
    console.info("[God Essence] Item triggered.", { itemIndex, item: item.name, amount, ...context });
    this.onGodEssenceItemTriggered?.({ itemIndex, itemId: item.id, amount, handled, ...context });
    return handled;
  }
  startGodEssencePassiveEffect(effect) {
    this.endGodEssencePassiveEffect("interrupted");
    const state = { ...effect, remainingMs: Math.max(0, Number(effect.durationMs) || 0) };
    this.activeGodEssencePassiveEffect = state;
    state.start?.(this, state);
    return true;
  }
  endGodEssencePassiveEffect(reason = "expired") {
    const state = this.activeGodEssencePassiveEffect;
    if (!state) return false;
    this.activeGodEssencePassiveEffect = null;
    state.end?.(this, state);
    return true;
  }
  updateGodEssencePassiveEffect(ms) {
    const state = this.activeGodEssencePassiveEffect;
    if (!state) return;
    state.remainingMs -= ms;
    if (state.remainingMs <= 0) this.endGodEssencePassiveEffect();
  }
  hasGodEssencePassiveEffect(itemId) {
    return this.godEssencePassiveFlags.has(itemId);
  }
  outgoingAttackMultiplier() {
    const effect = this.activeGodEssencePassiveEffect;
    return effect?.itemId === "sword"
      ? 2 + Math.max(1, Math.floor(Number(effect.amount) || 1)) * 2
      : 1;
  }
  modifyOutgoingAttack(value) {
    return Math.max(0, Math.floor(Number(value) || 0)) * this.outgoingAttackMultiplier();
  }
  resolveGodEssenceItem(itemIndex, { polarity = "self", foreign = false, ...context } = {}) {
    if (!foreign && polarity === "others") {
      console.info("[God Essence] Sending item to another player.", { itemIndex, ...context });
      this.emitAudioEvent("godEssenceSend", { itemIndex });
      this.onAttack?.({ attackType: "god-essence-item", value: itemIndex, source: this });
      return false;
    }
    return this.triggerGodEssenceItem(itemIndex, { polarity, foreign, ...context });
  }
  keepElectricGodEssenceItemVisible(item, itemTileRefs, instanceId = null) {
    const catalogItem = this.godEssenceItems[item.itemIndex];
    if (!catalogItem || !["color-remover", "lightning-bolt"].includes(catalogItem.id)) return;
    itemTileRefs.forEach((cell) => {
      cell.godEssenceItemIndex = item.itemIndex;
      cell.godEssenceItemName = catalogItem.name;
      cell.godEssencePolarity = item.polarity;
      cell.godEssenceForeign = item.foreign;
      if (instanceId != null) cell.godEssenceInstanceId = instanceId;
      // The original item is already resolving its electrical discharge. It
      // remains visibly special until the shared lightning effect breaks it.
      cell.godEssenceResolving = true;
    });
  }
  beginGodEssenceEffectLock() {
    this.godEssenceEffectLocks = (this.godEssenceEffectLocks || 0) + 1;
  }
  endGodEssenceEffectLock() {
    this.godEssenceEffectLocks = Math.max(0, (this.godEssenceEffectLocks || 0) - 1);
  }
  get godEssenceEffectLocked() {
    return (this.godEssenceEffectLocks || 0) > 0;
  }
  destroyGodEssenceTileReferences(tileRefs = [], destroyOptions = {}) {
    const references = new Set(tileRefs);
    if (!references.size) return false;
    if (this.gameplay?.physics) {
      const entries = this.gameplay.physics.entriesForTiles(references);
      return this.gameplay.destroyGodEssenceTiles(this, entries, destroyOptions);
    }
    const cells = [];
    this.board.forEachCell((tile, x, y) => {
      if (references.has(tile)) cells.push({ tile, x, y });
    });
    return this.gameplay?.destroyGodEssenceTiles(this, cells, destroyOptions) === true;
  }
  consumePhysicsGodEssenceItems(tiles = []) {
    const consumed = new Map();
    tiles.forEach((tile) => {
      if (!Number.isInteger(tile?.godEssenceItemIndex) || !tile.godEssenceInstanceId || tile.godEssenceResolving) return;
      const existing = consumed.get(tile.godEssenceInstanceId);
      consumed.set(tile.godEssenceInstanceId, existing
        ? { ...existing, destroyedMinoCount: existing.destroyedMinoCount + 1 }
        : {
            itemIndex: tile.godEssenceItemIndex,
            polarity: tile.godEssencePolarity,
            foreign: Boolean(tile.godEssenceForeign),
            x: tile.x,
            y: tile.y,
            colorIndex: tile.colorIndex,
            destroyedMinoCount: 1,
          });
    });
    consumed.forEach((item, instanceId) => {
      const itemTileRefs = [];
      const itemCells = [];
      this.gameplay?.physics?.bodies?.forEach((body) =>
        body.GetUserData?.()?.cells?.forEach((cell) => {
          if (cell.godEssenceInstanceId !== instanceId) return;
          itemTileRefs.push(cell);
          delete cell.godEssenceItemIndex;
          delete cell.godEssencePolarity;
          delete cell.godEssenceForeign;
          delete cell.godEssenceItemName;
          delete cell.godEssenceInstanceId;
        }));
      // Physics tile coordinates are body-local logical cells. The effect and
      // Color Remover contact test need their current Box2D world positions.
      this.gameplay?.physics?.entriesForTiles(itemTileRefs).forEach(({ tile, x, y }) =>
        itemCells.push({ x, y, colorIndex: tile.colorIndex, baseColor: tile.baseColor }));
      const handled = this.resolveGodEssenceItem(item.itemIndex, {
        source: "physics-break", instanceId,
        x: item.x,
        y: item.y,
        colorIndex: item.colorIndex,
        itemTileRefs,
        itemCells,
        polarity: item.polarity,
        foreign: item.foreign,
        destroyedMinoCount: item.destroyedMinoCount,
      });
      if (handled) this.keepElectricGodEssenceItemVisible(item, itemTileRefs, instanceId);
    });
  }
  consumeGodEssenceItemsAt(cells = []) {
    const consumed = new Map();
    cells.forEach(({ x, y }) => {
      const tile = this.board.get(x, y);
      if (!Number.isInteger(tile?.godEssenceItemIndex) || tile.godEssenceResolving) return;
      const existing = consumed.get(tile.pieceId);
      consumed.set(tile.pieceId, existing
        ? { ...existing, destroyedMinoCount: existing.destroyedMinoCount + 1 }
        : {
            itemIndex: tile.godEssenceItemIndex,
            polarity: tile.godEssencePolarity,
            foreign: Boolean(tile.godEssenceForeign),
            x, y,
            colorIndex: tile.colorIndex,
            destroyedMinoCount: 1,
          });
    });
    consumed.forEach((item, pieceId) => {
      const itemTileRefs = [];
      const itemCells = [];
      this.board.forEachCell((candidate, x, y) => {
        if (candidate?.pieceId !== pieceId) return;
        itemTileRefs.push(candidate);
        itemCells.push({ x, y, colorIndex: candidate.colorIndex, baseColor: candidate.baseColor });
        delete candidate.godEssenceItemIndex;
        delete candidate.godEssencePolarity;
        delete candidate.godEssenceForeign;
      });
      const handled = this.resolveGodEssenceItem(item.itemIndex, {
        source: "board-break",
        x: item.x,
        y: item.y,
        colorIndex: item.colorIndex,
        itemTileRefs,
        itemCells,
        polarity: item.polarity,
        foreign: item.foreign,
        destroyedMinoCount: item.destroyedMinoCount,
      });
      if (handled) this.keepElectricGodEssenceItemVisible(item, itemTileRefs);
    });
  }
  consumeDestroyedGodEssenceTiles(tiles = []) {
    const consumed = new Map();
    tiles.forEach((tile) => {
      if (!Number.isInteger(tile?.godEssenceItemIndex) || tile.godEssenceResolving) return;
      const key = tile.pieceId ?? `${tile.x},${tile.y}`;
      const existing = consumed.get(key);
      consumed.set(key, existing
        ? { ...existing, destroyedMinoCount: existing.destroyedMinoCount + 1 }
        : {
            itemIndex: tile.godEssenceItemIndex,
            polarity: tile.godEssencePolarity,
            foreign: Boolean(tile.godEssenceForeign),
            x: tile.x,
            y: tile.y,
            colorIndex: tile.colorIndex,
            destroyedMinoCount: 1,
          });
    });
    consumed.forEach((item, pieceId) => {
      const itemTileRefs = [];
      const itemCells = [];
      this.board.forEachCell((candidate, x, y) => {
        if (candidate?.pieceId !== pieceId) return;
        itemTileRefs.push(candidate);
        itemCells.push({ x, y, colorIndex: candidate.colorIndex, baseColor: candidate.baseColor });
        delete candidate.godEssenceItemIndex;
        delete candidate.godEssencePolarity;
        delete candidate.godEssenceForeign;
        delete candidate.godEssenceItemName;
      });
      const handled = this.resolveGodEssenceItem(item.itemIndex, {
        source: "material-break",
        x: item.x,
        y: item.y,
        colorIndex: item.colorIndex,
        itemTileRefs,
        itemCells,
        polarity: item.polarity,
        foreign: item.foreign,
        destroyedMinoCount: item.destroyedMinoCount,
      });
      if (handled) this.keepElectricGodEssenceItemVisible(item, itemTileRefs);
    });
  }
  beginGodEssenceTurn() {
    if (this.session?.roomRules?.pvp?.godEssence !== true) return;
    if (this.godEssenceTurn > 0) {
      this.godEssenceWallet.push(this.godEssenceTurn);
      this.prepareGodEssenceReward();
    }
    this.godEssenceTurn = 0;
  }
  collectGodGems(cells = []) {
    if (this.session?.roomRules?.pvp?.godEssence !== true) return;
    const gems = cells.filter((cell) => cell?.material === "gem" || cell?.gem).length;
    if (gems) this.godEssenceTurn += gems;
  }
  awardGodEssenceWalletSections(...sections) {
    if (this.session?.roomRules?.pvp?.godEssence !== true) return false;
    const awarded = (sections.length ? sections : [1])
      .map((section) => Math.max(1, Math.floor(Number(section) || 1)));
    this.godEssenceWallet.push(...awarded);
    this.prepareGodEssenceReward();
    this.render();
    return [...this.godEssenceDisplayWallet()];
  }
  applyPVPAttack(type, value = 0) {
    const count = Math.max(0, Math.floor(Number(value) || 0));
    const shielded = this.hasGodEssencePassiveEffect("shield");
    if (type === "attachments" && !shielded && this.session?.roomRules?.pvp?.pmOrderAttack !== false) this.queue.addAttachments(count);
    // Gems are a reward, not a hostile attack. Shield never rejects them.
    if (type === "gems" && this.session?.roomRules?.pvp?.godEssence !== false) this.queue.addGems(count);
    if (type === "god-essence-item" && this.session?.roomRules?.pvp?.godEssence !== false) {
      const itemIndex = Math.max(0, Math.floor(Number(value) || 0));
      const item = this.godEssenceItems[itemIndex];
      // Foreign self-polarity items are beneficial gifts. Shield rejects only
      // hostile (others-polarity) foreign items before they enter the queue.
      if (item && (!shielded || item.polarity === "self")) {
        const chain = this.session?.roomRules?.chain || {};
        const isColorMode = ["color-lines", "color-clusters"].includes(chain.mode);
        const palette = (chain.colors || [])
          .slice(0, Math.max(1, Number(chain.colorCount) || 1))
          .map(colorNumber);
        const colorIndex = isColorMode ? Math.floor(this.queueRandom() * palette.length) : -1;
        // Foreign item O blocks still have to be legitimate colour-chain
        // participants. Blue is the Lines Out foreign-item tint only; colour
        // modes use one normal palette colour and a white atlas icon.
        const o = new Polyomino({ id: "O" });
        this.queue.enqueueVisible({
          id: "O",
          matrix: o.matrix.map((row) => row.slice()),
          minos: o.minos.map((mino) => ({ ...mino, colorIndex })),
          ...(isColorMode ? { colorIndex, palette, color: palette[colorIndex] } : {}),
          godEssenceItemIndex: itemIndex,
          godEssenceForeign: true,
        });
      }
    }
    if (type === "mino-drops" && !shielded && this.session?.roomRules?.pvp?.minoDropsAttack !== false)
      this.pendingMinoDrops = (this.pendingMinoDrops || 0) + count;
  }
  clearPendingMinoDrops() {
    this.pendingMinoDrops = 0;
    this.gameplay?.clearPendingMinoDrops?.();
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
    if (Number.isInteger(this.active.godEssenceItemIndex)) {
      // Holding commits a reward choice. The held block returns as an ordinary
      // item O with that chosen id; foreign blocks remain foreign and cannot
      // gain local selection controls.
      outgoing.godEssenceItemIndex = this.active.godEssenceItemIndex;
      outgoing.godEssenceForeign = Boolean(this.active.godEssenceForeign);
      outgoing.godEssencePolarity = outgoing.godEssenceForeign
        ? "foreign"
        : this.godEssenceItems[outgoing.godEssenceItemIndex]?.polarity || "self";
    }
    if (this.hold) {
      const incoming = this.hold;
      this.hold = outgoing;
      this.spawn(incoming, { raiseForHold: true });
    } else {
      this.hold = outgoing;
      this.spawn();
    }
    this.canHold = Boolean(this.session?.roomRules?.mutators?.infiniteHold);
    this.sound.hold();
    this.onHoldChanged?.({ hold: this.hold, canHold: this.canHold });
    this.emitAudioEvent("hold", {
      position: polyominoCentroid(this.active?.cells() || []),
    });
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
      !this.godEssenceEffectLocked &&
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
    if (moved)
      this.emitAudioEvent("move", this.movementAudioDetail("init", direction));
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
    this.emitAudioEvent("hardDrop", {
      fromCells: hardDropStart,
      toCells: this.active.cells(),
      blocksTraveled: Math.max(
        0,
        Math.round(
          polyominoCentroid(this.active.cells()).y - polyominoCentroid(hardDropStart).y,
        ),
      ),
      position: polyominoCentroid(this.active.cells()),
      rows: this.rows,
    });
    this.playfield.hardDropPunch();
    this.lock({ hardDrop: true });
    return true;
  }
  softDrop() {
    if (!this.canAcceptDirectControl()) return false;
    const moved = this.active.move(this.board, 0, 1);
    if (moved) {
      this.score += 1;
      this.softDropDistance += 1;
    }
    this.updateLockState(moved);
    if (moved)
      this.emitAudioEvent("softDrop", {
        position: polyominoCentroid(this.active.cells()),
      });
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

  // Server-authoritative multiplayer results can arrive while this game is
  // still in its 3-2-1 START state. Unlike a player pause, a terminal freeze
  // must stop that countdown as well, otherwise start() later hides the
  // result panel and resumes an already-resolved round.
  freeze() {
    if (this.state === GameState.GAME_OVER || this.state === GameState.WON)
      return;
    this.state = GameState.PAUSED;
    this.playfield.hud.showPaused();
    this.onPauseChange?.(true);
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
    if (this.hasGodEssencePassiveEffect("20g")) return MIN_GRAVITY_INTERVAL_MS;
    // A newly earned reward is deliberately protected from the current late-
    // game speed. It is the reward entry itself, not ordinary received item
    // blocks, so only this hidden-wallet spawn gets the capped gravity curve.
    if (this.active?.godEssenceReward)
      return Math.max(
        MIN_GRAVITY_INTERVAL_MS,
        gravityIntervalForLevel(Math.min(6, Math.max(0, this.level - 1)) + 1),
      );
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
    if (this.hasGodEssencePassiveEffect("lock-tax")) {
      const speed = Math.max(0, this.level - 1);
      if (speed <= 5) return 0;
      if (speed >= 20) return 350;
      return ((speed - 5) / 15) * 350;
    }
    // `level` is the internal one-based Guideline level, while the player
    // selects and sees zero-based Speed. Preserve the configured delay
    // through the first 20G speed (18), then reduce it by 25 ms for every
    // later Speed.
    const excessLevels = Math.max(
      0,
      this.level - 1 - LOCK_DELAY_REDUCTION_START_SPEED,
    );
    return Math.max(
      MIN_LOCK_DELAY_MS,
      this.settings.lockDelay -
        excessLevels * POST_MAX_GRAVITY_LOCK_REDUCTION_MS,
    );
  }
  lock(options) {
    const lockOptions = options || {};
    const softDropDistance = this.softDropDistance;
    const position = this.active ? polyominoCentroid(this.active.cells()) : null;
    this.gameplay.lock(this, lockOptions);
    if (softDropDistance > 0 && !lockOptions.hardDrop) {
      this.emitAudioEvent("hardDrop", {
        softDrop: true,
        blocksTraveled: 0,
        position,
        rows: this.rows,
      });
    }
    this.emitAudioEvent("lock", {
      density: this.lockedMinoCount() /
        (Math.max(1, this.cols - 2) * this.rows),
      gameSpeed: this.level,
    });
  }
  rotateActive(amount) {
    if (this.active?.godEssenceReward) {
      const choices = this.active.godEssenceChoices;
      this.active.godEssenceChoice = (this.active.godEssenceChoice + (amount < 0 ? choices.length - 1 : 1)) % choices.length;
      this.active.godEssenceItemIndex = choices[this.active.godEssenceChoice];
      this.active.godEssenceItemName = this.godEssenceItems[this.active.godEssenceItemIndex]?.name || "ITEM";
      this.active.godEssenceForeign = this.selfTargetPvpMode;
      this.active.godEssencePolarity = this.active.godEssenceForeign
        ? "foreign"
        : this.godEssenceItems[this.active.godEssenceItemIndex]?.polarity || "self";
      if (this.session?.roomRules?.chain?.mode === "lines-out")
        this.active.color = this.active.godEssenceForeign
          ? this.godEssenceTint("foreignMino", 0xc56868)
          : this.active.godEssencePolarity === "others"
          ? this.godEssenceTint("othersMino", 0xc57a8b)
          : this.godEssenceTint("selfMino", 0x75af8a);
      this.active.minos.forEach((mino) => {
        mino.godEssenceItemIndex = this.active.godEssenceItemIndex;
        mino.godEssenceItemName = this.active.godEssenceItemName;
        mino.godEssencePolarity = this.active.godEssencePolarity;
        mino.godEssenceForeign = this.active.godEssenceForeign;
        mino.baseColor = this.active.color;
      });
      this.onGodEssenceSelectionChanged?.(this, this.active);
      return true;
    }
    if (this.hasGodEssencePassiveEffect("no-rotate")) {
      this.rotationBlockedFeedback = {
        itemId: "no-rotate",
        itemIndex: this.godEssenceItems.findIndex((item) => item.id === "no-rotate"),
        cells: this.active?.cells?.() || [],
        remainingMs: 300,
      };
      this.emitAudioEvent("rotationBlocked", this.rotationBlockedFeedback);
      return false;
    }
    const rotated = this.active?.rotate(this.board, amount);
    this.updateLockState(rotated);
    if (!rotated) return false;
    // This is immediate input feedback only. The gameplay mode still keeps
    // the spin pending until its later lock/clear scoring rules resolve it.
    const spin = this.detectSpin(this.active);
    this.emitAudioEvent("rotate", {
      isSpin: Boolean(spin),
      spin,
      position: polyominoCentroid(this.active.cells()),
    });
    if (spin) {
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
    this.updateGodEssenceRewardFlights(ms);
    this.playfield.hud.updateCallout(ms);
    if (
      this.input.take("hardDrop") &&
      this.state === GameState.PLAYING &&
      !this.godEssenceEffectLocked &&
      !this.gameplay.isControlFrozen(this)
    ) {
      this.hardDrop();
    }
    // Modes decide whether a pause request is allowed. This lets online modes
    // reject local pause while solo modes can open their own pause UI before
    // approving the state transition.
    if (this.input.take("pause") &&
      (this.state === GameState.PLAYING || this.state === GameState.GAME_OVER)) {
      const approved = this.onPauseRequest?.({ game: this }) === true;
      if (approved && this.state === GameState.PLAYING) this.setPaused(true);
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
      if (this.input.take("start")) this.playfield.hud.triggerGameOverAction();
      this.render();
      this.input.endFrame();
      return;
    }
    if (this.state !== GameState.PLAYING) {
      this.input.endFrame();
      return;
    }
    // Electric item telegraphs deliberately freeze every gameplay clock and
    // resolver. Playfield.update() above still redraws the animated bolts;
    // their completion callback performs the destruction, then releases this
    // gate for ordinary line/cluster resolution.
    if (this.godEssenceEffectLocked) {
      this.horizontalDirection = 0;
      this.horizontalRepeat = 0;
      this.softDropRepeat = 0;
      this.render();
      this.input.endFrame();
      return;
    }
    // The session clock pauses with gameplay. Future timed modes can replace
    // this source with their configured countdown without changing the HUD.
    this.elapsedMs += ms;
    this.updateGodEssencePassiveEffect(ms);
    if (this.rotationBlockedFeedback) {
      this.rotationBlockedFeedback.remainingMs -= ms;
      if (this.rotationBlockedFeedback.remainingMs <= 0)
        this.rotationBlockedFeedback = null;
    }
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
    const requestedDirection =
      this.input.held("left") && this.input.held("right")
        ? 0
        : this.input.held("left")
          ? -1
          : this.input.held("right")
            ? 1
            : 0;
    const desiredDirection = this.hasGodEssencePassiveEffect("left-right-swap")
      ? -requestedDirection
      : requestedDirection;
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
        const phase = this.horizontalInitial ? "init" : "das";
        const moved = this.active.move(this.board, desiredDirection, 0);
        this.updateLockState(moved);
        if (moved) this.emitAudioEvent("move", this.movementAudioDetail(phase, desiredDirection));
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
    this.emitAudioEvent("countdown", {
      stage,
      label: stage > 0 ? String(stage) : "GO!",
    });
  }

  resumeAfterLifeLoss() {
    this.resumingAfterLifeLoss = false;
    this.state = GameState.PLAYING;
    this.playfield.hud.hideStateMessage();
    this.spawn();
  }
  render() {
    this.playfield.setLineSeals?.(
      this.lineSeals,
      this.godEssenceItems?.findIndex((item) => item.id === "line-seal"),
    );
    this.playfield.setGodEssencePresentation({
      blind: this.hasGodEssencePassiveEffect("blind"),
      desaturated: this.hasGodEssencePassiveEffect("desaturation"),
      upsideDown: this.hasGodEssencePassiveEffect("upside-down"),
      astigmatism: this.hasGodEssencePassiveEffect("astigmatism"),
      chromaticEcho: this.hasGodEssencePassiveEffect("chromatic-echo"),
      queueJam: this.hasGodEssencePassiveEffect("queue-jam"),
      timeMs: this.elapsedMs,
    });
    this.playfield.hud.update({
      score: this.score,
      lines: this.lines,
      // Room UI exposes speed 0 as the first Guideline gravity curve. Keep
      // the internal one-based curve value out of the player-facing HUD.
      level: Math.max(0, this.level - 1),
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
      godEssenceWallet: this.godEssenceDisplayWallet(),
      godEssenceActive: this.godEssenceTurn,
      godEssenceReady: this.hasPendingGodEssenceReward(),
      activeGodEssenceItemIndex: this.activeGodEssencePassiveEffect
        ? this.godEssenceItems.findIndex((item) => item.id === this.activeGodEssencePassiveEffect.itemId)
        : -1,
      activeGodEssenceRemainingMs: this.activeGodEssencePassiveEffect?.remainingMs || 0,
    });
    this.playfield.renderer.draw(
      this.board,
      this.active,
      this.active ? projectGhost(this.active, this.board) : [],
      this.gameplay.isControlFrozen(this),
      this.rotationBlockedFeedback,
    );
    this.gameplay.render(this);
    this.reflectionCapture?.update();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.endGodEssencePassiveEffect("destroyed");
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
