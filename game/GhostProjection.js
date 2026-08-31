/**
 * Calculates the ghost projection for the active falling polyomino.
 * The board supplies its current collision test for every candidate row.
 * This keeps classic mode matrix-based and physics mode point-cast based.
 * The function returns cells only and never changes the active polyomino.
 * Rendering is intentionally handled by the board renderer.
 */

export function projectGhost(piece, board) {
  let y = piece.y;
  while (board.isValid(piece.cells(piece.matrix, piece.x, y + 1))) y++;
  return piece.cells(piece.matrix, piece.x, y);
}
