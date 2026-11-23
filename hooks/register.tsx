import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, Register } from 'claude-code'

import type { Item, Sidecar, Thread } from '../types'

// Threads: one fold per piece of work. Each background agent is filed under a thread
// when it starts and its report lands there when it ends, so reports stop piling into the chat.
// Filing: a "[name]" tag in the Agent description wins, then the first thread whose words
// appear in the description or prompt, else "other".
const PANE = 'threads'
const threads = atom({ plugin: 'threads', key: 'threads' } as const, [], { shape: 'threads-1' })
const items = atom({ plugin: 'threads', key: 'items' } as const, [], { shape: 'items-1' })
const open1 = atom({ plugin: 'threads', key: 'open1' } as const, '', { shape: 'open1-1' })
const hintOff = atom({ plugin: 'threads', key: 'hintOff' } as const, false, { shape: 'hintOff-1' })
const adding = atom({ plugin: 'threads', key: 'adding' } as const, false, { shape: 'adding-1' })
const renaming = atom({ plugin: 'threads', key: 'renaming' } as const, '', { shape: 'renaming-1' })
const tick = atom({ plugin: 'threads', key: 'tick' } as const, 0, { shape: 'tick-1' })
const sidecars = atom({ plugin: 'threads', key: 'sidecars' } as const, [], { shape: 'sidecars-1' })
const asking = atom({ plugin: 'threads', key: 'asking' } as const, false, { shape: 'asking-1' })

const DEFAULTS: Thread[] = [
  { name: 'build', words: ['build', 'fix', 'implement', 'refactor'], isOpen: true },
  { name: 'research', words: ['research', 'search', 'find', 'explore', 'docs'], isOpen: true },
  { name: 'review', words: ['review', 'audit', 'test', 'check'], isOpen: false },
]

function pick(list: Thread[], desc: string, prompt: string): string {
  const tag = /\[([\w-]+)\]/.exec(desc)
  if (tag && tag[1]) return tag[1].toLowerCase()
  const d = desc.toLowerCase()
  const p = prompt.slice(0, 2000).toLowerCase()
  for (const t of list) if (t.words.some(w => d.includes(w))) return t.name
  for (const t of list) if (t.words.some(w => p.includes(w))) return t.name
  return 'other'
}

const HUES = ['#e0a050', '#5fafd7', '#87d787', '#d787d7', '#d7d75f', '#5fd7af']
const HINT = '1-9 fold · click a line to read it · /threads add name'
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  return s < 60 ? s + 's' : s < 3600 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h'
}

function dur(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? s + 's' : s < 3600 ? Math.round(s / 60) + 'm' : (s / 3600).toFixed(1) + 'h'
}
const CHAT = (x: Item) => x.report === 'auto-filed from chat' || x.report === 'done in chat'

