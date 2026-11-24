#!/bin/bash
# Sync skills from .agents/skills to all agent folders

echo "=== Start syncing skills... ==="

AGENTS=("agent" "claude" "codex" "cursor" "gemini" "opencode" "qwen" "windsurf")

for dir in "${AGENTS[@]}"; do
  echo "- Syncing .agents/skills/ -> .$dir/skills/"
  rsync -av --delete .agents/skills/ ".$dir/skills/"
done

echo "✅ Sync skills complete!"
