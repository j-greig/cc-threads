import { expect, mock, test } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'

// Tests for /sidecar: the command, the fork that answers it, the pane's sidecar section,
// persistence in the store, and the inbox.json "_sidecar" filing path.
// Nothing sits beneath the mod in a test: each hook in world() stands for the engine.

const PANE = {
  plugin: 'threads',
  component: 'Pane',
  requestId: 'threads',
  surface: 'terminal',
  props: {
    title: 'Threads',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
const USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const answered = (text: string) => ({ isAnswered: true, text, usage: USAGE }) as ModelForkResult
const NOTHING: ModelForkResult = { isAnswered: false, reason: 'nothing-to-fork' }

// What a session might write to inbox.json: one sidecar beside a "_log" entry, which must still be filed.
const SAMPLE_INBOX = JSON.stringify({
  _log: [{ drawer: 'docs', title: 'tidy the readme' }],
  _sidecar: [{ question: 'what have we changed so far?', answer: 'tl;dr: the pane gained a sidecar section\n\n- one new command\n- one new inbox key' }],
})

type World = {
  files: Record<string, string>      // what $.fs.read answers, by file name; a name not listed is a missing file
  store: Record<string, unknown>     // the mod's $.store
  forks: string[]                    // every prompt $.model.fork was sent
  reply: () => ModelForkResult       // what the next fork answers
  wait: () => Promise<void>          // how long the fork takes
  toasts: string[]
  copied: string[]
}

// Stands in for the engine under the mod: commands, the pane, files, the store, toasts, the fork.
function world(on: On, seed: Partial<World> = {}): World {
  const w: World = { files: {}, store: {}, forks: [], reply: () => answered('ok'), wait: async () => {}, toasts: [], copied: [], ...seed }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.scroll', () => ({}))
  on('ui.copy', (_, e) => { w.copied.push(e.text); return { value: { isCopied: true as const } } })
  on('fs.read', (_, e) => {
    const text = w.files[e.path.split('/').pop() || '']
    return text === undefined ? { deny: 'no such file' } : { value: text }
  })
  on('store.get', (_, e) => ({ value: w.store[e.key] }))
  on('store.set', (_, e) => { w.store[e.key] = e.value; return { value: undefined } })
  on('model.fork', async (_, e) => { w.forks.push(e.prompt); await w.wait(); return { value: w.reply() } })
  return w
}

const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const sideButtons = async (ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined; text: string }[]> }) =>
  (await ui.findAll({ type: 'Button' })).filter(b => (b.key || '').startsWith('s:'))

test('/sidecar forks the conversation and the answer lands in the pane', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, { reply: () => answered('tl;dr: two files changed\n\n- hooks/register.tsx\n- types/index.d.ts') })
  await $.session.start(START)

  const ran = await $.command.run({ command: 'sidecar', args: 'what have we changed so far?', ...TYPED })
  await clock.settle()

  // The fork got the question. The command's own line does not repeat it and is for the person alone.
  expect(w.forks).toHaveLength(1)
  expect(w.forks[0]).toContain('Question: what have we changed so far?')
  expect(w.forks[0]).toContain('no tools')
  expect(ran.text).not.toContain('what have we changed')
  expect(ran.isTextDisplayOnly).toBe(true)

  const ui = await $.ui.mount(PANE)
  await ui.drawn() // rejects if the terminal's table refuses the tree (the Markdown body, say)
  expect((await ui.find({ type: 'Markdown', text: /two files changed/ }))?.type).toBe('Markdown')
  const [title] = await sideButtons(ui)
  expect(title?.text).toBe('[▾] what have we changed so far?')
  expect(w.toasts).toContain('sidecar answered: what have we changed so far?')
  await ui.unmount()

  // The same tree is one every other surface can draw.
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const other = await $.ui.mount({ ...PANE, surface })
    await other.drawn()
    expect((await other.find({ type: 'Markdown' }))?.text).toContain('two files changed')
    await other.unmount()
  }
})

