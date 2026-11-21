#!/bin/bash
set -eu
# Render attaches the disk to a single instance. Keep both writers on it.
python scheduled_worker.py &
worker_pid=$!
python ingest_service.py --host 0.0.0.0 --port "${PORT:-8787}" &
api_pid=$!
stop_children() {
  kill "$worker_pid" "$api_pid" 2>/dev/null || true
  wait "$worker_pid" "$api_pid" 2>/dev/null || true
}
trap stop_children EXIT
trap 'exit 0' TERM INT
wait -n "$worker_pid" "$api_pid"
exit 1
