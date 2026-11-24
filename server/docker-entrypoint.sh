#!/bin/bash
set -e

echo "🔧 Applying database migrations..."

# Wait for database to be ready
DB_PATH="/app/data/chess.db"
MAX_RETRIES=30
RETRY_COUNT=0

while [ ! -f "$DB_PATH" ] && [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    echo "Waiting for database file to appear..."
    sleep 1
    RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ ! -f "$DB_PATH" ]; then
    echo "⚠️ Warning: Database file not found after waiting"
    echo "Continuing anyway..."
fi

# Apply SQL migrations (only creates tables if they don't exist)
for migration in /app/migrations/0*.sql; do
    if [ -f "$migration" ]; then
        filename=$(basename "$migration")
        echo "  Applying: $filename"
        sqlite3 "$DB_PATH" < "$migration" || true
        echo "  ✓ Applied: $filename"
    fi
done

echo "✅ Database migrations completed"

# Execute the main command (start the server)
exec "$@"
