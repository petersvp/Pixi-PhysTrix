/**
 * Defines logical viewport and optional HUD feature settings.
 * These values affect interface composition rather than game simulation.
 * The viewport dimensions are used for Pixi camera fitting and layout math.
 * HUD feature flags construct static panels when the session starts.
 * Visual panel measurements and renderer tuning are centralized here.
 */

export const GAME_VIEWPORT_WIDTH = 900;
export const GAME_VIEWPORT_HEIGHT = 760;
// Persistent gameplay top-bar layout, expressed in renderer screen pixels.
export const TOP_BAR_MARGIN = 16;
export const TOP_BAR_BUTTON_SIZE = 44;

// Settings overlay. These deliberately target Discord's compact Activity
// canvas as well as the normal desktop viewport.
export const SETTINGS_PANEL_WIDTH = 400;
export const SETTINGS_PANEL_HEIGHT = 680;
export const SETTINGS_PANEL_X = 250;
export const SETTINGS_PANEL_Y = 20;
// Interior alignment for the compact Activity settings card. Keep labels,
// slider tracks, and values clear of the glass frame on both sides.
export const SETTINGS_CONTENT_PADDING_X = 24;
export const SETTINGS_SLIDER_LABEL_X = SETTINGS_PANEL_X + SETTINGS_CONTENT_PADDING_X;
export const SETTINGS_SLIDER_TRACK_X = SETTINGS_PANEL_X + 135;
export const SETTINGS_SLIDER_TRACK_WIDTH = 200;
export const SETTINGS_SLIDER_VALUE_X = SETTINGS_PANEL_X + SETTINGS_PANEL_WIDTH - SETTINGS_CONTENT_PADDING_X;
export const SETTINGS_SLIDER_ROW_HEIGHT = 40;
export const SETTINGS_BIND_ROW_HEIGHT = 28;
export const SETTINGS_BIND_BUTTON_WIDTH = 112;
export const SETTINGS_BIND_PAD_BUTTON_WIDTH = 108;
// Portrait gameplay intentionally extends this far beyond each screen edge.
// It prevents a padded desktop-canvas look while preserving the attached rails.
export const PORTRAIT_PLAYFIELD_HORIZONTAL_BLEED = 12;
export const SHOW_GARBAGE_METER = false;
export const SHOW_ITEM_PANEL = false;

// Start menu layout. Portrait uses a two-by-two menu stack and a third action
// row; landscape keeps all primary menu sections in a single horizontal row.
export const START_MENU_VIEWPORT_WIDTH = 900;
export const START_MENU_MOBILE_VIEWPORT_WIDTH = 390;
export const START_MENU_MOBILE_MIN_VIEWPORT_HEIGHT = 870;
export const START_MENU_NARROW_WIDTH = 980;
export const START_MENU_INACTIVE_SECTION_ALPHA = 0.32;
export const START_MENU_TITLE_FONT_SIZE = 19;
export const START_MENU_BUTTON_HEIGHT = 50;
export const START_MENU_BUTTON_GAP = 12;
export const START_MENU_RADIUS = 9;
export const START_MENU_LOGO_TOP_PADDING = 22;
export const START_MENU_LOGO_GLOW_EXTENT = 24;
export const START_MENU_LOGO_FACE_PHYS = 0x153d5b;
export const START_MENU_LOGO_FACE_TRIX = 0x3e4754;
export const START_MENU_FOOTER_BOTTOM_PADDING = 20;
export const START_MENU_FOOTER_HEIGHT = 34;
export const START_MENU_VERTICAL_TOP_ROW_Y = 135;
export const START_MENU_VERTICAL_ROW_GAP = 32;
export const START_MENU_VERTICAL_START_TO_FOOTER_GAP = 16;
export const START_MENU_HORIZONTAL_TOP_ROW_Y = 230;
export const START_MENU_HORIZONTAL_ACTION_ROW_GAP = 128;

