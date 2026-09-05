import { createHardModeBag } from "./bags.js";

/**
 * Defines gameplay dimensions, timing rules, and physics material constants.
 *
 * This module is part of the config layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

export const COLS = 10;
export const ROWS = 20;

// Classic line clears normally use Guideline row collapse. Enable this to
// make each surviving connected piece fragment fall as a rigid grid group.
export const CLASSIC_STICKY_GRAVITY = true;
// Classic clear resolution. Marked lines remain visible briefly, then every
// surviving sticky group animates to its new grid position before a rescan.
export const CLASSIC_VANISH_DURATION_MS = 200;
export const CLASSIC_STICKY_FALL_CELLS_PER_SECOND = 18;

// Select the default source here. Bag construction and room-preset functions
// live in config/bags.js; PieceQueue owns the final shuffle.
export const bagGenerator = createHardModeBag;

// Development escape hatch: retain play after a top-out when explicitly enabled.
export const DEBUG_NO_GAME_OVER = false;
export const CELL = 30;
export const FRAMERULE_INTERVAL = 20;

// Direct-touch gesture thresholds are CSS pixels so the controls feel the
// same on a high-DPI phone and a desktop browser window.
export const TOUCH_DRAG_DEAD_ZONE_PX = 8;
export const TOUCH_SWIPE_MIN_DISTANCE_PX = 52;
// A downward gesture faster than this is a hard drop. A slower descent moves
// through rows as soft drop, including the remaining distance on release.
export const TOUCH_HARD_DROP_MAX_SWIPE_MS = 260;
// A long soft-drop gesture may end with a deliberate quick flick. Sample the
// final window rather than relying on display-frame count, then hard drop when
// its downward velocity reaches this threshold.
export const TOUCH_HARD_DROP_FLICK_WINDOW_MS = 120;
export const TOUCH_HARD_DROP_FLICK_SPEED_PX_PER_SECOND = 500;
// Slow touch drop targets the current finger row directly. Keeping one grid
// row below the finger preserves visibility of the controlled polyomino.
export const TOUCH_SOFT_DROP_FINGER_OFFSET_ROWS = -2;
// A slow touch drag must travel this far downward before it starts feeding a
// soft-drop target. This avoids incidental finger drift starting a descent.
export const TOUCH_SOFT_DROP_START_DISTANCE_PX = 80;

// Gravity is capped once the Guideline curve reaches one simulation frame.
// Further levels reduce lock time instead, keeping high-level play difficult.
export const MIN_GRAVITY_INTERVAL_MS = 16;
export const POST_MAX_GRAVITY_LOCK_REDUCTION_MS = 25;
export const MIN_LOCK_DELAY_MS = 100;
export const gravityIntervalForLevel = (level) => {
  const n = Math.max(0, level - 1);
  return Math.pow(0.8 - n * 0.007, n) * 1000;
};
export const FIRST_MAX_GRAVITY_LEVEL = (() => {
  let level = 1;
  let steps = 0;
  while (gravityIntervalForLevel(level) > MIN_GRAVITY_INTERVAL_MS) {
    if (++steps > 1000) {
      console.error("[Gameplay] Gravity-level safety limit reached.", {
        level,
        interval: gravityIntervalForLevel(level),
      });
      break;
    }
    level += 1;
  }
  return level;
})();

// Maximum vertical spread of fixture centers accepted by a horizontal clear scan.
export const LINE_SCAN_VERTICAL_TOLERANCE = 0.5;
// Height spread at or below this value counts as a perfectly straight
// physics line. Perfect lines always receive the maximum score multiplier.
export const PHYSICS_LINE_PERFECT_VERTICAL_TOLERANCE = 0.03;
// Physics clear rewards based on the fixture-center height spread measured by
// the qualifying horizontal Box2D ray. Perfectly level rows earn the maximum.
export const PHYSICS_LINE_STRAIGHTNESS_MIN_MULTIPLIER = 0.5;
export const PHYSICS_LINE_STRAIGHTNESS_MAX_MULTIPLIER = 2;
export const VANISH_DURATION_MS = 850;

// After releasing a controlled physics polyomino, let the pile settle. Once
// the minimum wait passes, spawn only when the next piece fits; the maximum
// wait prevents an unwinnable stalled state and deliberately triggers top-out.
export const PHYSICS_RELEASE_SPAWN_MIN_WAIT_MS = 750;
export const PHYSICS_RELEASE_SPAWN_MAX_WAIT_MS = 2500;
// Physics material controls. Box2D uses density rather than a direct mass;
// this mass value is therefore supplied as fixture density for equal minos.
export const PHYSICS_MASS = 1;

// Releasing starts a polyomino at the configured multiple of its fixture
// density. Its first collision starts a timed return to the base density.
export const PHYSICS_RELEASE_MASS_MULTIPLIER = 100;
export const PHYSICS_RELEASE_MASS_RESET_DURATION_MS = 200;

// A physics hard drop also becomes temporarily heavy on its first impact.
// Keep this separate from Release so room presets can tune both actions.
export const PHYSICS_HARD_DROP_MASS_MULTIPLIER = 20;
export const PHYSICS_HARD_DROP_MASS_RESET_DURATION_MS = 200;
export const PHYSICS_HARD_DROP_MASS_IMPACT_HOLD_DURATION_MS = 16;

export const PHYSICS_FRICTION = 0.2;
export const PHYSICS_BOUNCINESS = 0.3;
