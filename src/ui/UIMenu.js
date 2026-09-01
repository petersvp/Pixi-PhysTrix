/**
 * Groups focusable UIMenuItems into one navigable Pixi menu container.
 * Menus use vertical, horizontal, or grid-local movement for their items.
 * A focused item may enter held mode and capture horizontal adjustment input.
 * Boundary movement returns a leave request for UIMenuStack to resolve.
 * Priority controls presentation only; it does not change menu behaviour.
 */

export class UIMenu extends PIXI.Container {
  constructor({
    id,
    direction = "vertical",
    inactiveAlpha = 0.32,
    glowFilter,
    autoTriggerOnNavigate = false,
  }) {
    super();
    this.label = id;
    this.id = id;
    this.direction = direction;
    this.inactiveAlpha = inactiveAlpha;
    this.glowFilter = glowFilter;
    this.autoTriggerOnNavigate = autoTriggerOnNavigate;
    this.items = [];
    this.focusedIndex = 0;
    this.prioritized = false;
    this.neighbors = {};
  }

  addItem(item) {
    const index = this.items.length;
    this.items.push(item);
    this.addChild(item.view);
    item.attach(this, index);
    return item;
  }

  setNeighbor(direction, menu) {
    this.neighbors[direction] = menu;
    return this;
  }

  setPrioritized(prioritized) {
    this.prioritized = prioritized;
    this.alpha = prioritized ? 1 : this.inactiveAlpha;
    this.items.forEach((item) => item.setPrioritized(prioritized));
  }

  setActive(active) {
    // Section focus is communicated by its item outline and opacity only.
    // Root-level glow makes a fully visible menu look spatially inconsistent.
    this.filters = null;
  }

  select(index = 0, { trigger = false } = {}) {
    if (!this.items.length) return;
    const next = (index + this.items.length) % this.items.length;
    this.items[this.focusedIndex]?.setSelected(false);
    this.items[this.focusedIndex]?.setHeld(false);
    this.focusedIndex = next;
    this.items[this.focusedIndex].setSelected(true);
    if (trigger && this.autoTriggerOnNavigate)
      this.items[this.focusedIndex].trigger();
  }

  deselect() {
    this.items[this.focusedIndex]?.setSelected(false);
    this.items[this.focusedIndex]?.setHeld(false);
  }

  get focusedItem() {
    return this.items[this.focusedIndex];
  }

  trigger(source = "keyboard") {
    this.focusedItem?.trigger({ source });
  }

  textInput(key, source = "keyboard") {
    this.focusedItem?.textInput(key, { source });
  }

  handleNavigation(
    direction,
    { loopAtEdge = false, trigger = false, source = "keyboard" } = {},
  ) {
    const item = this.focusedItem;
    if (!item) return { handled: false, leave: direction };
    const horizontal = direction === "left" || direction === "right";
    if (item.held) {
      if (horizontal) {
        item.navigate(direction, { source });
        return { handled: true };
      }
      item.setHeld(false);
    }

    const itemAxis =
      this.direction === "horizontal"
        ? horizontal
        : this.direction === "vertical"
          ? !horizontal
          : true;
    if (!itemAxis) return { handled: false, leave: direction };
    const step = direction === "left" || direction === "up" ? -1 : 1;
    const next = this.focusedIndex + step;
    if (next >= 0 && next < this.items.length) {
      this.select(next, { trigger });
      return { handled: true };
    }
    if (loopAtEdge) {
      this.select(step < 0 ? this.items.length - 1 : 0, { trigger });
      return { handled: true };
    }
    return { handled: false, leave: direction };
  }
}
