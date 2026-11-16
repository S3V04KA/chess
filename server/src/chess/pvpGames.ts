// Shared PvP plumbing used by both the challenge-accept route and the
// in-game rematch: creating the paired `games` rows (one per player).

import { db } from '../db.js';
import { classifyTimeControl, normaliseTimeControl } from './timeClass.js';

export interface GamePairArgs {
  externalId: string;
  whiteUserId: number;
  blackUserId: number;
  whiteName: string;
  blackName: string;
  /** Preset keyword or "<base>+<inc>" string; normalised before storing. */
  timeControl: string;
  /**
   * Whether the game counts for the Glicko rating. Defaults to "yes for a
   * timed game"; a tournament passes `false` — its games keep their own
   * score and must not move anybody's rating.
   */
  rated?: boolean;
  /** 'pvp' (default) or 'tournament' — the latter only marks the row. */
  source?: 'pvp' | 'tournament';
  /** The tournament match this game belongs to, when it is one. */
  tournamentMatchId?: number | null;
}

export interface GamePair {
  externalId: string;
  whiteGameId: number;
  blackGameId: number;
  timeControl: string;
  timeClass: string | null;
  rated: boolean;
}

/** Insert the two `games` rows for a PvP game. Each player gets their own row
 *  (own id, own user_id) — the play socket looks a game up by
 *  `WHERE id = ? AND user_id = ?`, so each side must be handed *their* id. */
export function createPvpGamePair(args: GamePairArgs): GamePair {
  // Normalise keywords to a real "<base>+<inc>" seconds string so post-game
  // classification (and chess.com-style time_class) is unambiguous, and so
  // the play socket can rebuild the clocks from the row (resolveTimeControl).
  const tcString = normaliseTimeControl(args.timeControl);
  const tcClass = classifyTimeControl(tcString);
  const rated = args.rated !== undefined ? (args.rated ? 1 : 0) : (tcClass ? 1 : 0);
  const source = args.source ?? 'pvp';

  const insert = db.prepare(`
    INSERT INTO games (user_id, source, external_id, pgn, white, black, result, time_control, end_time, user_color, opponent_user_id, rated, time_class, tournament_match_id)
    VALUES (?, ?, ?, '', ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?)
  `);
  const rWhite = insert.run(args.whiteUserId, source, args.externalId, args.whiteName, args.blackName, tcString, 'white', args.blackUserId, rated, tcClass, args.tournamentMatchId ?? null);
  const rBlack = insert.run(args.blackUserId, source, args.externalId, args.whiteName, args.blackName, tcString, 'black', args.whiteUserId, rated, tcClass, args.tournamentMatchId ?? null);
  return {
    externalId: args.externalId,
    whiteGameId: Number(rWhite.lastInsertRowid),
    blackGameId: Number(rBlack.lastInsertRowid),
    timeControl: tcString,
    timeClass: tcClass,
    rated: rated === 1,
  };
}
