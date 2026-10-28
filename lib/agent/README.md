# lib/agent: adaptive agents

Side project from `plans/06-adaptive-agent.md`. Pure TypeScript, no DOM, no UI yet. It reads `lib/engine`, `lib/poker` and `lib/bots` and changes none of them.

| Folder | What it is |
|---|---|
| `read/` | The Reader (Phase A): a model per opponent from finished hands. Situation stats with credible intervals, plain-English reads, and the closest of the six bot styles. See `read/README.md`. |
| `learn/` | push/fold Learner (Phase C1), see `learn/README.md` |
