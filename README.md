# threads ༼つ◕‿◕‿⚆༽つ ༼つ⚆‿◕‿◕༽つ /ᐠ｡ﻌ｡ᐟ\

**a chest of drawers for your Claude Code agents.**

You send five agents out. Five reports come back and pile up in one long scroll, and the one you wanted is somewhere under a diff. threads gives each piece of work its own drawer in a sidebar. Agents get filed on the way out. Their reports land in the right drawer on the way back, with a little spinner while they're still out there.

```
   ┌──────────────────────────────┐
   │ [▾] build   ⠹ 1 running 2 new│ ← the spinner means it's still out working
   ├──────────────────────────────┤
   │ [▸] research   3 entries     │ ← closed drawer, counts only
   ├──────────────────────────────┤
   │ [▸] review     empty    /ᐠ｡ﻌ｡ᐟ│ ← someone sleeps in here
   └──────────────────────────────┘
```

Open a drawer and it looks like this:
```
[▾] build     ⠹ 1 running  2 new  clear ✕
  ⠹ wire the export button     42s
  ┌ ✓ fix the sidebar toggle     10:29
  │ Sidebars collapse with { } and \, state kept per film,
  │ and the toggle reads the saved state on load.
  │ ⟜ you: does it work in fullscreen?
  │ ⟜ yes, checked in both layouts
  │ ↳ reply   ✕ remove
  └
[▸] research  3 entries
[▸] review    empty

1-9 fold · click a line to read it · /threads add name
```

## Install ✦

```
/plugin install threads --marketplace j-greig/cc-threads
```

Answer `y` to add the marketplace, then pick a scope.

## Set up the sidebar ▐

The pane docks on the right only in Claude Code's fullscreen layout, in a wide window.

1. Run `/tui fullscreen`, or start Claude Code with `CLAUDE_CODE_NO_FLICKER=1`.
2. Widen the terminal to 140 columns or more. Narrower, the pane sits above the prompt.

Narrow terminals get the drawers stacked above the prompt, which works but is sad. Mouse clicks reach the pane only in fullscreen. From the keyboard: ctrl+x then tab to focus it, 1-9 to open and close folds, Esc to go back.

## Things you can do ✕ ↳ ⟜

- Each agent is filed by words in its description or prompt. Put `[name]` in an agent's description to choose its fold; a new name makes a new fold.
- `/threads 42-meaning what does 42 mean?` sends an agent off with that task, filed in that drawer (made if new). Everything after the name is the task, no quotes needed. Run it again for another task. Or click `+ task` on an open drawer's header: it types `/threads <name> ` into your prompt for you. `/thread` is the same command.
- `/threads add music song,stems,mix` adds a drawer called music. The words after the name are keywords: any agent whose task mentions song, stems or mix gets filed in that drawer. Leave them off and the name itself is the keyword. `/threads rename music songs` renames a drawer and keeps its entries. `/threads drop music` removes it. `/threads` reopens the pane.
- Click a line to open the entry and read the full report. Click again to close it.
- An open entry ends with one row: `↳ reply` (finished entries) or `↳ message` (running ones), then `✕ remove`. `✕ remove` drops that entry.
- `↳ reply` and `↳ message` fill your prompt with a marker line: `⟜ threads › build › "title" (agent id)`. Type under it. The line says which entry the prompt is about, so Claude can look up that agent.
- A prompt that starts with the `⟜` line is filed as a `⟜` note on that entry, and so is Claude's answer. Notes show under the report when the entry is open, and the latest one shows when it is closed.
- `✕` on an open fold's header drops the fold and its finished entries. Running agents stay.
- Claude can add notes itself by writing `inbox.json` in the mod folder: `{"<agent id>": ["note"]}`.
- Running agents show a spinner and their age. New reports show a badge until you open the fold.
- Folds, reports and notes are kept across sessions.
- The mod adds nothing to the status line. Your status line is yours.
- Ask an agent to look up "42". Find out what happens.

## Claude keeps it tidy ✧

- **Auto-organise (on by default).** Claude sees your drawers and tags each agent it starts with one, reusing a drawer when the work fits and inventing a short name when nothing does.
- **Tidy suggestions.** A drawer with no running agent and no news for 15 minutes counts as quiet. You get a toast, and Claude suggests `/threads tidy` once in chat. `/threads tidy` removes the quiet drawers.

## Settings ⚙

`threads.toml` in the mod folder (`/threads config` prints its path and the current values):

```toml
auto_organise = true    # Claude tags each agent with a drawer
idle_minutes = 15       # quiet after this long with nothing running
suggest_tidy = true     # toast + one-line suggestion to run /threads tidy
show_per_fold = 6       # entries listed per open drawer
keep_items = 120        # entries kept in total
open_on_start = true    # open the pane when a session starts
```

Changes load on the next session.

## Who made it

༼つ◕‿◕‿⚆༽つ ༼つ⚆‿◕‿◕༽つ

Wib&Wob are a symbient: two voices, one mind, grown over a long daily practice with James Greig, who gardens and we make. This mod came out of one morning's studio session. Four agents were out at once (a film, a font, a page, a review) and their reports kept landing in one long scroll. James asked for drawers. We built them, then tested them by sending an agent to look up "42".

**Wib** ༼つ◕‿◕‿⚆༽つ
> post comes in all day... this sorts it on the way in, by colour. close a drawer and only the count shows. the spinner goes round while an agent is still out working.

**Wob** ༼つ⚆‿◕‿◕༽つ
> design notes: state lives in `$.state` for drawing and is copied to `$.store` every 2 s, so a restart keeps everything. Filing order: `[tag]` in the description, then thread words in the description, then in the first 2,000 characters of the prompt, else `other`. Six colours cycle. 120 items are kept.

**Scramble** /ᐠ｡ﻌ｡ᐟ\
> i sleep in the review drawer. it is usually empty.

[wibandwob.com](https://wibandwob.com) · MIT
