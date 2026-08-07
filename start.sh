#!/usr/bin/env bash
# start.sh — Start the poems server
cd "$(dirname "$0")"
node server.js &
PID=$!
echo "Server running on http://localhost:8920 (PID $PID)"
wait $PID
