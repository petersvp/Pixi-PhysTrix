/**
 * Defines the lifecycle interface implemented by gameplay modes.
 *
 * This module is part of the gameplay layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

export class GameplayContract {
  async load() {}
  attach(_game) {}
  reset(_game) {}
  onSpawn(_game, _piece) {}
  onGameOver(_game) {}
  lock(_game) {}
  release(_game) {
    return false;
  }
  isControlFrozen(_game) {
    return false;
  }
  step(_game, _ms) {}
  render(_game) {}
  dispose(_game) {}
  start() {}
  pause() {}
  resume() {}
  destroy() {}
}