test('the command returns before the fork answers, and the pane shows it asking', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, { wait: () => clock.sleep(5000), reply: () => answered('main') })
  await $.session.start(START)

  await $.command.run({ command: 'sidecar', args: 'which branch are we on?', ...TYPED })
  await clock.settle()

  const ui = await $.ui.mount(PANE)
  expect(w.forks).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /asking a fork of the conversation/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()

  await clock.advance(5000)
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('main')
  expect(await ui.find({ type: 'Text', text: /asking a fork of the conversation/ })).toBeUndefined()
  await ui.unmount()
})

test('a sidecar removed while its fork is out stays removed, with no toast', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, { wait: () => clock.sleep(5000), reply: () => answered('too late') })
  await $.session.start(START)
  await $.command.run({ command: 'sidecar', args: 'never mind', ...TYPED })
  await clock.settle()

  const ui = await $.ui.mount(PANE)
  const [title] = await sideButtons(ui)
  await ui.press({ key: 'sx:' + title!.key!.slice(2) })
  await clock.advance(5000)
  expect(await sideButtons(ui)).toHaveLength(0)
  expect(w.toasts.filter(t => t.startsWith('sidecar'))).toEqual([])
  await ui.unmount()
})

test('sidecars stack newest first, fold to one line, toggle and remove', async ($, on) => {
  const clock = mock.clock(on)
  let n = 0
  world(on, { reply: () => answered('answer ' + ++n) })
  await $.session.start(START)
  for (const q of ['first question', 'second question', 'third question']) {
    await $.command.run({ command: 'sidecar', args: q, ...TYPED })
    await clock.settle()
  }

  const ui = await $.ui.mount(PANE)
  // Newest first; only the newest is open; a folded one is its title and an age.
  expect((await sideButtons(ui)).map(b => b.text)).toEqual(['[▾] third question', '[▸] second question', '[▸] first question'])
  expect((await ui.findAll({ type: 'Markdown' })).map(m => m.text)).toEqual(['answer 3'])
  expect(await ui.find({ type: 'Text', text: /sidecars 3/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Text', text: /^ · \d+s$/ })).length).toBe(3)

  // Opening an older one leaves the newest open: each folds by itself.
  const older = (await sideButtons(ui))[2]!
  await ui.press({ key: older.key! })
  expect((await sideButtons(ui)).map(b => b.text)).toEqual(['[▾] third question', '[▸] second question', '[▾] first question'])
  expect((await ui.findAll({ type: 'Markdown' })).map(m => m.text)).toEqual(['answer 3', 'answer 1'])
  await ui.press({ key: older.key! })
  expect((await ui.findAll({ type: 'Markdown' })).map(m => m.text)).toEqual(['answer 3'])

  // Remove drops one sidecar and leaves the rest.
  const newest = (await sideButtons(ui))[0]!
  await ui.press({ key: 'sx:' + newest.key!.slice(2) })
  expect((await sideButtons(ui)).map(b => b.text)).toEqual(['[▸] second question', '[▸] first question'])
  await ui.unmount()
})

test('a fork with nothing to fork says so, and ask again retries it', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, { reply: () => NOTHING })
  await $.session.start(START)
  await $.command.run({ command: 'sidecar', args: 'what is left to do?', ...TYPED })
  await clock.settle()

  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Nothing to fork yet/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  expect(w.toasts).toContain('sidecar failed: what is left to do?')

  w.reply = () => answered('two things')
  const [title] = await sideButtons(ui)
  await ui.press({ key: 'sa:' + title!.key!.slice(2) })
  await clock.settle()
  expect(w.forks).toHaveLength(2)
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('two things')
  expect(await ui.find({ type: 'Text', text: /Nothing to fork yet/ })).toBeUndefined()
  expect(await sideButtons(ui)).toHaveLength(1)
  await ui.unmount()
})

test('the [ + sidecar ] button asks from the pane, and copy takes the answer', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, { reply: () => answered('on the sidecar branch') })
  await $.session.start(START)

  const ui = await $.ui.mount(PANE)
  await ui.press({ key: 'add-sidecar' })
  await ui.input({ key: 'new-sidecar', text: 'which branch are we on?' })
  await clock.settle()

  expect(w.forks[0]).toContain('Question: which branch are we on?')
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('on the sidecar branch')
  const [title] = await sideButtons(ui)
  await ui.press({ key: 'sy:' + title!.key!.slice(2) })
  expect(w.copied).toEqual(['on the sidecar branch'])
  await ui.unmount()
})

