/**
 * Builds the responsive PhysTrix start scene from reusable UI menu primitives.
 * Landscape presents four explicit columns; narrow and portrait screens use a
 * two by two menu stack suited to touch and compact mobile displays.
 * UIMenuStack owns directional focus; portrait mode gives Start its own third
 * row menu while Enter and controller Start remain global launch shortcuts.
 * Skin previews are rendered once into textures and reused by their menu items.
 */

import { COLORS } from "../config/colors.js";
import { GAMEPAD_BUTTON } from "../config/controls.js";
import { MINO_SKINS } from "../config/skinCatalog.js";
import {
  GAME_VIEWPORT_HEIGHT,
  START_MENU_BUTTON_GAP,
  START_MENU_BUTTON_HEIGHT,
  START_MENU_FOOTER_BOTTOM_PADDING,
  START_MENU_FOOTER_HEIGHT,
  START_MENU_HORIZONTAL_ACTION_ROW_GAP,
  START_MENU_HORIZONTAL_TOP_ROW_Y,
  START_MENU_INACTIVE_SECTION_ALPHA,
  START_MENU_LOGO_FACE_PHYS,
  START_MENU_LOGO_FACE_TRIX,
  START_MENU_LOGO_GLOW_EXTENT,
  START_MENU_LOGO_TOP_PADDING,
  START_MENU_MOBILE_MIN_VIEWPORT_HEIGHT,
  START_MENU_MOBILE_VIEWPORT_WIDTH,
  START_MENU_NARROW_WIDTH,
  START_MENU_RADIUS,
  START_MENU_TITLE_FONT_SIZE,
  START_MENU_VERTICAL_ROW_GAP,
  START_MENU_VERTICAL_START_TO_FOOTER_GAP,
  START_MENU_VERTICAL_TOP_ROW_Y,
  START_MENU_VIEWPORT_WIDTH,
} from "../config/uiConstants.js";
import { MinoQuadRenderer } from "../render/MinoQuadRenderer.js";
import { loadSkin } from "../render/ShaderSettings.js";
import { AdvancedLineRenderer } from "../render/AdvancedLineRenderer.js";
import { UIMenuItem } from "../ui/UIMenuItem.js";
import { UIMenu } from "../ui/UIMenu.js";
import { UIMenuStack } from "../ui/UIMenuStack.js";

const PHYSICS_PRESETS = Object.freeze([
  { id: "balanced", label: "BALANCED" },
  { id: "slippery", label: "SLIPPERY" },
  { id: "rubber", label: "RUBBER" },
  { id: "static", label: "STATIC" },
]);
const POLYOMINO_OPTIONS = Object.freeze([
  { id: "tetrominoes", label: "TETROMINOS" },
  { id: "tetra-penta", label: "TETRO & PENTA" },
  { id: "pentominoes", label: "PENTOMINOS" },
  { id: "hard", label: "HARD MODE" },
]);
export class StartMenu {
  constructor({ app, scene, session, onStart, onSettings, onSkinSelect }) {
    Object.assign(this, { app, scene, onStart, onSettings, onSkinSelect });
    this.physicsPreset =
      session.physicsPreset ||
      (session.gameplayMode === "classic" ? "static" : "balanced");
    this.polyominoPreset = session.polyominoPreset || "tetrominoes";
    const legacySkinMap = {
      "skin-default.json": "skin-default.json",
      "skin-chisel2.json": "skin-chisel.json",
      "skin-tengen-style.json": "skin-chisel.json",
      "skin-chisel-rounded.json": "skin-default.json",
      "skin-chisel-hard.json": "skin-chisel.json",
      "skin-soft.json": "skin-soft.json",
    };
    this.skin = legacySkinMap[session.skin] || session.skin || "skin-default.json";
    this.level = Number(session.startLevel) || 0;
    this.trash = Number(session.trash) || 0;
    this.skinPreviews = new Map();
    this.root = new PIXI.Container();
    this.root.label = "startMenuRoot";
    scene.addChild(this.root);
    this.resize = () => this.layout();
    this.keydown = (event) => this.handleKey(event);
    this.pollGamepad = () => this.handleGamepad();
    addEventListener("resize", this.resize);
    addEventListener("keydown", this.keydown);
    app.ticker.add(this.pollGamepad);
    this.presentation = this.presentationForViewport();
    this.build();
    this.layout();
    this.buildSkinPreviews();
  }

