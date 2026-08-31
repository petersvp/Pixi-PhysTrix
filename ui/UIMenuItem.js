/**
 * Represents one focusable control inside a UIMenu.
 * The supplied view may be any Pixi display object with a state renderer.
 * Items expose selection, priority, held editing, and trigger behaviour.
 * Pointer interaction switches the owning stack into mouse or touch mode.
 * Navigation is delegated to the owning UIMenu and UIMenuStack.
 */

export class UIMenuItem {
  constructor({
    view,
    render,
    onTrigger,
    onNavigate,
    onTextInput,
    id = "item",
  }) {
    this.view = view;
    this.render = render;
    this.onTrigger = onTrigger;
    this.onNavigate = onNavigate;
    this.onTextInput = onTextInput;
    this.id = id;
    this.selected = false;
    this.prioritized = false;
    this.held = false;
    this.view.eventMode = "static";
    this.view.cursor = "pointer";
  }

  attach(menu, index) {
    this.menu = menu;
    this.index = index;
    this.view.on("pointerover", () => {
      menu.stack?.usePointer(menu, index);
    });
    this.view.on("pointertap", (event) => {
      menu.stack?.usePointer(menu, index);
      this.trigger({ source: "pointer", originalEvent: event });
    });
    this.refresh();
  }

  refresh() {
    this.render?.({
      selected: this.selected,
      prioritized: this.prioritized,
      held: this.held,
    });
  }

  setSelected(selected) {
    if (this.selected === selected) return;
    this.selected = selected;
    this.refresh();
  }

  setPrioritized(prioritized) {
    if (this.prioritized === prioritized) return;
    this.prioritized = prioritized;
    this.refresh();
  }

  setHeld(held) {
    if (this.held === held) return;
    this.held = held;
    this.refresh();
  }

  makeEvent(type, details = {}) {
    return {
      type,
      source: "keyboard",
      item: this,
      menu: this.menu,
      ...details,
    };
  }

  trigger(details) {
    const event = this.makeEvent("trigger", details);
    console.log(
      `[PhysTrix] UI trigger: ${this.menu?.id || "unattached"}/${this.id} via ${event.source}`,
    );
    this.onTrigger?.(this, event);
    this.refresh();
  }

  navigate(direction, details) {
    this.onNavigate?.(
      direction,
      this,
      this.makeEvent("navigate", { direction, ...details }),
    );
    this.refresh();
  }

  textInput(key, details) {
    this.onTextInput?.(this, this.makeEvent("textInput", { key, ...details }));
    this.refresh();
  }
}
