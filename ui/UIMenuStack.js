/**
 * Owns a chain or grid of UIMenus and routes shared navigation input.
 * Keyboard or controller navigation highlights one prioritized active menu.
 * Pointer or touch interaction prioritizes every menu for direct manipulation.
 * Boundary navigation can follow explicit cardinal neighbours or stack geometry.
 * The stack never owns application actions such as starting a game session.
 */

export class UIMenuStack extends PIXI.Container {
  constructor({ layout = "horizontal" } = {}) {
    super();
    this.label = "uiMenuStack";
    this.layout = layout;
    this.entries = [];
    this.activeMenu = null;
    this.pointerMode = false;
  }

  addMenu(menu, gridX = 0, gridY = 0) {
    menu.stack = this;
    this.entries.push({ menu, gridX, gridY });
    this.addChild(menu);
    menu.setPrioritized(false);
    return menu;
  }

  setLayout(layout) {
    this.layout = layout;
  }

  activate(menu, index, { trigger = false } = {}) {
    if (!menu) return;
    this.pointerMode = false;
    if (this.activeMenu && this.activeMenu !== menu) this.activeMenu.deselect();
    this.activeMenu = menu;
    this.entries.forEach(({ menu: candidate }) => {
      candidate.setPrioritized(candidate === menu);
      candidate.setActive(candidate === menu);
    });
    // Enter a menu on the item's actual selected state. Navigation must not
    // silently reset a choice just because focus moved to another menu.
    const focusIndex =
      index ?? menu.getSelectedIndex?.() ?? menu.focusedIndex ?? 0;
    menu.select(focusIndex, { trigger });
  }

  usePointer(menu, index) {
    this.pointerMode = true;
    if (this.activeMenu && this.activeMenu !== menu) this.activeMenu.deselect();
    this.activeMenu = menu;
    this.entries.forEach(({ menu: candidate }) => {
      candidate.setPrioritized(true);
      candidate.setActive(false);
    });
    menu.select(index);
  }

  directionVector(direction) {
    return { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[
      direction
    ];
  }

  resolveGeometryNeighbor(menu, direction) {
    const current = this.entries.find((entry) => entry.menu === menu);
    if (!current) return null;
    const [dx, dy] = this.directionVector(direction);
    return (
      this.entries.find(
        (entry) =>
          entry.gridX === current.gridX + dx &&
          entry.gridY === current.gridY + dy,
      )?.menu || null
    );
  }

  navigate(direction, source = "keyboard") {
    if (!this.activeMenu) {
      this.activate(this.entries[0]?.menu);
      return;
    }
    const result = this.activeMenu.handleNavigation(direction, {
      loopAtEdge:
        this.layout === "horizontal" && !this.activeMenu.neighbors[direction],
      trigger: true,
      source,
    });
    if (result.handled) return;
    const neighbor =
      this.activeMenu.neighbors[result.leave] ||
      this.resolveGeometryNeighbor(this.activeMenu, result.leave);
    if (!neighbor) return;
    this.activate(neighbor, undefined, { trigger: true });
  }

  trigger(source = "keyboard") {
    if (!this.activeMenu) this.activate(this.entries[0]?.menu);
    else this.activeMenu.trigger(source);
  }

  textInput(key, source = "keyboard") {
    this.activeMenu?.textInput(key, source);
  }

  moveActive(direction) {
    const index = this.entries.findIndex(
      (entry) => entry.menu === this.activeMenu,
    );
    const next =
      (index + direction + this.entries.length) % this.entries.length;
    this.activate(this.entries[next]?.menu, undefined, { trigger: true });
  }

  advance() {
    const index = this.entries.findIndex(
      (entry) => entry.menu === this.activeMenu,
    );
    if (index < 0 || index >= this.entries.length - 1) return;
    this.activate(this.entries[index + 1]?.menu, undefined, { trigger: true });
  }
}