// Start-scene motion is intentionally restrained so it does not compete with
// menu navigation or the logo. Ambient polyominoes are created once per scene.
export const START_MENU_SECTION_IN_DURATION_MS = 260;
export const START_MENU_SECTION_OUT_DURATION_MS = 170;
export const START_MENU_SECTION_STAGGER_MS = 55;
export const START_MENU_SECTION_START_SCALE = 0.86;
// Persistent ambient scene background. It is created once by AppShell and
// remains behind every routed scene, including gameplay and modal overlays.
export const AMBIENT_POLYOMINO_COUNT = 20;
export const AMBIENT_POLYOMINO_MIN_SPEED = 12;
export const AMBIENT_POLYOMINO_MAX_SPEED = 28;
export const AMBIENT_POLYOMINO_CELL_SIZE = 32;
export const AMBIENT_POLYOMINO_ALPHA = 0.1;

// Playfield frame and half-particle glow tuning.
export const PLAYFIELD_OUTER_LINE_WIDTH = 10;
export const PLAYFIELD_MAIN_LINE_WIDTH = 8;
export const PLAYFIELD_HIGHLIGHT_LINE_WIDTH = 6;
export const PLAYFIELD_FRAME_EXTENSION = 8;
export const PLAYFIELD_FRAME_Y_OFFSET = -4;
export const PLAYFIELD_OUTER_GLOW_ALPHA = 0.68;
export const PLAYFIELD_OUTER_GLOW_OUTSET = 8;
export const PLAYFIELD_OUTER_GLOW_SPREAD = 16;
export const PLAYFIELD_GLOW_CORNER_RADIUS = 4;
export const PLAYFIELD_GLOW_CURVE_SEGMENTS = 4;
export const PLAYFIELD_GLOW_MIDDLE_U = 0.5;
export const PLAYFIELD_GLOW_CAP_LENGTH = 8;
export const PLAYFIELD_GLOW_DEBUG_POINTS = false;
export const PLAYFIELD_GLOW_DEBUG_POINT_RADIUS = 4;
export const PLAYFIELD_GLOW_DEBUG_POINT_COLOR = 0xffff00;

// One-player HUD panel and preview layout tuning.
export const HUD_SIDE_WIDTH = 128;
export const HUD_PANEL_RADIUS = 14;
export const HUD_PANEL_LINE_WIDTH = 4;
export const HUD_PANEL_GLOW_SPREAD = 7;
export const HUD_PANEL_GLOW_ALPHA = 0.42;
export const HUD_PANEL_CORE_ALPHA = 0.92;
export const HUD_PANEL_PARTICLE_MIDDLE_U = 0.5;

export const HOLD_PANEL_X_OFFSET = 4;
export const HOLD_PANEL_DETACHED_BLOCK_OFFSET = 1;
export const HOLD_PANEL_HEIGHT = 130;
export const HOLD_PREVIEW_SCALE = 0.8;
export const HOLD_PREVIEW_Y = 40;
export const HOLD_PREVIEW_SLOT_BOTTOM = 12;

export const NEXT_PANEL_X_OFFSET = 4;

// When the queue is taller than a short custom playfield, detach it by this
// many rendered board cells and render it as a complete rounded panel.
export const NEXT_PANEL_DETACHED_BLOCK_OFFSET = 1;
export const NEXT_QUEUE_SLOTS = 5;
export const NEXT_PREVIEW_SCALE = 0.76;
export const NEXT_PREVIEW_Y = 50;
export const NEXT_SLOT_SPACING = 68;
export const NEXT_PREVIEW_SLOT_HEIGHT = 58;
export const NEXT_PANEL_BOTTOM_PADDING = 28;
export const PREVIEW_SLOT_INSET = 0;
export const PREVIEW_SLOT_PADDING = 12;

