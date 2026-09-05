/**
 * Registers and constructs gameplay mode implementations.
 *
 * This module is part of the app layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

export class ModeRegistry {
  constructor() {
    this.modes = new Map();
  }
  register(id, Mode) {
    this.modes.set(id, Mode);
  }
  create(id, context) {
    const Mode = this.modes.get(id);
    if (!Mode) {
      console.error("[ModeRegistry] Unknown gameplay mode.", { id });
      return null;
    }
    return new Mode(context);
  }
}
