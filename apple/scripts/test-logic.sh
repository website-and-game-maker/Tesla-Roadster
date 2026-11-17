#!/bin/sh
# Compiles the shared mini-game rules with their autopilot tests and runs them.
# Works on a Mac (Xcode) or Linux (swift.org toolchain).
set -e
APPLE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/roadster-hop-tests"
swiftc -O "$APPLE/Shared/HopCore.swift" "$APPLE/Tests/main.swift" -o "$OUT"
"$OUT"
