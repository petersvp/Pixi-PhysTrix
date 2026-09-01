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
    const activatePointer = (event) => {
      menu.stack?.usePointer(menu, index);
      const pointerType = event.pointerType || event.nativeEvent?.pointerType;
      this.trigger({
        source: pointerType === "touch" ? "touch" : "pointer",
        originalEvent: event,
      });
    };
    this.view.on("pointerover", () => {
      menu.stack?.usePointer(menu, index);
    });
    this.view.on("pointerdown", (event) => {
      this.pressedPointerId = event.pointerId;
    });
    this.view.on("pointerup", (event) => {
      // Pointerup is delivered reliably by mobile browsers, unlike pointertap
      // in some touch WebViews. It also keeps mouse activation on release.
      if (this.pressedPointerId !== event.pointerId) return;
      this.pressedPointerId = null;
      this.handledPointerTap = event.pointerId;
      activatePointer(event);
    });
    this.view.on("pointerupoutside", (event) => {
      if (this.pressedPointerId === event.pointerId) this.pressedPointerId = null;
    });
    this.view.on("pointertap", (event) => {
      if (this.handledPointerTap === event.pointerId) {
        this.handledPointerTap = null;
        return;
      }
      activatePointer(event);
    });
    this.refresh();
    // Start-menu item renderers rebuild their visual children on focus. A
    // stable hit area on the container prevents that rebuild from invalidating
    // an in-progress touch target between pointerover and pointerup.
    if (!this.view.hitArea) {
      const bounds = this.view.getLocalBounds();
      if (bounds.width > 0 && bounds.height > 0)
        this.view.hitArea = new PIXI.Rectangle(
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
        );
    }
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
