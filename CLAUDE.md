
## Making a change live
Sessions load threads as the installed plugin `threads@cc-threads` (GitHub `j-greig/cc-threads`), from `~/.claude/plugins/cache/cc-threads/threads/0.1.0/`. Editing `~/.claude/dev-mods/*/threads/` changes nothing in those sessions. To try a change locally, copy `hooks/register.tsx` and the files it imports (`hooks/refs.ts`) into that cache folder and restart the session. To ship it, push to `origin/main` and run `/plugin update threads`.
A change that adds a state key also changes `types/index.d.ts` (the state contract), and a new setting changes `threads.toml`: copy those into the cache folder too.

## Checking a change
- `claude plugin validate .` reads the manifest, the state contract and the hooks module, and fails on a state key the contract does not name.
- `claude plugin test .` runs `tests/*.test.tsx` against the engine with nothing beneath the mod: each test stands in for the engine (the fork, files, the store, the clock) and reads the pane it draws.
- Type-check: `tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which the engine writes only when it loads the mod from this folder (`claude --plugin-dir .`). On a clean clone, write a tsconfig outside the repo with the options from the header of `claude-code.d.ts` (the plugin-authoring skill writes that file when it loads) and an `include` of that file plus this repo's `hooks`, `types` and `tests`, then run `bunx tsc -p <that tsconfig>`.
- The tests do not cover what a terminal paints, `$.model.fork` against a real conversation, or a command typed while a turn is running. Check those in a live session.

## Refs (pointing at a pane entry from the prompt)
- `hooks/refs.ts` holds the token format (`‹kind:id›`), the line a button fills, and `resolveRefs(text, kinds)`. It never touches `$`: validate refuses `$` passed to a function held in a table.
- `refKinds($)` in `hooks/register.tsx` is the one table of kinds. To make a new kind pointable (a report, a chat-filed entry, a drawer): add its lookup there and a button that fills `refLine(kind, id, label)`. The `prompt.submit` hook and the sidecar fork already resolve every kind in the table.
- Run tests from a shell inside a Claude Code session with a clean environment, or the test kit reports hooks modules as turned off: `env -i HOME=$HOME PATH=$PATH USER=$USER claude plugin test .`