  presentationForViewport() {
    return innerWidth < START_MENU_NARROW_WIDTH || innerHeight > innerWidth
      ? "vertical"
      : "horizontal";
  }
  layout() {
    const presentation = this.presentationForViewport();
    if (presentation !== this.presentation) {
      this.presentation = presentation;
      this.build();
    }
    const viewportWidth = this.viewportWidth();
    const viewportHeight = this.viewportHeight();
    const scale = Math.min(
      innerWidth / viewportWidth,
      innerHeight / viewportHeight,
    );
    this.root.scale.set(scale);
    this.root.position.set(
      (innerWidth - viewportWidth * scale) / 2,
      (innerHeight - viewportHeight * scale) / 2,
    );
  }
  viewportWidth() {
    return this.presentation === "vertical"
      ? START_MENU_MOBILE_VIEWPORT_WIDTH
      : START_MENU_VIEWPORT_WIDTH;
  }
  viewportHeight() {
    if (this.presentation !== "vertical") return GAME_VIEWPORT_HEIGHT;
    // When width is the limiting dimension, expand the logical design height
    // so its footer can still sit at the physical bottom of the viewport.
    const widthScale = Math.max(
      0.01,
      innerWidth / START_MENU_MOBILE_VIEWPORT_WIDTH,
    );
    return Math.max(
      START_MENU_MOBILE_MIN_VIEWPORT_HEIGHT,
      innerHeight / widthScale,
    );
  }
  sectionGeometry() {
    if (this.presentation === "vertical") {
      const itemHeight = 50;
      const gap = 8;
      const firstRowHeight =
        38 + PHYSICS_PRESETS.length * (itemHeight + gap) - gap;
      const secondRowY =
        START_MENU_VERTICAL_TOP_ROW_Y +
        firstRowHeight +
        START_MENU_VERTICAL_ROW_GAP;
      const footerY =
        this.viewportHeight() -
        START_MENU_FOOTER_BOTTOM_PADDING -
        START_MENU_FOOTER_HEIGHT;
      return {
        physics: { x: 16, y: START_MENU_VERTICAL_TOP_ROW_Y, width: 170 },
        polyominos: { x: 204, y: START_MENU_VERTICAL_TOP_ROW_Y, width: 170 },
        skin: { x: 16, y: secondRowY, width: 170 },
        numeric: { x: 204, y: secondRowY, width: 170 },
        start: {
          x: 110,
          y: footerY - START_MENU_VERTICAL_START_TO_FOOTER_GAP - 54,
          width: 170,
        },
        logoY: START_MENU_LOGO_TOP_PADDING,
        itemHeight,
        gap,
      };
    }
    const numericBottom = START_MENU_HORIZONTAL_TOP_ROW_Y + 38 + 92 + 76;
    return {
      physics: { x: 40, y: START_MENU_HORIZONTAL_TOP_ROW_Y, width: 190 },
      polyominos: { x: 260, y: START_MENU_HORIZONTAL_TOP_ROW_Y, width: 190 },
      skin: { x: 480, y: START_MENU_HORIZONTAL_TOP_ROW_Y, width: 190 },
      numeric: { x: 700, y: START_MENU_HORIZONTAL_TOP_ROW_Y, width: 160 },
      actions: {
        x: 282,
        y: numericBottom + START_MENU_HORIZONTAL_ACTION_ROW_GAP,
        width: 160,
      },
      logoY: START_MENU_LOGO_TOP_PADDING,
      itemHeight: START_MENU_BUTTON_HEIGHT,
      gap: START_MENU_BUTTON_GAP,
    };
  }

