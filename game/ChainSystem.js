/**
 * Converts a chain length into its display label.
 *
 * This module is part of the game layer of PhysTrix.
 * Its exports are consumed by the modular application runtime.
 */

const lineClearNames = [
  "",
  "SINGLE",
  "DOUBLE",
  "TRIPLE",
  "PHYSTRIX",
  "PENTARIX",
  "HEXARIX",
  "HEPTARIX",
  "OCTARIX",
  "NONARIX",
  "MEGATRIX", // 10
  "MEGATRIX", // 11
  "MEGATRIX", // 12
  "FATALIX", // 13
  "LEGENDRIX", // 14
  "LEGENDRIX", // 15
  "LEGENDRIX", // 16
  "LEGENDRIX", // 17
  "IMPOSTRIX", // 18
  "IMPOSTRIX", // 19
  "IMPOSTRIX", // 20
];
export const chainName = (count) =>
  lineClearNames[Math.min(20, count)] || `${count} CHAIN`;
