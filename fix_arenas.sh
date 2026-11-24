#!/bin/bash
# Script to create arena tables if they don't exist

DB_PATH="${PATZER_DB:-server/db.sqlite}"

echo "Checking database: $DB_PATH"

if [ ! -f "$DB_PATH" ]; then
    echo "Database not found. Please start the server first."
    exit 1
fi

# Check if arenas table exists
TABLE_EXISTS=$(sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name='arenas';")

if [ -z "$TABLE_EXISTS" ]; then
    echo "Creating arenas tables..."
    
    # Create the tables using the SQL file
    sqlite3 "$DB_PATH" < create_arenas_tables.sql
    
    echo "Arenas tables created successfully!"
else
    echo "Arenas table already exists."
fi

# Verify
COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM arenas;")
echo "Current number of arenas: $COUNT"
