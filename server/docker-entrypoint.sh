#!/bin/sh
set -e

echo "🔧 Applying database migrations..."

# Apply migrations using Node.js (better-sqlite3 is already installed)
node /app/migrate.js

# Execute the main command (start the server)
exec "$@"