  build() {
    console.log("BUILD?");
    this.root
      .removeChildren()
      .forEach((child) => child.destroy({ children: true }));
    this.itemGroups = [];
    this.geometry = this.sectionGeometry();
    this.drawLogo();
    this.stack = new UIMenuStack({
      layout: this.presentation === "vertical" ? "grid" : "horizontal",
    });
    this.stack.label = "startMenuStack";
    this.root.addChild(this.stack);
    const grid =
      this.presentation === "vertical"
        ? [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ]
        : [
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
          ];
    this.physicsMenu = this.createMenu(
      "physicsMenu",
      this.geometry.physics,
      ...grid[0],
    );
    this.polyominoMenu = this.createMenu(
      "polyominoMenu",
      this.geometry.polyominos,
      ...grid[1],
    );
    this.skinMenu = this.createMenu("skinMenu", this.geometry.skin, ...grid[2]);
    this.numericMenu = this.createMenu(
      "numericMenu",
      this.geometry.numeric,
      ...grid[3],
    );
    this.buildChoiceMenu(
      this.physicsMenu,
      "PHYSICS",
      PHYSICS_PRESETS,
      () => this.physicsPreset,
      (value) => {
        this.physicsPreset = value;
      },
    );
    this.buildChoiceMenu(
      this.polyominoMenu,
      "POLYOMINOS",
      POLYOMINO_OPTIONS,
      () => this.polyominoPreset,
      (value) => {
        this.polyominoPreset = value;
      },
    );
    this.buildSkinMenu();
    this.buildNumericMenu();
    if (this.presentation === "vertical") {
      this.startMenu = this.createMenu("startMenu", this.geometry.start, 0, 2);
      this.buildStartMenu();
      // The visually centred third-row menu is reachable from either second-row
      // section without forcing a misleading horizontal detour.
      this.skinMenu.setNeighbor("down", this.startMenu);
      this.numericMenu.setNeighbor("down", this.startMenu);
      this.startMenu.setNeighbor("up", this.numericMenu);
    } else {
      this.actionMenu = this.createMenu(
        "actionMenu",
        this.geometry.actions,
        3,
        1,
        "horizontal",
      );
      this.buildActionMenu();
      this.numericMenu.setNeighbor("down", this.actionMenu);
      this.actionMenu.setNeighbor("up", this.numericMenu);
    }
    this.drawFooter();
    this.stack.activate(
      this.physicsMenu,
      Math.max(
        0,
        PHYSICS_PRESETS.findIndex((option) => option.id === this.physicsPreset),
      ),
    );
  }
  createMenu(id, geometry, gridX, gridY, direction = "vertical") {
    const menu = new UIMenu({
      id,
      direction,
      // Actions are always visible. They are utility controls, not part of
      // the dimmed configuration-choice hierarchy.
      inactiveAlpha:
        id === "startMenu" || id === "actionMenu"
          ? 1
          : START_MENU_INACTIVE_SECTION_ALPHA,
      autoTriggerOnNavigate:
        id !== "numericMenu" && id !== "startMenu" && id !== "actionMenu",
    });
    menu.position.set(geometry.x, geometry.y);
    this.stack.addMenu(menu, gridX, gridY);
    return menu;
  }
  drawLogo() {
    const style = (fill, neon) => ({
      fontFamily: "Quantico",
      fontSize: this.presentation === "vertical" ? 64 : 78,
      fontWeight: "bold",
      fill,
      stroke: { color: neon, width: 2.5 },
      dropShadow: { color: neon, blur: 16, distance: 0, alpha: 0.9 },
      padding: START_MENU_LOGO_GLOW_EXTENT,
    });
    const phys = new PIXI.Text({
      text: "Phys",
      style: style(START_MENU_LOGO_FACE_PHYS, COLORS.MENU_LOGO),
    });
    const trix = new PIXI.Text({
      text: "Trix",
      style: style(START_MENU_LOGO_FACE_TRIX, COLORS.MENU_LOGO_TEXT),
    });
    const width = phys.width + trix.width;
    phys.position.set(
      (this.viewportWidth() - width) / 2,
      this.geometry?.logoY || this.sectionGeometry().logoY,
    );
    trix.position.set(phys.x + phys.width, phys.y);
    this.root.addChild(phys, trix);
  }
  addHeading(menu, text, width) {
    const heading = new PIXI.Text({
      text,
      style: {
        fontFamily: "Quantico",
        fontSize: START_MENU_TITLE_FONT_SIZE,
        fontWeight: "bold",
        fill: COLORS.HUD_LABEL,
      },
    });
    heading.anchor.set(0.5, 0);
    heading.position.set(width / 2, 0);
    menu.addChild(heading);
  }

