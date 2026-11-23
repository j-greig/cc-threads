
## Making a change live
Sessions load threads as the installed plugin `threads@cc-threads` (GitHub `j-greig/cc-threads`), from `~/.claude/plugins/cache/cc-threads/threads/0.1.0/`. Editing `~/.claude/dev-mods/*/threads/` changes nothing in those sessions. To try a change locally, copy `hooks/register.tsx` into that cache folder and restart the session. To ship it, push to `origin/main` and run `/plugin update threads`.
A change that adds a state key also changes `types/index.d.ts` (the state contract), and a new setting changes `threads.toml`: copy those into the cache folder too.

## Checking a change
- `claude plugin validate .` reads the manifest, the state contract and the hooks module, and fails on a state key the contract does not name.
- `claude plugin test .` runs `tests/*.test.tsx` against the engine with nothing beneath the mod: each test stands in for the engine (the fork, files, the store, the clock) and reads the pane it draws.
- Type-check: `tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which the engine writes only when it loads the mod from this folder (`claude --plugin-dir .`). On a clean clone, write a tsconfig outside the repo with the options from the header of `claude-code.d.ts` (the plugin-authoring skill writes that file when it loads) and an `include` of that file plus this repo's `hooks`, `types` and `tests`, then run `bunx tsc -p <that tsconfig>`.
- The tests do not cover what a terminal paints, `$.model.fork` against a real conversation, or a command typed while a turn is running. Check those in a live session.
