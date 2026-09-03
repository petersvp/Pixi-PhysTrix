/**
 * Stores the current player mode and gameplay mode selection.
 *
 * This module is part of the app layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

export class Session {
  constructor({
    playerMode,
    gameplayMode,
    physicsPreset = "balanced",
    polyominoPreset = "tetrominoes",
    skin = "skin-soft.json",
    skinBaseUrl = "minoskins",
    startLevel = 0,
    trash = 0,
  }) {
    this.playerMode = playerMode;
    this.gameplayMode = gameplayMode;
    this.physicsPreset = physicsPreset;
    this.polyominoPreset = polyominoPreset;
    this.skin = skin;
    this.skinBaseUrl = skinBaseUrl;
    this.startLevel = startLevel;
    this.trash = trash;
  }
}