  createButtonVisual({ label, width, height, selected, id }) {
    const view = new PIXI.Container();
    view.label = id;
    const render = ({ selected: focused, held }) => {
      view
        .removeChildren()
        .forEach((child) => child.destroy({ children: true }));
      const isSelected = selected();
      const border = held
        ? COLORS.CALLOUT_CHAIN
        : focused
          ? 0xffd34d
          : isSelected
            ? COLORS.MENU_LOGO_TEXT
            : COLORS.PANEL_BORDER;
      view.addChild(
        new PIXI.Graphics()
          .roundRect(0, 0, width, height, START_MENU_RADIUS)
          .fill({
            color: isSelected ? COLORS.PANEL_ACCENT : COLORS.PANEL_BG,
            alpha: isSelected ? 0.96 : 1,
          }),
      );
      this.drawTexturedOutline(
        view,
        0,
        0,
        width,
        height,
        START_MENU_RADIUS,
        border,
        focused || held ? 3 : 2,
        `${id}Outline`,
      );
      const text = new PIXI.Text({
        text: label(),
        style: {
          fontFamily: "Quantico",
          fontSize:
            this.presentation === "vertical" && height >= 54
              ? 16
              : height < 46
                ? 14
                : 16,
          fontWeight: "bold",
          fill: isSelected ? COLORS.APP_BACKGROUND : COLORS.HUD_BUTTON_TEXT,
        },
      });
      text.anchor.set(0.5);
      text.position.set(width / 2, height / 2);
      view.addChild(text);
    };
    return { view, render };
  }
  buildChoiceMenu(menu, heading, options, selectedValue, setValue) {
    const key = menu.id === "physicsMenu" ? "physics" : "polyominos";
    const { width } = this.geometry[key];
    const { itemHeight, gap } = this.geometry;
    this.addHeading(menu, heading, width);
    const group = [];
    menu.getSelectedIndex = () =>
      Math.max(
        0,
        options.findIndex((option) => option.id === selectedValue()),
      );
    options.forEach((option, index) => {
      const visual = this.createButtonVisual({
        id: `${menu.id}${option.id}`,
        label: () => option.label,
        width,
        height: itemHeight,
        selected: () => selectedValue() === option.id,
      });
      visual.view.position.set(0, 38 + index * (itemHeight + gap));
      const item = new UIMenuItem({
        ...visual,
        id: option.id,
        onTrigger: () => {
          setValue(option.id);
          group.forEach((candidate) => candidate.refresh());
        },
      });
      menu.addItem(item);
      group.push(item);
    });
    this.itemGroups.push(group);
  }
  buildSkinMenu() {
    const { width } = this.geometry.skin;
    const { itemHeight, gap } = this.geometry;
    this.addHeading(this.skinMenu, "SKIN", width);
    const group = [];
    this.skinMenu.getSelectedIndex = () =>
      Math.max(
        0,
        MINO_SKINS.findIndex((skin) => skin.file === this.skin),
      );
    MINO_SKINS.forEach((skin, index) => {
      const view = new PIXI.Container();
      view.label = `skinPreview${skin.file}`;
      view.position.set(0, 38 + index * (itemHeight + gap));
      const render = ({ selected: focused, held }) => {
        view
          .removeChildren()
          .forEach((child) => child.destroy({ children: true }));
        const chosen = this.skin === skin.file;
        const border = held
          ? COLORS.CALLOUT_CHAIN
          : focused
            ? 0xffd34d
            : chosen
              ? COLORS.MENU_LOGO_TEXT
              : COLORS.PANEL_BORDER;
        view.addChild(
          new PIXI.Graphics()
            .roundRect(0, 0, width, itemHeight, START_MENU_RADIUS)
            .fill({
              color: chosen ? COLORS.PANEL_ACCENT : COLORS.PANEL_BG,
              alpha: chosen ? 0.96 : 1,
            }),
        );
        this.drawTexturedOutline(
          view,
          0,
          0,
          width,
          itemHeight,
          START_MENU_RADIUS,
          border,
          focused || held ? 3 : 2,
          `skin${index}Outline`,
        );
        const texture = this.skinPreviews.get(skin.file);
        const preview = texture
          ? new PIXI.Sprite(texture)
          : new PIXI.Sprite(PIXI.Texture.WHITE);
        preview.tint = skin.color;
        preview.width = itemHeight - 14;
        preview.height = itemHeight - 14;
        preview.position.set(8, 7);
        view.addChild(preview);
        const caption = new PIXI.Text({
          text: skin.label,
          style: {
            fontFamily: "Quantico",
            fontSize: itemHeight < 46 ? 13 : 15,
            fontWeight: "bold",
            fill: chosen ? COLORS.APP_BACKGROUND : COLORS.HUD_BUTTON_TEXT,
          },
        });
        caption.anchor.set(0, 0.5);
        caption.position.set(itemHeight + 6, itemHeight / 2);
        view.addChild(caption);
      };
      const item = new UIMenuItem({
        view,
        render,
        id: skin.file,
        onTrigger: () => {
          this.skin = skin.file;
          this.onSkinSelect?.(skin.file);
          group.forEach((candidate) => candidate.refresh());
        },
      });
      this.skinMenu.addItem(item);
      group.push(item);
    });
    this.itemGroups.push(group);
  }
  buildNumericMenu() {
    const { width } = this.geometry.numeric;
    this.addHeading(this.numericMenu, "LEVEL / TRASH", width);
    const group = [];
    [
      {
        id: "level",
        label: "LEVEL",
        get: () => this.level,
        set: (value) => {
          this.level = value;
        },
      },
      {
        id: "trash",
        label: "TRASH",
        get: () => this.trash,
        set: (value) => {
          this.trash = value;
        },
      },
    ].forEach((setting, index) => {
      const height = this.presentation === "vertical" ? 60 : 76;
      const rowStep = this.presentation === "vertical" ? 72 : 92;
      const view = new PIXI.Container();
      view.label = `${setting.id}Selector`;
      view.position.set(0, 38 + index * rowStep);
      const render = ({ selected, held }) => {
        view
          .removeChildren()
          .forEach((child) => child.destroy({ children: true }));
        // Orange is focus only. The light-blue fill is reserved for held
        // editing, so the player can immediately see captured left/right input.
        const border = selected || held ? 0xffd34d : COLORS.PANEL_BORDER;
        view.addChild(
          new PIXI.Graphics()
            .roundRect(0, 0, width, height, START_MENU_RADIUS)
            .fill({
              color: held ? COLORS.PANEL_ACCENT : COLORS.PANEL_BG,
              alpha: held ? 0.96 : 1,
            }),
        );
        this.drawTexturedOutline(
          view,
          0,
          0,
          width,
          height,
          START_MENU_RADIUS,
          border,
          selected || held ? 3 : 2,
          `${setting.id}SelectorOutline`,
        );
        const textColor = held ? COLORS.APP_BACKGROUND : COLORS.HUD_VALUE;
        const label = new PIXI.Text({
          text: setting.label,
          style: {
            fontFamily: "Quantico",
            fontSize: 14,
            fontWeight: "bold",
            fill: held ? COLORS.APP_BACKGROUND : COLORS.HUD_LABEL,
          },
        });
        label.position.set(14, 10);
        const value = new PIXI.Text({
          text: String(setting.get()),
          style: {
            fontFamily: "Quantico",
            fontSize: 31,
            fontWeight: "bold",
            fill: textColor,
          },
        });
        value.anchor.set(0.5);
        value.position.set(width / 2, 45);
        const minus = new PIXI.Text({
          text: "<",
          style: {
            fontFamily: "Quantico",
            fontSize: 23,
            fontWeight: "bold",
            fill: textColor,
          },
        });
        const plus = new PIXI.Text({
          text: ">",
          style: {
            fontFamily: "Quantico",
            fontSize: 23,
            fontWeight: "bold",
            fill: textColor,
          },
        });
        minus.anchor.set(0.5);
        plus.anchor.set(0.5);
        minus.position.set(24, 45);
        plus.position.set(width - 24, 45);
        view.addChild(label, value, minus, plus);
      };
      const adjust = (amount) =>
        setting.set(Math.max(0, Math.min(15, setting.get() + amount)));
      const item = new UIMenuItem({
        view,
        render,
        id: setting.id,
        onTrigger: (target, event) => {
          if (event.source === "pointer") {
            const point = event.originalEvent.getLocalPosition(view);
            if (point.x < 44) adjust(-1);
            else if (point.x > width - 44) adjust(1);
          }
          // Any trigger, including one on an arrow, captures keyboard editing.
          target.setHeld(true);
          target.editBuffer = "";
          target.lastTextInputAt = 0;
          group.forEach((candidate) => candidate.refresh());
        },
        onNavigate: (direction) => {
          adjust(direction === "left" ? -1 : 1);
          group.forEach((candidate) => candidate.refresh());
        },
        onTextInput: (target, event) => {
          const now = performance.now();
          if (event.key === "Backspace")
            target.editBuffer = target.editBuffer.slice(0, -1);
          else if (/^\d$/.test(event.key))
            target.editBuffer =
              now - target.lastTextInputAt < 750
                ? `${target.editBuffer}${event.key}`
                : event.key;
          else return;
          target.lastTextInputAt = now;
          if (target.editBuffer)
            setting.set(Math.max(0, Math.min(15, Number(target.editBuffer))));
          group.forEach((candidate) => candidate.refresh());
        },
      });
      this.numericMenu.addItem(item);
      group.push(item);
    });
    this.itemGroups.push(group);
  }
  buildStartMenu() {
    const group = [];
    this.addStartMenuItem(this.startMenu, group, 0);
    this.itemGroups.push(group);
  }
  buildActionMenu() {
    const group = [];
    this.addStartMenuItem(this.actionMenu, group, 0, 0);
    this.addSettingsMenuItem(this.actionMenu, group, 0, 176);
    this.itemGroups.push(group);
  }
  addStartMenuItem(menu, group, y, x = 0) {
    const { width } =
      menu === this.actionMenu ? this.geometry.actions : this.geometry.start;
    const visual = this.createButtonVisual({
      id: "directStartButton",
      label: () => "START",
      width,
      height: 54,
      selected: () => true,
    });
    visual.view.position.set(x, y);
    const item = new UIMenuItem({
      ...visual,
      id: "start",
      // A pointer tap is an explicit click. Keyboard/controller trigger is
      // intentionally ignored: only Enter or controller Start launches.
      onTrigger: (_item, event) => {
        if (event.source === "pointer") this.start();
      },
    });
    menu.addItem(item);
    group.push(item);
  }
  addSettingsMenuItem(menu, group, y, x = 0) {
    const { width } = this.geometry.actions;
    const visual = this.createButtonVisual({
      id: "menuSettingsButton",
      label: () => "SETTINGS",
      width,
      height: 50,
      selected: () => false,
    });
    visual.view.position.set(x, y);
    const item = new UIMenuItem({
      ...visual,
      id: "settings",
      onTrigger: () => this.onSettings?.(),
    });
    menu.addItem(item);
    group.push(item);
  }
  drawTexturedOutline(
    parent,
    x,
    y,
    width,
    height,
    radius,
    color,
    thickness,
    label,
  ) {
    new AdvancedLineRenderer({
      texture: AdvancedLineRenderer.getWhiteTexture(),
      tint: color,
      leftWidth: thickness,
      rightWidth: 0,
      alpha: 1,
      closed: true,
      closedU: 0.5,
      name: label,
    }).draw(parent, this.roundedRectPoints(x, y, width, height, radius));
  }
  roundedRectPoints(x, y, width, height, radius) {
    const points = [];
    const arc = (centerX, centerY, from, to) => {
      for (let index = 0; index <= 4; index++) {
        const angle = from + ((to - from) * index) / 4;
        points.push(
          new PIXI.Point(
            centerX + Math.cos(angle) * radius,
            centerY + Math.sin(angle) * radius,
          ),
        );
      }
    };
    arc(x + width - radius, y + radius, -Math.PI / 2, 0);
    arc(x + width - radius, y + height - radius, 0, Math.PI / 2);
    arc(x + radius, y + height - radius, Math.PI / 2, Math.PI);
    arc(x + radius, y + radius, Math.PI, Math.PI * 1.5);
    return points;
  }
  drawFooter() {
    const author = new PIXI.Text({
      text: "PhysTrix (c) 2026 PeterSvP",
      style: {
        fontFamily: "Quantico",
        fontSize: 12,
        fontWeight: "bold",
        fill: COLORS.HUD_LABEL,
      },
    });
    const legal = new PIXI.Text({
      text: "Unofficial fan game. Tetris is a trademark of The Tetris Company.",
      style: {
        fontFamily: "Quantico",
        fontSize: 10,
        fill: COLORS.HUD_BUTTON_LABEL,
      },
    });
    const y =
      this.viewportHeight() -
      START_MENU_FOOTER_BOTTOM_PADDING -
      START_MENU_FOOTER_HEIGHT;
    author.anchor.set(0.5);
    legal.anchor.set(0.5);
    author.position.set(this.viewportWidth() / 2, y);
    legal.position.set(this.viewportWidth() / 2, y + 20);
    this.root.addChild(author, legal);
  }
  handleKey(event) {
    const activeItem = this.stack.activeMenu?.focusedItem;
    if (
      this.stack.activeMenu?.id === "numericMenu" &&
      activeItem?.held &&
      (/^\d$/.test(event.key) || event.key === "Backspace")
    ) {
      event.preventDefault();
      this.stack.textInput(event.key, "keyboard");
      return;
    }
    const direction = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    }[event.key];
    if (direction) {
      event.preventDefault();
      this.stack.navigate(direction, "keyboard");
      return;
    }
    if (event.key === "z" || event.key === "x") {
      event.preventDefault();
      this.stack.trigger("keyboard");
    } else if (event.key === " ") {
      event.preventDefault();
      // Space activates the focused Level / Trash widget for held left/right
      // editing. It must never advance that section into the action menu.
      if (
        this.stack.activeMenu?.id === "numericMenu" ||
        this.stack.activeMenu?.id === "actionMenu"
      )
        this.stack.trigger("keyboard");
      else this.stack.advance();
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.start();
    }
  }
  handleGamepad() {
    const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
    if (!pad) return;
    const previous = this.previousGamepadButtons || [];
    const edge = (index) => !!pad.buttons[index]?.pressed && !previous[index];
    if (edge(GAMEPAD_BUTTON.DPAD_UP)) this.stack.navigate("up", "gamepad");
    else if (edge(GAMEPAD_BUTTON.DPAD_DOWN)) this.stack.navigate("down", "gamepad");
    else if (edge(GAMEPAD_BUTTON.DPAD_LEFT)) this.stack.navigate("left", "gamepad");
    else if (edge(GAMEPAD_BUTTON.DPAD_RIGHT)) this.stack.navigate("right", "gamepad");
    else if (edge(GAMEPAD_BUTTON.A)) this.stack.trigger("gamepad");
    else if (edge(GAMEPAD_BUTTON.B)) this.stack.moveActive(-1);
    else if (edge(GAMEPAD_BUTTON.START)) this.start();
    this.previousGamepadButtons = pad.buttons.map((button) => !!button.pressed);
  }
  start() {
    this.onStart({
      playerMode: "1p",
      gameplayMode: this.physicsPreset === "static" ? "classic" : "physics",
      physicsPreset: this.physicsPreset,
      polyominoPreset: this.polyominoPreset,
      skin: this.skin,
      startLevel: this.level,
      trash: this.trash,
    });
  }
  destroy() {
    this.destroyed = true;
    removeEventListener("resize", this.resize);
    removeEventListener("keydown", this.keydown);
    this.app.ticker.remove(this.pollGamepad);
    this.skinPreviews.forEach((texture) => texture.destroy(true));
    this.skinPreviews.clear();
    this.root.destroy({ children: true });
  }
  async buildSkinPreviews() {
    for (const skin of MINO_SKINS) {
      try {
        const response = await fetch(
          `./minoskins/${encodeURIComponent(skin.file)}`,
        );
        if (!response.ok) continue;
        loadSkin(await response.json());
        this.skinPreviews.set(skin.file, this.renderSkinPreview(skin.color));
      } catch {
        /* Missing skins keep a procedural fallback. */
      }
    }
    if (this.destroyed) return;
    this.onSkinSelect?.(this.skin);
    this.itemGroups.flat().forEach((item) => item.refresh());
  }
  renderSkinPreview(color) {
    const texture = PIXI.RenderTexture.create({
      width: 40,
      height: 40,
      resolution: 2,
    });
    const preview = new PIXI.Container();
    new MinoQuadRenderer().draw(preview, [{ x: 0, y: 0 }], color, () => ({
      top: false,
      right: false,
      bottom: false,
      left: false,
      topLeft: false,
      topRight: false,
      bottomRight: false,
      bottomLeft: false,
    }));
    preview.position.set(5, 5);
    this.app.renderer.render({
      container: preview,
      target: texture,
      clear: true,
    });
    preview.destroy({ children: true });
    return texture;
  }
}