function hhmm(ms: number): string {
  const d = new Date(ms)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

const URL_RE = /https?:\/\/[^\s<>()\[\]"'`]+[^\s<>()\[\]"'`.,;:!?]/g

// Keep the first 4000 characters, plus every URL the cut would drop, on a last line.
function keepFull(answer: string): string {
  const head = answer.slice(0, 4000)
  const lost = [...new Set(answer.slice(4000).match(URL_RE) || [])].filter(u => !head.includes(u))
  return lost.length ? head + '\n…\nlinks: ' + lost.join(' ') : head
}

function gist(answer: string): string {
  const lines = answer.split('\n').map(s => s.replace(/[*#>`]/g, '').trim()).filter(Boolean)
  return lines.slice(0, 3).join(' ').slice(0, 300)
}


const MARK = /^⟜ threads › .*\(agent ([^)]+)\)\s*\n?([\s\S]*)/
let pending = ''
const addNote = (all: Item[], id: string, note: string) =>
  all.map(x => (x.id === id && !(x.notes || []).includes(note) ? { ...x, notes: [...(x.notes || []), note].slice(-8), seen: false } : x))

type Cfg = { auto_organise: boolean; idle_minutes: number; suggest_tidy: boolean; show_per_fold: number; keep_items: number; open_on_start: boolean; top_buttons_after: number; fold_after_hours: number; status_every_minutes: number; summaries: boolean; auto_file: boolean; keep_sidecars: number }
const CFG0: Cfg = { auto_organise: true, idle_minutes: 15, suggest_tidy: true, show_per_fold: 6, keep_items: 120, open_on_start: true, top_buttons_after: 15, fold_after_hours: 24, status_every_minutes: 5, summaries: true, auto_file: true, keep_sidecars: 20 }
let cfg: Cfg = { ...CFG0 }
// threads.toml: flat "key = value" lines; # comments; unknown keys ignored.
function parseToml(txt: string): Partial<Cfg> {
  const out: Record<string, unknown> = {}
  for (const raw of txt.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    const m = /^([a-z_]+)\s*=\s*(.+)$/.exec(line)
    if (!m || !m[1] || !m[2]) continue
    const v = m[2].trim()
    out[m[1]] = v === 'true' ? true : v === 'false' ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v.replace(/^"|"$/g, '')
  }
  return out as Partial<Cfg>
}
let lastQuiet = ''
const quietOnes = (list: Thread[], all: Item[]) => list.map(t => t.name).filter(name => {
  const mine = all.filter(x => x.thread === name)
  if (!mine.length || mine.some(x => x.status === 'running')) return false
  const last = Math.max(...mine.map(x => x.ended || x.started))
  return Date.now() - last > cfg.idle_minutes * 60000
})

let lastAsk = ''
// Auto-filer: after each main-session turn, haiku reads the request and the answer's start and files the turn
// into a drawer (or a new one for a clearly new ongoing project), adding up to 3 keywords to that drawer.
function autoFile($: EngineInterface, answer: string) {
  if (!cfg.auto_file || lastAsk.trim().length < 12) return
  const ask = lastAsk; lastAsk = ''
  void (async () => {
    try {
      const ts = await read($, threads)
      const xs = await read($, items)
      const list = ts.map(t => '- ' + t.name + ' (' + t.words.join(', ') + '): ' + xs.filter(x => x.thread === t.name).slice(-3).map(x => x.title).join(' | ')).join('\n')
      const res = await $.model.complete({ model: 'haiku', maxTokens: 120, prompt: 'Drawers (name (keywords): recent entries):\n' + list +
        '\n\nUser asked:\n' + ask.slice(0, 1500) + '\n\nAssistant answered (start):\n' + answer.slice(0, 1200) +
        '\n\nFile this turn. Reply with JSON only: {"drawer":"<existing name>","title":"<3-7 word title of the work done>","words":["<up to 3 distinctive keywords>"]} if it plainly matches a drawer; {"drawer":"<new short lowercase name>","new":true,"title":"...","words":[...]} only if it is real work on a clearly new ongoing project; {"drawer":null} for small talk, questions with no work, or doubt.' })
      if (!res.isAnswered) return
      const j = JSON.parse((res.text.match(/\{[\s\S]*\}/) || ['{}'])[0]) as { drawer?: string | null, new?: boolean, title?: string, words?: string[] }
      if (!j.drawer || !j.title) return
      const name = j.drawer.trim().toLowerCase().slice(0, 24), exists = ts.some(t => t.name === name)
      if (!exists && !j.new) return
      const words = (j.words || []).map(w => String(w).toLowerCase().trim()).filter(w => w && w.length < 30).slice(0, 3)
      if (!exists) await update($, threads, l => [...l, { name, words: [name, ...words], isOpen: true }])
      else await update($, threads, l => l.map(t => t.name === name ? { ...t, words: [...new Set([...t.words, ...words])].slice(0, 12) } : t))
      const id = 'log-' + name + '-' + j.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
      if ((await read($, items)).some(x => x.id === id)) return
      const now = Date.now()
      await update($, items, ys => [...ys, { id, thread: name, title: j.title!, status: 'done' as const, started: now, ended: now, report: 'auto-filed from chat', seen: true }].slice(-cfg.keep_items))
      $.ui.toast('threads: ' + (exists ? '' : 'new drawer · ') + name + ' ← ' + j.title)
    } catch { /* filing is best effort */ }
  })()
}

// Sidecars: a side question answered beside the chat, like /btw but kept. /sidecar <question> runs
// $.model.fork: the session's own transcript as the main thread last sent it, plus this one message,
// with every tool denied. The answer is written with everything the session knows, never enters the
// conversation, and lands in the pane's sidecar section. Sidecars stack newest first and fold to one line.
const SIDE_HUE = '#af87ff'
const sidePrompt = (q: string) => 'Side question from the person, asked with /sidecar. Answer it now from what this conversation already holds. ' +
  'You have no tools for this reply: call none, and answer straight away without thinking it over. ' +
  'Lead with the answer and keep it short: a one-line tl;dr, then a few bullets if they help. ' +
  'The reply is shown in a side panel and is never added to the conversation, so do not continue or change the task in progress.\n\nQuestion: ' + q
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s)
let sideSeq = 0
// Answers are short by design; a long one is cut so several open sidecars stay inside what one drawing may hold.
const clip = (s: string) => (s.length > 6000 ? s.slice(0, 6000) + '\n\n… (cut: the answer ran past 6000 characters)' : s)
// A short stable id part, so one question and answer in inbox.json files once however often the file is read.
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}
function whyNot(r: Exclude<ModelForkResult, { isAnswered: true }>): string {
  if (r.reason === 'nothing-to-fork') return 'Nothing to fork yet: this session has not finished a turn since it started (or since /clear). Send any prompt, then press ask again.'
  if (r.reason === 'api-error') return 'The API refused it (' + r.error + (r.status ? ' ' + r.status : '') + '). Press ask again.'
  if (r.reason === 'empty-reply') return 'The model returned no text. Press ask again.'
  return 'Cut short before an answer came back. Press ask again.'
}
// The sidecar section sits under the drawers, which can push it out of the pane's window: scroll it into view.
// With an id, that sidecar's title row goes to the top of the window; without one, or if that is refused, the pane's end.
async function reveal($: EngineInterface, id?: string) {
  try {
    const r = id ? await $.ui.scroll({ in: PANE, to: { key: 's:' + id }, block: 'start' }) : undefined
    if (!r || r.deny) await $.ui.scroll({ in: PANE, to: 'end' })
  } catch { /* the pane is not placed, or has nothing to scroll */ }
}
// Asks a new sidecar, or asks an existing one again (again = its id). Resolves once the sidecar is in the pane;
// the fork answers later, in the background, so neither the command nor a running turn waits for it.
async function askSidecar($: EngineInterface, question: string, again?: string) {
  const now = Date.now()
  const id = again || 'sc-' + now.toString(36) + '-' + sideSeq++
  const fresh: Sidecar = { id, question, status: 'asking', asked: now, isOpen: true, seen: true, via: 'fork' }
  await update($, sidecars, xs => again
    ? xs.map(s => (s.id === id ? { ...s, status: 'asking' as const, asked: now, error: undefined, isOpen: true, seen: true } : s))
    : [...xs.map(s => (s.isOpen ? { ...s, isOpen: false } : s)), fresh].slice(-cfg.keep_sidecars))
  void reveal($)
  void (async () => {
    let answer = '', error = ''
    try {
      const r = await $.model.fork({ prompt: sidePrompt(question) })
      if (r.isAnswered) answer = clip(r.text.trim())
      else error = whyNot(r)
    } catch (err) { error = 'The fork failed: ' + String(err).slice(0, 200) }
    if (!answer && !error) error = 'The model returned no text. Press ask again.'
    try {
      if (!(await read($, sidecars)).some(s => s.id === id)) return // removed while the fork was out
      await update($, sidecars, xs => xs.map(s => (s.id === id ? { ...s, status: answer ? 'done' as const : 'failed' as const, answer: answer || s.answer, error: error || undefined, answered: Date.now(), seen: s.isOpen } : s)))
      $.ui.toast('sidecar ' + (answer ? 'answered: ' : 'failed: ') + cut(question.replace(/\s+/g, ' '), 50))
      await reveal($, id)
    } catch { /* the pane shows it on its next draw */ }
  })()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // $.state ends with the session; $.store keeps threads and reports across sessions.
    try { cfg = { ...CFG0, ...parseToml(await $.fs.read($.plugin.root + '/threads.toml')) } } catch { cfg = { ...CFG0 } }
    const savedT = (await $.store.get('threads')) as Thread[] | undefined
    const savedI = (await $.store.get('items')) as Item[] | undefined
    const savedS = (await $.store.get('sidecars')) as Sidecar[] | undefined
    await update($, threads, list => list.length ? list : savedT && savedT.length ? savedT : DEFAULTS)
    await update($, items, list => list.length ? list : savedI ?? [])
    // A sidecar still asking when the last session ended never got its answer: say so, and offer to ask again.
    await update($, sidecars, list => list.length ? list : (savedS ?? []).map(s => s.status === 'asking' ? { ...s, status: 'failed' as const, error: 'The session ended before the answer came back. Press ask again.' } : s))
    if (await $.store.get('hintOff')) await update($, hintOff, () => true)
    let last = ''
    $.clock.every(2000, async () => {
      const snap = JSON.stringify([await read($, threads), await read($, items), await read($, sidecars)])
      if (snap === last) return
      last = snap
      const [t, i, s] = JSON.parse(snap)
      await $.store.set('threads', t)
      await $.store.set('items', i)
      await $.store.set('sidecars', s)
    })
    await $.command.register({ name: 'threads', description: '/threads <name> <task> sends an agent  |  open the pane  |  /threads add <name> [keywords, comma-separated: agents whose task mentions one land here]  |  /threads rename <old> <new>  |  /threads drop <name>' })
    await $.command.register({
      name: 'thread',
      description: 'Same as /threads: /thread <name> <task> sends an agent',
    })
    // immediate: typed while a turn is running, it runs at once instead of waiting for the turn to end.
    // In a try: a build that refuses this registration must not stop the rest of session.start; the pane's button still asks.
    try { await $.command.register({ name: 'sidecar', description: 'Ask a side question: the answer lands in the threads pane, not in the chat', argumentHint: '<question>', immediate: true }) } catch { /* no /sidecar command on this build */ }
    $.clock.every(250, async () => {
      const xs = await read($, items)
      const run = xs.filter(x => x.status === 'running')
      const fresh = xs.filter(x => x.status !== 'running' && !x.seen).length
      if (run.length || (await read($, sidecars)).some(s => s.status === 'asking')) await update($, tick, n => n + 1)
      void fresh
      $.ui.status(undefined)
    })
    // Optional notes file: {"<item id>": ["note", ...]}; lets the main session annotate entries.
    $.clock.every(3000, async () => {
      let txt = ''
      try { txt = await $.fs.read($.plugin.root + '/inbox.json') } catch { return }
      let m: Record<string, unknown> = {}
      try { m = JSON.parse(txt) } catch { return }
      // "_move": {"<item id>": "<drawer>"} lets the main session file an entry; the drawer is made if missing.
      const mv = (m._move || {}) as Record<string, string>
      for (const [id, to] of Object.entries(mv)) {
        if (!(await read($, threads)).some(t => t.name === to)) await update($, threads, l => [...l, { name: to, words: [to], isOpen: true }])
        await update($, items, all => all.map(x => x.id === id && x.thread !== to ? { ...x, thread: to } : x))
      }
      delete m._move
      // "_rename": {"<old>": "<new>"} renames a drawer and its entries.
      const rn = (m._rename || {}) as Record<string, string>
      for (const [from, to] of Object.entries(rn)) if ((await read($, threads)).some(t => t.name === from)) {
        await update($, threads, l => l.map(t => t.name === from ? { ...t, name: to, words: [to] } : t))
        await update($, items, all => all.map(x => x.thread === from ? { ...x, thread: to } : x))
      }
      delete m._rename
      // "_log": [{"drawer": "<name>", "title": "<what was done>"}] files chat work as a done entry; the drawer is made if missing.
      const lg = (Array.isArray(m._log) ? m._log : []) as { drawer?: string, title?: string }[]
      for (const L of lg) {
        if (!L || !L.drawer || !L.title) continue
        const id = 'log-' + L.drawer + '-' + L.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
        if ((await read($, items)).some(x => x.id === id)) continue
        if (!(await read($, threads)).some(t => t.name === L.drawer)) await update($, threads, l => [...l, { name: L.drawer!, words: [L.drawer!], isOpen: true }])
        const now = Date.now()
        await update($, items, xs => [...xs, { id, thread: L.drawer!, title: L.title!, status: 'done' as const, started: now, ended: now, report: 'done in chat', seen: true }].slice(-cfg.keep_items))
      }
      delete m._log
      // "_sidecar": [{"question": "<question or short title>", "answer": "<markdown>"}] files an answer written in chat or by an agent as a sidecar.
      const sc = (Array.isArray(m._sidecar) ? m._sidecar : []) as { question?: string, answer?: string }[]
      for (const S of sc) {
        if (!S || !S.question || !S.answer) continue
        const question = String(S.question), answer = clip(String(S.answer))
        const id = 'sc-in-' + hash(question + '\n' + answer)
        if ((await read($, sidecars)).some(s => s.id === id)) continue
        const now = Date.now()
        const filed: Sidecar = { id, question, status: 'done', asked: now, answered: now, answer, isOpen: true, seen: true, via: 'inbox' }
        await update($, sidecars, xs => [...xs.map(s => (s.isOpen ? { ...s, isOpen: false } : s)), filed].slice(-cfg.keep_sidecars))
        $.ui.toast('sidecar filed: ' + cut(question.replace(/\s+/g, ' '), 50))
        void reveal($)
      }
      delete m._sidecar
      for (const [id, ns] of Object.entries(m as Record<string, string[]>)) for (const n of ns) await update($, items, all => addNote(all, id, n))
    })
    // Status bubbles: every status_every_minutes, a long-running entry flashes its progress for a minute.
    if (cfg.status_every_minutes > 0) $.clock.every(30000, async () => {
      const now = Date.now(), gap = cfg.status_every_minutes * 60000
      const due = (await read($, items)).filter(x => x.status === 'running' && now - x.started >= gap && now - (x.bubbleAt || x.started) >= gap)
      for (const x of due) {
        let summary = x.summary
        if (cfg.summaries && (x.trail || []).length) {
          try {
            const res = await $.model.complete({ model: 'haiku', maxTokens: 80, prompt: 'A background agent is working on: "' + x.title + '". Its latest steps, each "action => result tail":\n' + (x.trail || []).join('\n') + '\n\nWrite ONE plain line under 90 characters saying where it has got to. Include key numbers (times, counts) if any. No preamble.' })
            if (res.isAnswered) summary = res.text.trim().split('\n')[0]?.slice(0, 110)
          } catch { /* keep the old summary */ }
        }
        await update($, items, xs => xs.map(y => y.id === x.id ? { ...y, bubbleAt: now, summary } : y))
      }
    })
    if (cfg.suggest_tidy) $.clock.every(60000, async () => {
      const q = quietOnes(await read($, threads), await read($, items))
      const key = q.join(',')
      if (q.length && key !== lastQuiet) $.ui.toast('threads: quiet ' + cfg.idle_minutes + 'm+: ' + key + '  ·  /threads tidy')
      lastQuiet = key
    })
    if (cfg.open_on_start) void $.ui.open({ id: PANE, title: 'Threads' })
    return next(e)
  })

  on('command.run', { command: 'threads' }, async ($, e) => {
    const raw = e.args.trim().split(/\s+/)
    // "<old> -> <new>" is shorthand for "rename <old> <new>".
    const [verb, name, ws] = raw[1] === '->' && raw[0] && raw[2] ? ['rename', raw[0], raw[2]] : raw
    if (verb === 'add' && name) {
      const words = (ws || name).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      await update($, threads, list => [...list.filter(t => t.name !== name), { name, words, isOpen: true }])
      await $.ui.open({ id: PANE, title: 'Threads' })
      return { text: 'Added thread ' + name + ' (files agents matching: ' + words.join(', ') + '; or tag [' + name + '])' }
    }
    if (verb === 'tidy') {
      const q = quietOnes(await read($, threads), await read($, items))
      if (!q.length) return { text: 'Nothing quiet for ' + cfg.idle_minutes + ' minutes.' }
      await update($, threads, list => list.filter(t => !q.includes(t.name)))
      await update($, items, xs => xs.filter(x => !q.includes(x.thread)))
      lastQuiet = ''
      return { text: 'Tidied ' + q.length + ' quiet drawer(s): ' + q.join(', ') }
    }
    if (verb === 'log' && name && ws) {
      if (!(await read($, threads)).some(t => t.name === name)) await update($, threads, list => [...list, { name, words: [name], isOpen: true }])
      const now = Date.now()
      await update($, items, xs => [...xs, { id: 'log-' + now, thread: name, title: ws, status: 'done' as const, started: now, ended: now, report: 'done in chat', seen: true }].slice(-cfg.keep_items))
      return { text: 'Logged in ' + name + ': ' + ws }
    }
    if (verb === 'config') return { text: 'Config file: ' + $.plugin.root + '/threads.toml\n' + Object.entries(cfg).map(([k, v]) => k + ' = ' + v).join('\n') }
    if (verb === 'rename' && name && ws) {
      await update($, threads, list => list.some(t => t.name === name)
        ? list.filter(t => t.name !== ws).map(t => (t.name === name ? { ...t, name: ws, words: [ws] } : t))
        : [...list.filter(t => t.name !== ws), { name: ws, words: [ws], isOpen: true }])
      await update($, items, xs => xs.map(x => (x.thread === name ? { ...x, thread: ws } : x)))
      return { text: 'Renamed thread ' + name + ' to ' + ws + '.' }
    }
    if ((verb === 'drop' || verb === 'remove') && name) {
      await update($, threads, list => list.filter(t => t.name !== name))
      return { text: 'Dropped thread ' + name + '.' }
    }
    if (verb && !['open', 'add', 'drop', 'remove', 'rename', 'help', 'tidy', 'config', 'log'].includes(verb)) {
      // /threads <name> <task...>: everything after the name is the task; start a background agent filed there.
      const task = e.args.trim().slice(verb.length).trim()
      if (!task) return { text: 'Give a task after the name: /threads ' + verb + ' what to do' }
      await update($, threads, list => list.some(t => t.name === verb) ? list : [...list, { name: verb, words: [verb], isOpen: true }])
      await $.ui.open({ id: PANE, title: 'Threads' })
      void $.prompt.submit({ asUser: true, text: '⟜ threads › ' + verb + ' › new task\nStart one background agent (run_in_background) with a description that starts "[' + verb + '] " followed by a 3-6 word summary of the task, and this task as its prompt (add any context you know), then reply in one line:\n' + task })
      return { text: 'Sending a ' + verb + ' agent: ' + task.slice(0, 80) }
    }
    if (verb && verb !== 'open') return { text: 'Usage: /threads <name> <task>  |  /threads  |  /threads add <name> [keywords, comma-separated: agents whose task mentions one land here]  |  /threads rename <old> <new>  |  /threads drop <name>' }
    await $.ui.open({ id: PANE, title: 'Threads' })
    return { text: 'Threads pane opened.' }
  })

  on('command.run', { command: 'thread' }, async ($, e) => {
    const raw = e.args.trim().split(/\s+/)
    // "<old> -> <new>" is shorthand for "rename <old> <new>".
    const [verb, name, ws] = raw[1] === '->' && raw[0] && raw[2] ? ['rename', raw[0], raw[2]] : raw
    if (verb === 'add' && name) {
      const words = (ws || name).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      await update($, threads, list => [...list.filter(t => t.name !== name), { name, words, isOpen: true }])
      await $.ui.open({ id: PANE, title: 'Threads' })
      return { text: 'Added thread ' + name + ' (files agents matching: ' + words.join(', ') + '; or tag [' + name + '])' }
    }
    if (verb === 'rename' && name && ws) {
      await update($, threads, list => list.some(t => t.name === name)
        ? list.filter(t => t.name !== ws).map(t => (t.name === name ? { ...t, name: ws, words: [ws] } : t))
        : [...list.filter(t => t.name !== ws), { name: ws, words: [ws], isOpen: true }])
      await update($, items, xs => xs.map(x => (x.thread === name ? { ...x, thread: ws } : x)))
      return { text: 'Renamed thread ' + name + ' to ' + ws + '.' }
    }
    if ((verb === 'drop' || verb === 'remove') && name) {
      await update($, threads, list => list.filter(t => t.name !== name))
      return { text: 'Dropped thread ' + name + '.' }
    }
    if (verb && !['open', 'add', 'drop', 'remove', 'rename', 'help'].includes(verb)) {
      // /threads <name> <task...>: everything after the name is the task; start a background agent filed there.
      const task = e.args.trim().slice(verb.length).trim()
      if (!task) return { text: 'Give a task after the name: /threads ' + verb + ' what to do' }
      await update($, threads, list => list.some(t => t.name === verb) ? list : [...list, { name: verb, words: [verb], isOpen: true }])
      await $.ui.open({ id: PANE, title: 'Threads' })
      void $.prompt.submit({ asUser: true, text: '⟜ threads › ' + verb + ' › new task\nStart one background agent (run_in_background) with a description that starts "[' + verb + '] " followed by a 3-6 word summary of the task, and this task as its prompt (add any context you know), then reply in one line:\n' + task })
      return { text: 'Sending a ' + verb + ' agent: ' + task.slice(0, 80) }
    }
    if (verb && verb !== 'open') return { text: 'Usage: /threads <name> <task>  |  /threads  |  /threads add <name> [keywords, comma-separated: agents whose task mentions one land here]  |  /threads rename <old> <new>  |  /threads drop <name>' }
    await $.ui.open({ id: PANE, title: 'Threads' })
    return { text: 'Threads pane opened.' }
  })

  on('command.run', { command: 'sidecar' }, async ($, e) => {
    const q = e.args.trim()
    await $.ui.open({ id: PANE, title: 'Threads' })
    if (!q) return { text: 'Usage: /sidecar <question>. The answer shows in the sidecar section at the bottom of the threads pane, not in the chat.', isTextDisplayOnly: true as const }
    await askSidecar($, q)
    // The question is left out of this line: typed mid-turn, the line can reach the model, which should not answer it too.
    return { text: 'Sidecar asked. The answer will show in the threads pane.', isTextDisplayOnly: true as const }
  })

  // Auto-organise: tell the model the drawers so it tags each agent; also pass on any tidy suggestion.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const list = await read($, threads)
    const parts: string[] = []
    if (cfg.auto_organise) parts.push('Threads mod: when you start a background agent, begin its description with a [drawer] tag. Drawers now: ' + list.map(t => t.name).join(', ') + '. Reuse the drawer the work belongs to; if none fits, invent a short lowercase-hyphen name. Keep related tasks in one drawer.')
    if (cfg.auto_organise) parts.push('Threads mod: when you finish work yourself (no agent) that belongs to a drawer (the person named it, a /thread or /threads command this session pointed at it, or the work plainly matches one), file it yourself: add {"drawer": "<drawer>", "title": "<short title>"} to the "_log" array in ' + $.plugin.root + '/inbox.json (create the file if missing, keep its other keys), then end your reply with one line: "filed in <drawer>: <title>". Use the same title again for later rounds of the same job, so it stays one entry. Only if no drawer fits or two fit equally, offer "/threads log <drawer> <short title>" instead. Skip small talk.')
    if (cfg.auto_organise) parts.push('Threads mod: when the person asks for an answer, a summary or some output "in a sidecar" (kept beside the chat instead of in your reply or a /tmp file), add {"question": "<their question or a short title>", "answer": "<the answer, markdown>"} to the "_sidecar" array in ' + $.plugin.root + '/inbox.json (create the file if missing, keep its other keys), then reply with one line: "sidecar: <title>". A /sidecar command needs nothing from you: the mod answers it itself.')
    const q = cfg.suggest_tidy ? quietOnes(list, await read($, items)) : []
    if (q.length) parts.push('Threads mod: these drawers have been quiet for ' + cfg.idle_minutes + '+ minutes: ' + q.join(', ') + '. At the end of your next reply, suggest once in one line that the person run /threads tidy.')
    if (!parts.length) return r
    return { sections: [...r.sections, { id: 'threads:organise', text: parts.join('\n'), scope: 'session' as const }] }
  })

  // Live steps: a subagent's tool calls carry its agentId; keep the latest one on its entry.
  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id) {
      const inp = e as unknown as Record<string, unknown>
      const what = String(inp.description || inp.command || inp.file_path || inp.pattern || inp.url || inp.code || '').replace(/\s+/g, ' ').slice(0, 70)
      const step = e.tool + (what ? ' · ' + what : '')
      const r = await next(e)
      const tailTxt = JSON.stringify(r).replace(/\\n/g, ' ').replace(/\s+/g, ' ').slice(-140)
      const all = await read($, items)
      if (all.some(x => x.id === id && x.status === 'running')) await update($, items, xs => xs.map(x => x.id === id ? { ...x, step, steps: (x.steps || 0) + 1, trail: [...(x.trail || []), step + ' => ' + tailTxt].slice(-15) } : x))
      return r
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => { const t = (e as { text?: string }).text || ''; if (!t.startsWith('⟜') && (e as { command?: { name?: string } }).command?.name !== 'sidecar') lastAsk = t; return next(e) })
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const id = ('agentId' in r && r.agentId) || e.tool_use_id
    if (!id) return r
    let list = await read($, threads)
    const tag = /^\[([\w-]+)\]/.exec(e.description || '')?.[1]
    if (tag && !list.some(t => t.name === tag)) { await update($, threads, l => [...l, { name: tag, words: [tag], isOpen: true }]); list = await read($, threads) }
    const thread = pick(list, e.description || '', e.prompt || '')
    const item: Item = {
      id, thread, title: (e.description || 'agent').replace(/\[[\w-]+\]\s*/, ''),
      status: 'running', started: Date.now(), seen: false,
    }
    await update($, items, all => [...all.filter(x => x.id !== id), item].slice(-cfg.keep_items))
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      if (e.reason === 'answer') autoFile($, e.answer || '')
      if (pending && e.reason === 'answer') {
        const id = pending
        pending = ''
        await update($, items, all => addNote(all, id, gist(e.answer || '').slice(0, 160)))
      }
      return r
    }
    const all = await read($, items)
    const hit = all.find(x => x.id === e.agentId)
    if (!hit) return r
    await update($, items, list => list.map(x => x.id === e.agentId ? {
      ...x, status: e.reason === 'answer' ? 'done' : 'failed', ended: Date.now(),
      report: gist(e.answer || ''), full: keepFull(e.answer || ''), seen: false,
    } : x))
    $.ui.toast(hit.thread + ': ' + hit.title + ' reported')
    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link, Input, Markdown } = $.ui.resolve(e)
    const list = await read($, threads)
    const all = await read($, items)
    const sides = (await read($, sidecars)).filter(s => !s.gone)
    const isAsking = await read($, asking)
    const cols = e.props.bodyColumns ?? 80
    const isAdding = await read($, adding)
    const ren = await read($, renaming)
    const lastOf = (name: string) => Math.max(0, ...all.filter(x => x.thread === name).map(x => x.ended || x.started))
    const folded = (t: Thread) => {
      const mine = all.filter(x => x.thread === t.name)
      if (!mine.length || mine.some(x => x.status === 'running' || !x.seen)) return false
      const last = lastOf(t.name)
      return Date.now() - last > cfg.fold_after_hours * 3600000 && (t.openedAt || 0) < last + cfg.fold_after_hours * 3600000
    }
    const rename = async (from: string, raw: string) => {
      const to = raw.trim().toLowerCase().replace(/\s+/g, '-')
      await update($, renaming, () => '')
      if (!to || to === from) return
      await update($, threads, ts => {
        const a = ts.find(t => t.name === from), b = ts.find(t => t.name === to)
        if (b) return ts.filter(t => t.name !== from).map(t => t.name === to ? { ...t, words: [...new Set([...t.words, ...(a?.words || [])])], isOpen: true } : t)
        return ts.some(t => t.name === from) ? ts.map(t => t.name === from ? { ...t, name: to } : t) : [{ name: to, words: [], isOpen: true }, ...ts]
      })
      await update($, items, xs => xs.map(x => x.thread === from ? { ...x, thread: to } : x))
    }
    const linkify = (t: string) => t.split(/(https?:\/\/[^\s<>()\[\]"'`]+[^\s<>()\[\]"'`.,;:!?])/).map((part, k) => k % 2 ? <Link key={'u' + k} href={part}>{part}</Link> : part)
    const dismissed = await read($, hintOff)
    const docked = e.props.placement === 'dock' && e.viewport?.isFullscreen !== false
    const narrow = (e.props.bodyColumns ?? 80) < 34
    const opened = await read($, open1)
    const n = await read($, tick)
    const spin = SPIN[n % SPIN.length]
    const known = (x: Item) => list.some(t => t.name === x.thread)
    const names = [...list.map(t => t.name), ...[...new Set(all.filter(x => !known(x)).map(x => x.thread))]]
    const toggle = async (name: string) => {
      await update($, threads, ts => ts.find(t => t.name === name)
        ? ts.map(t => (t.name === name ? { ...t, isOpen: !t.isOpen || folded(t), openedAt: Date.now() } : t))
        : [...ts, { name, words: [], isOpen: false }])
      await update($, items, xs => xs.map(x => (x.thread === name ? { ...x, seen: true } : x)))
    }
    const clear = (name: string) => update($, items, xs => xs.filter(x => x.thread !== name || x.status === 'running'))
    const toggleSide = (id: string) => update($, sidecars, xs => xs.map(s => (s.id === id ? { ...s, isOpen: !s.isOpen, seen: true } : s)))
    // An inbox-filed sidecar stays as a hidden marker, so the same inbox.json entry is not filed again 3 seconds later.
    const removeSide = (id: string) => update($, sidecars, xs => xs.flatMap(s => s.id !== id ? [s] : s.via === 'inbox' ? [{ ...s, gone: true, answer: undefined, isOpen: false }] : []))
    return (
      <Box flexDirection="column" minHeight={e.props.placement === 'dock' ? e.props.scroll.bodyRows : undefined}>
        {!dismissed && (!docked || narrow) && (
          <Box flexDirection="column" borderStyle="round" borderColor="#d7d75f" paddingX={1} marginBottom={1}>
            <Text bold>Threads works best as a right sidebar</Text>
            <Text>1. Run /tui fullscreen (or launch with CLAUDE_CODE_NO_FLICKER=1)</Text>
            <Text>2. Widen the terminal to 140+ columns; below that the pane sits above the prompt</Text>
            <Text dimColor>Clicks reach the pane only in fullscreen. Keys: ctrl+x tab, then 1-9.</Text>
            <Button key="hint-off" plain dimColor onPress={async () => { await update($, hintOff, () => true); await $.store.set('hintOff', true) }}>[ got it ]</Button>
          </Box>
        )}
        {isAdding
          ? <Input key="new-thread" label="+ " placeholder="thread name" submitLabel="make" autoFocus
              onSubmit={async v => {
                const name = v.trim().toLowerCase().replace(/\s+/g, '-')
                if (name) await update($, threads, ts => ts.some(t => t.name === name) ? ts : [{ name, words: [], isOpen: true }, ...ts])
                await update($, adding, () => false)
              }} />
          : <Box marginBottom={1} paddingLeft={4}><Button key="add-thread" plain dimColor onPress={() => update($, adding, () => true)}>[ + thread ]</Button></Box>}
        {names.map((name, i) => {
          const hue = HUES[i % HUES.length]
          const t = list.find(x => x.name === name)
          const isOpen = t ? t.isOpen && !folded(t) : true
          const mine = all.filter(x => x.thread === name)
          const running = mine.filter(x => x.status === 'running').length
          const fresh = mine.filter(x => x.status !== 'running' && !x.seen).length
          return (
            <Box flexDirection="column" key={name} marginBottom={1}>
              <Box flexDirection="row">
                {ren === name
                  ? <Input key={'r:' + name} label="✎ " placeholder={name + ' (existing name merges)'} submitLabel="rename" autoFocus onSubmit={v => rename(name, v)} />
                  : <Button key={'t:' + name} hotkey={i < 9 ? String(i + 1) : undefined} plain onPress={() => toggle(name)}>
                      <Text color={hue} bold>{(isOpen ? '[▾] ' : '[▸] ') + name}</Text>
                    </Button>}
                <Text> </Text>
                {running > 0 && <Text color={hue}>{spin + ' ' + running + ' running '}</Text>}
                {fresh > 0 && <Text inverse color={hue}>{' ' + fresh + ' new '}</Text>}
                {!running && !fresh && <Text dimColor>{(mine.length ? mine.length + (mine.length === 1 ? ' entry' : ' entries') : 'empty') + (!isOpen && mine.length ? ' · ' + ago(lastOf(name)) : '')}</Text>}
                {isOpen && mine.some(x => x.status !== 'running') && <Text> </Text>}
                {isOpen && mine.some(x => x.status !== 'running') && <Button key={'c:' + name} plain dimColor onPress={() => clear(name)}>clear</Button>}
                {isOpen && <Text> </Text>}
                {isOpen && <Button key={'p:' + name} plain onPress={() => $.prompt.fill({ text: '/threads ' + name + ' ', mode: 'replace' })}><Text color={hue}>+ task</Text></Button>}
                {isOpen && <Text> </Text>}
                {isOpen && <Button key={'e:' + name} plain dimColor onPress={() => update($, renaming, c => c === name ? '' : name)}>✎</Button>}
                {isOpen && <Text> </Text>}
                {isOpen && <Button key={'d:' + name} plain dimColor={ren !== '✕' + name} onPress={async () => {
                  if (ren !== '✕' + name) { await update($, renaming, () => '✕' + name); return }
                  await update($, renaming, () => '')
                  await update($, threads, ts => ts.filter(t => t.name !== name)); await update($, items, xs => xs.filter(x => x.thread !== name || x.status === 'running')) }}>{ren === '✕' + name ? <Text color="red">✕ delete drawer?</Text> : '✕'}</Button>}
              </Box>
              {isOpen && mine.slice(-cfg.show_per_fold).reverse().map(x => {
                const big = opened === x.id
                const body = x.full || x.report || 'still running'
                const rows = body.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 44)), 0)
                const acts = (at: string) => (
                  <Box flexDirection="row">
                    <Button key={'a' + at + ':' + x.id} plain dimColor onPress={() => $.prompt.fill({ text: '⟜ threads › ' + x.thread + ' › "' + x.title + '" (agent ' + x.id + ')\n', mode: 'insert' })}>{x.status === 'running' ? '↳ message' : '↳ reply'}</Button>
                    {x.status === 'running' && <Text>   </Text>}
                    {x.status === 'running' && <Button key={'w' + at + ':' + x.id} plain dimColor onPress={() => { void $.ui.view({ agentId: x.id }) }}>◉ watch</Button>}
                    <Text>   </Text>
                    <Button key={'x' + at + ':' + x.id} plain dimColor onPress={async () => { await update($, items, xs => xs.filter(y => y.id !== x.id)); await update($, open1, () => '') }}>✕ remove</Button>
                  </Box>
                )
                const mark = x.status === 'running' ? spin : x.status === 'failed' ? '✗' : CHAT(x) ? '·' : '✓'
                return (
                  <Box flexDirection="column" key={x.id} paddingLeft={2} borderStyle={big ? 'single' : undefined} borderColor={hue}>
                    <Box flexDirection="row">
                      <Text color={x.status === 'failed' ? 'red' : hue} dimColor={CHAT(x)}>{mark + ' '}</Text>
                      <Button key={'i:' + x.id} plain onPress={() => update($, open1, cur => (cur === x.id ? '' : x.id))}>
                        <Text bold={!x.seen && x.status !== 'running'} dimColor={CHAT(x)}>{x.title}</Text>
                      </Button>
                      <Text dimColor>{'  ' + (x.status === 'running' ? ago(x.started) : ago(x.ended || x.started) + ' ago' + (x.ended && x.ended - x.started >= 1000 ? ' · took ' + dur(x.ended - x.started) : ''))}</Text>
                    </Box>
                    {x.status === 'running' && x.step && (Date.now() - (x.bubbleAt || 0) < 60000
                      ? <Text color={hue} bold wrap="truncate-end">{'  ◆ ' + ago(x.started) + ' · ' + (x.summary || (x.steps || 0) + ' steps · now ' + x.step)}</Text>
                      : <Text dimColor wrap="truncate-end">{'  ⋯ ' + (x.summary ? x.summary + ' · ' : '') + x.step}</Text>)}
                    {!big && x.report && !CHAT(x) && <Text dimColor wrap="truncate-end">{'  ' + x.report}</Text>}
                    {big && rows > cfg.top_buttons_after && acts('t')}
                    {big && <Text wrap="wrap">{linkify(body)}</Text>}
                    {big && (x.notes || []).map((n, k) => <Text key={'n' + k} color={n.startsWith('you:') ? undefined : hue} wrap="wrap">{'⟜ ' + n}</Text>)}
                    {!big && (x.notes || []).length > 0 && <Text dimColor wrap="truncate-end">{'  ⟜ ' + (x.notes || [])[(x.notes || []).length - 1]}</Text>}
                    {big && acts('b')}
                  </Box>
                )
              })}
            </Box>
          )
        })}
        <Box flexGrow={1} />
        {(sides.length > 0 || isAsking || docked) && (
          <Box flexDirection="column" marginTop={1}>
            <Text color={SIDE_HUE} wrap="truncate-end">{'── sidecars' + (sides.length ? ' ' + sides.length : '')}</Text>
            {isAsking
              ? <Input key="new-sidecar" label="? " placeholder="side question" submitLabel="ask" autoFocus
                  onSubmit={async v => {
                    await update($, asking, () => false)
                    if (v.trim()) await askSidecar($, v.trim())
                  }} />
              : <Box paddingLeft={4}><Button key="add-sidecar" plain dimColor onPress={() => update($, asking, () => true)}>[ + sidecar ]</Button></Box>}
            {[...sides].reverse().map(s => {
              const q = s.question.replace(/\s+/g, ' ')
              const age = ago(s.answered || s.asked)
              const tail = s.status === 'asking' ? spin + ' ' + age : s.status === 'failed' ? '✗ ' + age : (s.seen ? '' : 'new · ') + age
              const head = cut(q, Math.max(8, cols - 7 - tail.length))
              const stuck = s.status === 'asking' && Date.now() - s.asked > 180000
              return (
                <Box flexDirection="column" key={'sc:' + s.id}>
                  <Box flexDirection="row">
                    <Button key={'s:' + s.id} plain onPress={() => toggleSide(s.id)}>
                      <Text color={SIDE_HUE} bold={!s.seen}>{(s.isOpen ? '[▾] ' : '[▸] ') + head}</Text>
                    </Button>
                    <Text dimColor>{' · ' + tail}</Text>
                  </Box>
                  {s.isOpen && (
                    <Box flexDirection="column" paddingLeft={2}>
                      {head !== q && <Text dimColor wrap="wrap">{q}</Text>}
                      {s.status === 'asking' && <Text dimColor>asking a fork of the conversation…</Text>}
                      {s.answer && <Markdown key={'sm:' + s.id} text={s.answer} dimColor={s.status === 'asking'} />}
                      {s.error && <Text color="red" wrap="wrap">{s.error}</Text>}
                      <Box flexDirection="row">
                        {s.via === 'fork' && (s.status !== 'asking' || stuck) && <Button key={'sa:' + s.id} plain dimColor onPress={() => askSidecar($, s.question, s.id)}>↻ ask again</Button>}
                        {s.via === 'fork' && (s.status !== 'asking' || stuck) && <Text>   </Text>}
                        {s.answer && <Button key={'sy:' + s.id} plain dimColor onPress={async p => {
                          const r = await $.ui.copy({ text: s.answer || '', surface: p.surface })
                          $.ui.toast(r.isCopied ? 'sidecar: answer copied' : 'sidecar: not copied (' + r.reason + ')')
                        }}>⧉ copy</Button>}
                        {s.answer && <Text>   </Text>}
                        <Button key={'sx:' + s.id} plain dimColor onPress={() => removeSide(s.id)}>✕ remove</Button>
                      </Box>
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        )}
        {docked ? <Text> </Text> : <Text dimColor>{HINT}</Text>}
        {docked && (
          <Box position="absolute" top={(e.props.scroll?.offset || 0) + e.props.scroll.bodyRows - 1} left={0} width="100%">
            <Text dimColor>{HINT}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
