/**
 * Controls a Pixi overlay used for start, pause, and game-over messages.
 *
 * This module is part of the ui layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

export class OverlayPanel {
  constructor(container, text, hint) {
    Object.assign(this, { container, text, hint });
  }
  show(text, hint) {
    this.text.text = text;
    this.hint.text = hint;
    this.container.visible = true;
  }
  hide() {
    this.container.visible = false;
  }
}
