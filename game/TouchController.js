/**
 * Converts full-screen touch gestures into normal gameplay actions.
 *
 * A drag changes the controlled polyomino's horizontal grid position.
 * Vertical swipes are reserved for hard drop and Physics Release; the HUD
 * HOLD panel is the dedicated touch target for hold, while short taps turn.
 * The controller does not mutate board state directly; GameManager remains the
 * single authority for movement, rotation, hold, and hard-drop behavior.
 */

import {
  CELL,
  TOUCH_DRAG_DEAD_ZONE_PX,
  TOUCH_HARD_DROP_FLICK_SPEED_PX_PER_SECOND,
  TOUCH_HARD_DROP_FLICK_WINDOW_MS,
  TOUCH_HARD_DROP_MAX_SWIPE_MS,
  TOUCH_SOFT_DROP_FINGER_OFFSET_ROWS,
  TOUCH_SOFT_DROP_START_DISTANCE_PX,
  TOUCH_SWIPE_MIN_DISTANCE_PX,
} from "../config/gameplayConstants.js";

export class TouchController {
  constructor(manager) {
    this.manager = manager;
    this.canvas = manager.app.canvas;
    this.canvas.style.touchAction = "none";
    this.pointer = null;
    this.onDown = (event) => this.pointerDown(event);
    this.onMove = (event) => this.pointerMove(event);
    this.onUp = (event) => this.pointerUp(event);
    this.canvas.addEventListener("pointerdown", this.onDown, { passive: false });
    this.canvas.addEventListener("pointermove", this.onMove, { passive: false });
    this.canvas.addEventListener("pointerup", this.onUp, { passive: false });
    this.canvas.addEventListener("pointercancel", this.onUp, { passive: false });
  }

  isControllable() {
    return this.manager.canAcceptDirectControl();
  }

  rootPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    const global = new PIXI.Point(
      ((event.clientX - rect.left) / rect.width) * this.manager.app.screen.width,
      ((event.clientY - rect.top) / rect.height) * this.manager.app.screen.height,
    );
    return this.manager.root.toLocal(global);
  }

  boardRowAt(event) {
    const point = this.rootPoint(event);
    const layout = this.manager.playfield.layout;
    return (point.y - layout.y) / (CELL * layout.scale);
  }

  pointerDown(event) {
    // Gameplay gestures deliberately use the whole canvas. On a narrow phone
    // this includes the side HUD, so play is not constrained to the grid.
    if (!this.isControllable()) return;
    event.preventDefault();
    this.pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPieceX: this.manager.active.x,
      startedAt: performance.now(),
      samples: [],
      moved: false,
    };
    this.recordSample(this.pointer, event);
    this.canvas.setPointerCapture?.(event.pointerId);
  }

  pointerMove(event) {
    const pointer = this.pointer;
    if (!pointer || pointer.id !== event.pointerId || !this.isControllable()) return;
    event.preventDefault();
    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    if (
      Math.abs(deltaX) > TOUCH_DRAG_DEAD_ZONE_PX ||
      Math.abs(deltaY) > TOUCH_DRAG_DEAD_ZONE_PX
    ) pointer.moved = true;

    // The piece follows the drag in grid-space. Vertical motion is classified
    // only on release so a downward hard-drop gesture never soft-drops first.
    const cellPixels = this.manager.playfieldCellScreenSize();
    const wantedX = pointer.startPieceX + Math.round(deltaX / cellPixels);
    this.manager.moveActiveToX(wantedX);
    this.recordSample(pointer, event);

    // A slow downward drag is tactile soft drop. Delay this classification so
    // a short, fast swipe remains a pure hard-drop gesture until release.
    const elapsed = performance.now() - pointer.startedAt;
    if (
      elapsed < TOUCH_HARD_DROP_MAX_SWIPE_MS ||
      deltaY < TOUCH_SOFT_DROP_START_DISTANCE_PX
    ) return;
    this.manager.setTouchSoftDropTargetY(
      Math.floor(this.boardRowAt(event)) + TOUCH_SOFT_DROP_FINGER_OFFSET_ROWS,
    );
  }

  pointerUp(event) {
    const pointer = this.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    this.pointer = null;
    this.canvas.releasePointerCapture?.(event.pointerId);
    // Soft drop is a held gesture. Do not leave a target behind after the
    // finger lifts, including on browser-generated pointer cancellation.
    this.manager.clearTouchSoftDropTarget();
    if (!this.isControllable()) return;
    event.preventDefault();
    this.recordSample(pointer, event);
    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    const downSwipe =
      deltaY >= TOUCH_SWIPE_MIN_DISTANCE_PX && Math.abs(deltaY) > Math.abs(deltaX);
    const upSwipe =
      deltaY <= -TOUCH_SWIPE_MIN_DISTANCE_PX && Math.abs(deltaY) > Math.abs(deltaX);
    const elapsed = performance.now() - pointer.startedAt;

    const flickStart = this.recentDownwardFlickStart(pointer);
    const lateHardDrop = !!flickStart;
    if (downSwipe) {
      if (elapsed <= TOUCH_HARD_DROP_MAX_SWIPE_MS || lateHardDrop) {
        // A quick full gesture returns to its starting column. A late flick
        // returns only to the column where that flick began, preserving any
        // earlier deliberate drag.
        this.manager.moveActiveToX(
          elapsed <= TOUCH_HARD_DROP_MAX_SWIPE_MS
            ? pointer.startPieceX
            : flickStart.pieceX,
        );
        this.manager.hardDrop();
      }
      return;
    }
    // An upward swipe is Physics Release. Classic's release implementation
    // returns false, so this gesture remains harmless outside Physics mode.
    if (upSwipe && event.clientY < pointer.startY) {
      this.manager.releaseActive();
      return;
    }
    if (!pointer.moved) {
      const rect = this.canvas.getBoundingClientRect();
      const cw = this.manager.settings.touchAlwaysCw ||
        event.clientX >= rect.left + rect.width / 2;
      this.manager.rotateActive(cw ? 1 : -1);
    }
  }

  recordSample(pointer, event) {
    const now = performance.now();
    pointer.samples.push({
      x: event.clientX,
      y: event.clientY,
      time: now,
      pieceX: this.manager.active?.x,
    });
    const oldest = now - TOUCH_HARD_DROP_FLICK_WINDOW_MS * 2;
    while (pointer.samples.length > 1 && pointer.samples[0].time < oldest)
      pointer.samples.shift();
  }

  recentDownwardFlickStart(pointer) {
    const samples = pointer.samples;
    const latest = samples.at(-1);
    if (!latest) return null;
    const windowStart = latest.time - TOUCH_HARD_DROP_FLICK_WINDOW_MS;
    // Keep the sample immediately before the window. Using the first sample
    // inside it could select `latest` itself and produce a zero-length test.
    let earliest = samples[0];
    for (const sample of samples) {
      if (sample.time > windowStart) break;
      earliest = sample;
    }
    const elapsed = Math.max(1, latest.time - earliest.time);
    const deltaX = latest.x - earliest.x;
    const deltaY = latest.y - earliest.y;
    const speed = (deltaY / elapsed) * 1000;
    return (
      deltaY > 0 &&
      deltaY > Math.abs(deltaX) &&
      speed >= TOUCH_HARD_DROP_FLICK_SPEED_PX_PER_SECOND
    ) ? earliest : null;
  }

  destroy() {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
    this.pointer = null;
  }
}
