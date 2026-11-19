# threads

A Claude Code mod. Background agents report into folds beside the chat, one fold per piece of work, instead of piling into the main scroll.

```
[▾] build     ⠹ 1 running  2 new  clear
  ⠹ wire the export button     42s
  ✓ fix the sidebar toggle     10:29
    Sidebars collapse with { } and \, state kept per film…
[▸] research  3 entries
[▸] review    empty

1-9 fold · click a line to read it · /thread name word,word
```

## Install

```
/plugin install threads --marketplace j-greig/cc-threads
```

Answer `y` to add the marketplace, then pick a scope.

## Set up the sidebar

The pane docks on the right only in Claude Code's fullscreen layout, in a wide window.

1. Run `/tui fullscreen`, or start Claude Code with `CLAUDE_CODE_NO_FLICKER=1`.
2. Widen the terminal to 140 columns or more. Narrower, the pane sits above the prompt.

Mouse clicks reach the pane only in fullscreen. From the keyboard: ctrl+x then tab to focus it, 1-9 to open and close folds, Esc to go back.

## Use

- Each agent is filed by words in its description or prompt. Put `[name]` in an agent's description to choose its fold; a new name makes a new fold.
- `/thread music song,stems,mix` adds a fold with its match words. `/thread drop music` removes it. `/threads` reopens the pane.
- Click a line to read the full report. `↳ reply` starts your prompt with a marker line, `⟜ threads › build › "title" (agent id)`, so the reply says which entry it answers and Claude can look up that agent. `✕ remove` drops the entry.
- `✕` on an open fold's header removes the fold and its finished entries.
- Running agents show a spinner and their age. New reports show a badge until you open the fold. The status line shows the totals.
- Folds and reports are kept across sessions.

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