test('sidecars are written to the store and come back in the next session', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, { reply: () => answered('kept') })
  await $.session.start(START)
  await $.command.run({ command: 'sidecar', args: 'will this survive a restart?', ...TYPED })
  await clock.advance(2000)

  expect(w.store.sidecars).toMatchObject([{ question: 'will this survive a restart?', status: 'done', answer: 'kept', via: 'fork' }])
})

test('a stored sidecar is drawn again; one that was still asking is marked unanswered', async ($, on) => {
  mock.clock(on)
  const old = Date.now() - 5 * 60000
  world(on, {
    store: {
      sidecars: [
        { id: 'sc-a', question: 'an old question with a title that is far longer than the pane is wide', status: 'done', asked: old, answered: old, answer: 'old answer', isOpen: false, seen: true, via: 'fork' },
        { id: 'sc-b', question: 'cut off by a restart', status: 'asking', asked: old, isOpen: true, seen: true, via: 'fork' },
      ],
    },
  })
  await $.session.start(START)

  const ui = await $.ui.mount(PANE)
  const titles = (await sideButtons(ui)).map(b => b.text)
  // A folded sidecar is one line: its title cut to the pane's 40 columns, then its age.
  expect(titles).toEqual(['[▾] cut off by a restart', '[▸] an old question with a title t…'])
  expect(await ui.find({ type: 'Text', text: /^ · 5m$/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined() // the folded one shows no body
  expect(await ui.find({ type: 'Text', text: /The session ended before the answer came back/ })).toBeDefined()

  // Opened, it shows the whole question above the answer.
  await ui.press({ key: 's:sc-a' })
  expect((await ui.find({ type: 'Text', text: /^an old question .* pane is wide$/ }))?.text).toBe('an old question with a title that is far longer than the pane is wide')
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('old answer')
  await ui.unmount()
})

test('a "_sidecar" entry in inbox.json is filed once, beside the other inbox keys', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, { files: { 'inbox.json': SAMPLE_INBOX } })
  await $.session.start(START)
  await clock.advance(3000)

  const ui = await $.ui.mount(PANE)
  expect((await sideButtons(ui)).map(b => b.text)).toEqual(['[▾] what have we changed so far?'])
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('the pane gained a sidecar section')
  expect(await ui.find({ type: 'Button', text: /tidy the readme/ })).toBeDefined() // "_log" still files its drawer entry
  expect(w.toasts).toContain('sidecar filed: what have we changed so far?')
  expect(w.forks).toHaveLength(0) // filed as written: no model call

  // The file is read again every 3 seconds: the same entry must not stack up, nor come back once removed.
  await clock.advance(9000)
  expect(await sideButtons(ui)).toHaveLength(1)
  const [title] = await sideButtons(ui)
  await ui.press({ key: 'sx:' + title!.key!.slice(2) })
  expect(await sideButtons(ui)).toHaveLength(0)
  await clock.advance(9000)
  expect(await sideButtons(ui)).toHaveLength(0)

  // A new answer to the same question is a new sidecar.
  w.files['inbox.json'] = JSON.stringify({ _sidecar: [{ question: 'what have we changed so far?', answer: 'a later answer' }] })
  await clock.advance(3000)
  expect((await ui.findAll({ type: 'Markdown' })).map(m => m.text)).toEqual(['a later answer'])
  await ui.unmount()
})
