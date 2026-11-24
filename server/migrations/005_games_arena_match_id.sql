-- Migration: Add arena_match_id column to games table
-- Links games to arena matches (similar to tournament_match_id)
-- Safe to run on production database - uses ensureColumn pattern

-- Note: This migration is handled by ensureColumn() in db.ts
-- The SQL equivalent would be:
-- ALTER TABLE games ADD COLUMN arena_match_id INTEGER;
