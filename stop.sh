#!/usr/bin/env bash
# stop.sh — Stop the poems server
pkill -f "node server.js" && echo "Server stopped" || echo "Server was not running"
