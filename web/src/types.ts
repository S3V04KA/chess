export type Classification = 'brilliant' | 'great' | 'best' | 'excellent' | 'good' | 'book' | 'forced' | 'inaccuracy' | 'mistake' | 'blunder' | 'miss';

export const CLASSIFICATIONS: Classification[] = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'blunder', 'miss',
];

export type Difficulty = 'kid' | 'beginner' | 'easy' | 'medium' | 'hard' | 'master' | 'stockfish';

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';

export interface AnalyzedMove {
  ply: number;
  san: string;
  uci: string;
  fen_before: string;
  fen_after: string;
  eval_before_cp: number | null;
  eval_after_cp: number | null;
  // Mate-in-N (white perspective). Present on v7+ analyses; older cached
  // analyses are re-run on view because SCORING_VERSION changed.
  mate_before?: number | null;
  mate_after?: number | null;
  best_move_uci: string | null;
  best_move_san: string | null;
  best_pv: string[];
  centipawn_loss: number;
  classification: Classification;
}

export interface PhasePoint {
  from_ply: number;
  to_ply: number;
  accuracy_white: number;
  accuracy_black: number;
  acpl_white: number;
  acpl_black: number;
}

export interface PhaseSplit {
  opening: PhasePoint | null;
  middlegame: PhasePoint | null;
  endgame: PhasePoint | null;
}

export interface KeyMomentSummary {
  ply: number;
  side: 'white' | 'black';
  san: string;
  fen_before: string;
  classification: Classification;
  cp_loss: number;
  win_pct_delta: number;
  best_san: string | null;
  best_pv: string[];
}

export interface AnalysisResult {
  depth: number;
  moves: AnalyzedMove[];
  accuracy_white: number;
  accuracy_black: number;
  estimated_elo_white: number | null;
  estimated_elo_black: number | null;
  performance_white: number | null;
  performance_black: number | null;
  opening_eco: string | null;
  opening_name: string | null;
  key_moments: KeyMomentSummary[];
  phase_split: PhaseSplit | null;
}

export interface GameRow {
  id: number;
  source: 'chesscom' | 'lichess' | 'played' | 'imported' | 'pvp' | 'tournament';
  external_id: string | null;
  white: string;
  black: string;
  result: string;
  time_control: string;
  time_class: TimeClass | null;
  eco: string | null;
  opening_name: string | null;
  rated: number | null;
  user_rating_after: number | null;
  opponent_rating_after: number | null;
  end_time: string;
  user_color: 'white' | 'black' | null;
  analyzed: number;
  accuracy_white: number | null;
  accuracy_black: number | null;
  performance_white: number | null;
  performance_black: number | null;
  bookmarked: number | null;
  notes: string | null;
  /** 1 for a game played from a position (Game Review / Lab → "Play from here"). */
  from_position?: number;
}

export interface RatingRow {
  time_class: TimeClass;
  rating: number;
  rd: number;
  games_played: number;
  last_played_at: string | null;
  provisional: boolean;
}

// ---- Tournaments ----

export type TournamentStatus = 'open' | 'running' | 'paused' | 'finished' | 'cancelled';

export interface TournamentSummary {
  id: number;
  code: string;
  name: string;
  description: string | null;
  status: TournamentStatus;
  time_control: string;
  bot_difficulty: string;
  participants: number;
  created_at: string;
  approved_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  winner_user_id: number | null;
  /** Present on the admin list: the link to share. */
  link?: string;
  /** Present on the player list: whether the caller is in it. */
  joined?: boolean;
}

export interface TournamentPlayer {
  user_id: number;
  display_name: string;
  avatar_emoji: string;
  username: string;
  seed: number;
  points: number;
  status: 'joined' | 'eliminated' | 'champion';
}

export interface MatchSide {
  user_id: number | null;
  display_name: string;
  avatar_emoji: string;
  is_bot: boolean;
}

export interface TournamentMatch {
  id: number;
  round: number;
  position: number;
  white: MatchSide | null;
  black: MatchSide | null;
  result: '1-0' | '0-1' | '1/2-1/2' | null;
  status: 'pending' | 'active' | 'finished';
  is_bot_match: boolean;
  /** The caller's own game row, when the game exists. */
  game_id: number | null;
  my_color: 'white' | 'black' | null;
}

export interface TournamentRound {
  round: number;
  matches: TournamentMatch[];
}

export interface TournamentDetail {
  tournament: TournamentSummary;
  players: TournamentPlayer[];
  rounds: TournamentRound[];
  my_matches: TournamentMatch[];
}
