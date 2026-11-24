#!/usr/bin/env node
/**
 * Database migration runner for arena tables
 * Used by docker-entrypoint.sh to apply migrations before starting the server
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || '/app/data/chess.db';
const MIGRATIONS_DIR = '/app/migrations';

console.log(`🔧 Applying database migrations...`);
console.log(`   Database: ${DB_PATH}`);

// Wait for database file to be created
let db;
let retries = 30;
while (!db && retries > 0) {
  try {
    db = new Database(DB_PATH);
    console.log(`   ✓ Database connected`);
  } catch (err) {
    retries--;
    if (retries === 0) {
      console.warn(`⚠️ Warning: Could not connect to database after ${30} attempts`);
      process.exit(0); // Don't fail, migrations are optional
    }
    console.log(`   Waiting for database... (${retries} attempts left)`);
    require('fs').existsSync(DB_PATH) ? null : require('fs').mkdirSync(require('path').dirname(DB_PATH), { recursive: true });
    require('fs').writeFileSync(DB_PATH, '');
  }
}

if (!db) {
  console.warn(`⚠️ Skipping migrations - database unavailable`);
  process.exit(0);
}

// Apply each migration file in order
const migrationFiles = [
  '001_arena_players.sql',
  '002_arena_matches.sql',
  '003_arena_pauses.sql',
];

for (const filename of migrationFiles) {
  const filepath = resolve(MIGRATIONS_DIR, filename);
  try {
    const sql = readFileSync(filepath, 'utf8');
    console.log(`   Applying: ${filename}`);
    db.exec(sql);
    console.log(`   ✓ Applied: ${filename}`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`   ⏭️  Skipped: ${filename} (file not found)`);
    } else {
      console.warn(`   ✗ Error applying ${filename}:`, err.message);
    }
  }
}

// Close database
db.close();

console.log(`✅ Database migrations completed`);
process.exit(0);