export const HUD_LABEL_FONT_SIZE = 16;
export const HUD_VALUE_FONT_SIZE = 27;
export const HUD_STATS_RIGHT_PADDING = 30;
export const HUD_STATS_Y_OFFSET = 36;
export const HUD_STATS_ROW_SPACING = 78;
export const HUD_STATS_VALUE_Y_OFFSET = 19;
export const HUD_STATS_CONTENT_HEIGHT = 288;

export const ITEM_PANEL_WIDTH = 265;
export const ITEM_PANEL_HEIGHT = 58;
export const ITEM_PANEL_Y_OFFSET = 5;

// Detach the item bar below a narrow field when its fixed width would exceed
// the available playfield width and make a fused bottom join look incorrect.
export const ITEM_PANEL_DETACHED_BLOCK_OFFSET = 0.15;
export const ITEM_SLOT_COUNT = 5;
export const ITEM_SLOT_SIZE = 38;
export const ITEM_SLOT_GAP = 12;
export const ITEM_SLOT_Y = 10;

// Score callout typography. The clear/spin remains the visual focus.
export const CALLOUT_MAIN_FONT_SIZE = 40;
export const CALLOUT_MAJOR_CLEAR_SCALE = 1.18;
export const CALLOUT_PERFECT_CLEAR_SCALE = 1.1;
export const CALLOUT_PERFECT_CLEAR_DURATION_MULTIPLIER = 3;
export const CALLOUT_COMBO_FONT_SIZE = 20;
export const CALLOUT_POINTS_FONT_SIZE = 22;
export const CALLOUT_COMBO_Y_OFFSET = -28;
export const CALLOUT_POINTS_Y_OFFSET = 30;
export const CALLOUT_POP_DURATION_MS = 180;
export const CALLOUT_POP_SCALE = 1.18;

// Start and game-over overlay shadow tuning.
export const START_MESSAGE_SHADOW_DISTANCE = 4;
export const START_MESSAGE_SHADOW_BLUR = 16;
export const START_MESSAGE_SHADOW_ALPHA = 0.8;
export const GAME_OVER_TITLE_SHADOW_DISTANCE = 5;
export const GAME_OVER_TITLE_SHADOW_BLUR = 32;
export const GAME_OVER_TITLE_SHADOW_ALPHA = 0.85;
export const GAME_OVER_SHADOW_PADDING = 48;

// Game-over report panel layout. Rows are generated from the completed game
// summary, so the panel grows only as far as the recorded achievements need.
export const GAME_OVER_PANEL_WIDTH = 308;
export const GAME_OVER_PANEL_PADDING = 28;
export const GAME_OVER_PANEL_MIN_HEIGHT = 280;
export const GAME_OVER_PANEL_ROW_HEIGHT = 25;
export const GAME_OVER_SCORE_FONT_SIZE = 36;
export const GAME_OVER_SCORE_SUFFIX_FONT_SIZE = 16;
export const GAME_OVER_DETAIL_FONT_SIZE = 16;
export const GAME_OVER_ENTER_DURATION_MS = 260;
export const GAME_OVER_ENTER_START_SCALE = 0.86;
export const GAME_OVER_PLAY_AGAIN_WIDTH = 164;
export const GAME_OVER_PLAY_AGAIN_HEIGHT = 46;
export const GAME_OVER_PLAY_AGAIN_GAP = 18;
export const GAME_OVER_RESTART_INPUT_DELAY_MS = 1000;
export const GAME_OVER_BACKDROP_BLUR_STRENGTH = 16;
export const GAME_OVER_BACKDROP_BLUR_QUALITY = 4;
export const GAME_OVER_TEXT_ENTER_DURATION_MS = 220;
export const GAME_OVER_TEXT_ENTER_STAGGER_MS = 42;
export const GAME_OVER_TEXT_ENTER_START_SCALE = 0.78;
export const COUNTDOWN_ENTER_DURATION_MS = 210;
export const COUNTDOWN_ENTER_START_SCALE = 0.45;
