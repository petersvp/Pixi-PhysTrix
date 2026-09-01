/**
 * Reads and writes player and gameplay mode launch parameters.
 *
 * This module is part of the app layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

import { MINO_SKINS } from "../config/skinCatalog.js";
import { MAX_TRASH_LEVEL } from "../config/trashConstants.js";
import { GAMEPLAY_MODES, PLAYER_MODES } from "../shared/constants.js";

const skinFileByLabel = Object.fromEntries(
  MINO_SKINS.map((skin) => [skin.label.toLowerCase(), skin.file]),
);
const skinLabelByFile = Object.fromEntries(
  MINO_SKINS.map((skin) => [skin.file, skin.label]),
);
const resolveSkinName = (value, fallback = "skin-default.json") => {
  if (!value) return fallback;
  const raw = String(value).trim();
  const labelMatch = skinFileByLabel[raw.toLowerCase()];
  if (labelMatch) return labelMatch;
  const legacyByFile = {
    "skin-default.json": "skin-default.json",
    "skin-chisel2.json": "skin-chisel.json",
    "skin-tengen-style.json": "skin-chisel.json",
    "skin-chisel-rounded.json": "skin-default.json",
    "skin-chisel-hard.json": "skin-chisel.json",
    "skin-soft.json": "skin-soft.json",
    "skin-flat1.json": "skin-flat1.json",
  };
  if (legacyByFile[raw]) return legacyByFile[raw];
  return fallback;
};

const parseHashRoute = (hash = window.location.hash) => {
  const raw = hash.replace(/^#/, "");
  const [scene = "menu", query = ""] = raw.split("?");
  return { scene: scene || "menu", params: new URLSearchParams(query) };
};

export function readLaunchParameters(hash = window.location.hash) {
  const { params } = parseHashRoute(hash);
  const playerMode = params.get("playerMode") || "1p";
  const gameplayMode = params.get("gameplayMode") || "classic";
  const physicsPreset = params.get("physicsPreset") || "balanced";
  const polyominoPreset = params.get("polyominoPreset") || "tetrominoes";
  const skin = resolveSkinName(params.get("skin"), "skin-default.json");
  // The menu intentionally offers 0 through 15, while room links may launch
  // any non-negative start level for high-gravity challenge rules.
  const startLevel = Math.max(
    0,
    Number.parseInt(params.get("startLevel"), 10) || 0,
  );
  const trash = Math.max(
    0,
    Math.min(MAX_TRASH_LEVEL, Number.parseInt(params.get("trash"), 10) || 0),
  );
  return {
    playerMode: PLAYER_MODES.includes(playerMode) ? playerMode : "1p",
    gameplayMode: GAMEPLAY_MODES.includes(gameplayMode)
      ? gameplayMode
      : "classic",
    physicsPreset: ["balanced", "slippery", "rubber", "static"].includes(
      physicsPreset,
    )
      ? physicsPreset
      : "balanced",
    polyominoPreset: [
      "tetrominoes",
      "pentominoes",
      "tetra-penta",
      "hard",
      "1x10",
      "4x4",
      "cubes",
    ].includes(polyominoPreset)
      ? polyominoPreset
      : "tetrominoes",
    skin,
    startLevel,
    trash,
  };
}

// A routed launch skips the Pixi start menu and opens a requested session.
export function hasLaunchParameters(hash = window.location.hash) {
  const { scene } = parseHashRoute(hash);
  return scene === "game";
}

export function writeLaunchParameters({
  playerMode,
  gameplayMode,
  physicsPreset = "balanced",
  polyominoPreset = "tetrominoes",
  skin = "skin-default.json",
  startLevel = 0,
  trash = 0,
}) {
  const routedSkin = skinLabelByFile[skin] || skin;
  const params = new URLSearchParams({
    playerMode,
    gameplayMode,
    physicsPreset,
    polyominoPreset,
    skin: routedSkin,
    startLevel: String(startLevel),
    trash: String(trash),
  });
  // Hash routing changes no document request and therefore never reloads the
  // persistent Pixi application canvas.
  history.replaceState(null, "", `#game?${params.toString()}`);
}

export function readScene(hash = window.location.hash) {
  return parseHashRoute(hash).scene === "game" ? "game" : "menu";
}
