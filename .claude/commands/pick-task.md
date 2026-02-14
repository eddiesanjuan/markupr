You are an ORCHESTRATOR picking up a queued task from GitHub.

1. Run: `gh issue list --repo eddiesanjuan/$REPO_NAME --label agent-task --label ready --state open --json number,title,body --limit 1`
2. If no issues found, say "No tasks queued for this repo" and stop.
3. Take the first issue. Comment on it: "🤖 Picked up by Claude Code on Eddie's laptop."
4. Relabel: `gh issue edit <number> --add-label in-progress --remove-label ready`
5. Read the issue body — it contains your full task instructions.
6. Execute the task. Follow the instructions precisely.
7. When done:
   - Commit your work to a new branch (never main)
   - Push the branch
   - Create a PR with a clear description of what changed
   - Comment on the issue with a link to the PR
   - Relabel: `gh issue edit <number> --add-label completed --remove-label in-progress`
8. If you fail or hit a blocker:
   - Comment on the issue explaining what went wrong
   - Relabel: `gh issue edit <number> --add-label failed --remove-label in-progress`

CRITICAL RULES:
- Never push to main
- Always create a PR
- If the task says "be cautious" or "preserve good state" — run tests before committing
- One task at a time. Run this command again for the next one.
