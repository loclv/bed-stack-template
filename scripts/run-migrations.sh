#!/bin/bash
# Shell wrapper to execute Bun migrations runner

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
bun run "$DIR/run-migrations.ts"
