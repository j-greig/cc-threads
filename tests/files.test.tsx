import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// Tests for the file section: /file opens a file, markdown is drawn, edit mode tracks unsaved
// changes, Enter saves to disk, and a path in a report opens the file when clicked.

const PANE = {
  plugin: 'threads',
  component: 'Pane',
  requestId: 'threads',
  surface: 'terminal',
  props: { title: 'Threads', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const
const START = { cwd: '/', surface: 'terminal', isInteractive: true } as const

type World = { disk: Record<string, string>, store: Record<string, unknown>, writes: string[], filled: string[] }
function world(on: On, seed: Partial<World> = {}): World {
  const w: World = { disk: {}, store: {}, writes: [], filled: [], ...seed }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.scroll', () => ({}))
  on('fs.read', (_, e) => (w.disk[e.path] === undefined ? { deny: 'no such file' } : { value: w.disk[e.path]! }))
  on('fs.write', (_, e) => { w.disk[e.path] = e.text; w.writes.push(e.path); return { value: undefined } })
  on('store.get', (_, e) => ({ value: w.store[e.key] }))
  on('store.set', (_, e) => { w.store[e.key] = e.value; return { value: undefined } })
  on('prompt.fill', (_, e) => { w.filled.push(e.text); return { isFilled: true, text: e.text, cursor: e.text.length } })
  return w
}

test('/file opens a markdown file, edit marks it unsaved, Enter saves it', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, { disk: { '/notes/plan.md': '# Plan\n\n- one\n- two' } })
  await $.session.start(START)
  const ran = await $.command.run({ command: 'file', args: '/notes/plan.md', ...TYPED })
  await clock.settle()
  expect(ran.text).toContain('Opened')

  const ui = await $.ui.mount(PANE)
  await ui.drawn()
  expect((await ui.find({ type: 'Markdown' }))?.text).toContain('# Plan')
  await ui.press({ key: 'fe:/notes/plan.md' })
  await ui.input({ key: 'fi:/notes/plan.md', text: '# Plan\n\n- one', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: /unsaved/ })).toBeDefined()
  expect(w.writes).toEqual([])

  await ui.input({ key: 'fi:/notes/plan.md', text: '# Plan\n\n- one' })
  await clock.settle()
  expect(w.disk['/notes/plan.md']).toBe('# Plan\n\n- one')
  expect(await ui.find({ type: 'Text', text: /unsaved/ })).toBeUndefined()
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe('# Plan\n\n- one')

  await ui.press({ key: 'fc:/notes/plan.md' })
  expect(w.filled[0]).toContain('‹file:/notes/plan.md›')
  await ui.unmount()

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const other = await $.ui.mount({ ...PANE, surface })
    await other.drawn()
    await other.unmount()
  }
})

test('a missing file shows an error; a path in a report opens the file', async ($, on) => {
  const clock = mock.clock(on)
  const item = { id: 'a1', thread: 'build', title: 'write notes', status: 'done', started: 1, ended: 2, report: 'wrote it', full: 'Wrote /notes/todo.txt for you.', seen: true }
  world(on, { disk: { '/notes/todo.txt': 'milk' }, store: { items: [item], threads: [{ name: 'build', words: ['build'], isOpen: true, openedAt: 1e15 }] } })
  await $.session.start(START)
  await $.command.run({ command: 'file', args: '/nope.md', ...TYPED })
  await clock.settle()
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Could not read/ })).toBeDefined()

  await ui.press({ key: 'i:a1' })
  const link = (await ui.findAll({ type: 'Button' })).find(b => b.text === '⇲ open /notes/todo.txt')
  expect(link).toBeDefined()
  await ui.press({ key: link!.key! })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /^milk$/ })).toBeDefined()
  await ui.unmount()
})
