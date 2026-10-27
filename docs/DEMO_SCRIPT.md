# SHIMI demo walkthrough (recording script, not a completed live-agent benchmark)

Use two independent, real AI coding clients sharing one **throwaway** Git worktree. Pick a small, reproducible JS/TS task with passing tests.

1. `shimi setup --dry-run && shimi setup`
2. Ask coding agent A to make a partial code change, document next steps in `.ai/AI_TASK.md`, and use SHIMI session capture for a meaningful decision.
3. Stop agent A without pasting its conversation transcript to agent B.
4. Run `shimi switch` yourself in the terminal.
5. Open coding agent B at the same worktree and explicitly run `shimi continue`.
6. Ask agent B to summarize the remaining tasks and identify files changed **before** doing any edits. Check against Git and the real `.ai/` state.
7. Finish the work and compare the passed tests to a no-SHIMI baseline.

**Do not present this as a verified two-agent result until it has actually been recorded and checked.** For now it is a planned reproducible demo.
