#!/bin/bash
# Apply arena database migrations safely on production server
# This script applies SQL migrations without restarting the server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_PATH="../data/chess.db"

echo "Applying arena database migrations..."
echo "Database: $DB_PATH"

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    echo "Error: Database not found at $DB_PATH"
    exit 1
fi

# Apply each migration in order
for migration in "$SCRIPT_DIR"/0*.sql; do
    if [ -f "$migration" ]; then
        filename=$(basename "$migration")
        echo "Applying: $filename"
        sqlite3 "$DB_PATH" < "$migration"
        echo "✓ Applied: $filename"
    fi
done

echo ""
echo "SQL migrations applied successfully!"
echo ""
echo "Note: For 'paused' and 'arena_match_id' columns, restart the server to apply ensureColumn() migrations."
echo ""
echo "To verify:"
echo "  sqlite3 $DB_PATH \"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%arena%';\""
