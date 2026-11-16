import { describe, expect, it } from 'vitest';
import { playedMoveArrow, type GamePuzzle } from './gamePuzzle';

// Black to move in your game: you played Qd6, the engine wanted Qxd2+.
const puzzle: GamePuzzle = {
  game_id: 7, ply: 24, fen: '3r2k1/5ppp/5q2/8/8/8/3Q1PPP/3R2K1 b - - 0 12', side_to_move: 'black',
  played_san: 'Qd6', played_uci: 'f6d6', best_san: 'Qxf2+', best_uci: 'f6f2', best_pv: ['Qxf2+', 'Kh1', 'Qxd2'],
  line: ['f6f2'], line_san: ['Qxf2+'], classification: 'blunder', centipawn_loss: 420,
  eval_before_cp: -300, eval_after_cp: 120, end_time: null, white: 'Bot', black: 'me', review: false,
};

describe('the move you played, on the board', () => {
  it('is a red arrow on the puzzle position, so you need not work out which move it was', () => {
    expect(playedMoveArrow(puzzle, true)).toEqual({ orig: 'f6', dest: 'd6', brush: 'red' });
  });

  it('is gone once the board shows anything else', () => {
    expect(playedMoveArrow(puzzle, false)).toBeNull();
  });
});
