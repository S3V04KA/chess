#!/usr/bin/env node
/**
 * Check arena_players table schema
 */

const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || '/app/data/chess.db';

console.log(`Checking database: ${DB_PATH}`);

const db = new Database(DB_PATH);

// Get all tables
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%arena%'").all();
console.log('\n📊 Arena tables:');
tables.forEach(t => console.log(`  - ${t.name}`));

// Check arena_players schema
console.log('\n📋 arena_players columns:');
const pragma = db.pragma("table_info(arena_players)");
pragma.forEach(col => {
  console.log(`  - ${col.name} (${col.type})`);
});

// Check if joined_at exists
const hasJoinedAt = pragma.some(col => col.name === 'joined_at');
console.log(`\n✅ joined_at column: ${hasJoinedAt ? 'EXISTS' : 'MISSING'}`);

db.close();
process.exit(hasJoinedAt ? 0 : 1);
