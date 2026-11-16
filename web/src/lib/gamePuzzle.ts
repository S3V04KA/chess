// Train → "From your games": a puzzle is a position from one of your games
// where you played a weaker move than the engine's (server/src/routes/train.ts).

export interface GamePuzzle {
  game_id: number;
  ply: number;
  fen: string;
  side_to_move: 'white' | 'black';
  played_san: string;
  played_uci: string;
  best_san: string;
  best_uci: string;
  best_pv: string[];
  /** The solution: your move, their reply, your move … (UCI / SAN). */
  line: string[];
  line_san: string[];
  classification: string;
  centipawn_loss: number;
  eval_before_cp: number | null;
  eval_after_cp: number | null;
  end_time: string | null;
  white: string;
  black: string;
  /** Tried before and not solved: back for review. */
  review: boolean;
}

/** The move you played in the game, as a red arrow — only while the board
 *  shows the puzzle position itself, where that move was made. */
export function playedMoveArrow(p: GamePuzzle, atStart: boolean): { orig: string; dest: string; brush: 'red' } | null {
  if (!atStart || p.played_uci.length < 4) return null;
  return { orig: p.played_uci.slice(0, 2), dest: p.played_uci.slice(2, 4), brush: 'red' };
}
