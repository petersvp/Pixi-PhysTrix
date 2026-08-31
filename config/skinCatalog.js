/**
 * Lists the built-in mino skin files shown by the start-scene skin picker.
 * The files live in minoskins so they can also be opened and edited directly.
 * Each entry provides a compact menu label and a distinctive preview tint.
 * Loading still reads the JSON file itself rather than duplicating skin data.
 * Add new built-in skins here after placing their JSON alongside the others.
 * The menu deliberately uses this explicit list instead of directory probing.
 */

export const MINO_SKINS = Object.freeze([
  { file: "skin-default.json", label: "DEFAULT", color: 0xffb13c },
  { file: "skin-chisel.json", label: "CHISEL", color: 0xffe35b },
  { file: "skin-soft.json", label: "SOFT", color: 0x38bfff },
  { file: "skin-flat1.json", label: "FLAT", color: 0x7fd1a8 },
]);
