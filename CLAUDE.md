
## Making a change live
Sessions load threads as the installed plugin `threads@cc-threads` (GitHub `j-greig/cc-threads`), from `~/.claude/plugins/cache/cc-threads/threads/0.1.0/`. Editing `~/.claude/dev-mods/*/threads/` changes nothing in those sessions. To try a change locally, copy `hooks/register.tsx` into that cache folder and restart the session. To ship it, push to `origin/main` and run `/plugin update threads`.
