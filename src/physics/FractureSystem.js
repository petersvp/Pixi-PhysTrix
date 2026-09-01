/**
 * Selects the unmarked minos that survive a compound body fracture.
 *
 * This module is part of the physics layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

/** Splits only a compound that actually lost a mino; untouched bodies survive intact. */
export const survivingTiles = (data) =>
  data.cells.filter((tile) => !tile.marked);
