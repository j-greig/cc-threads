export type Thread = { name: string; words: string[]; isOpen: boolean; openedAt?: number }
export type Item = {
  id: string
  thread: string
  title: string
  status: 'running' | 'done' | 'failed'
  started: number
  ended?: number
  report?: string
  full?: string
  seen: boolean
  notes?: string[]
  step?: string
  steps?: number
  bubbleAt?: number
  trail?: string[]
  summary?: string
}
// A sidecar: one side question and its answer, kept beside the chat and outside the drawers.
// via 'fork': asked with /sidecar and answered by a fork of the conversation. via 'inbox': filed through inbox.json.
// gone: removed by the person; an inbox-filed one stays as a hidden marker so the inbox does not file it again.
export type Sidecar = {
  id: string
  question: string
  status: 'asking' | 'done' | 'failed'
  asked: number
  answered?: number
  answer?: string
  error?: string
  isOpen: boolean
  seen: boolean
  via: 'fork' | 'inbox'
  gone?: boolean
}

// A file open in the pane's file section: a .md or plain-text file read from disk, shown rendered or edited.
// text: the file as last read or saved. draft: the edit in progress; unsaved while it differs from text.
export type FileView = {
  path: string
  text: string
  draft?: string
  isEditing: boolean
  isOpen: boolean
  opened: number
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    threads: { threads: Shaped<Thread[]>; items: Shaped<Item[]>; open1: Shaped<string>; tick: Shaped<number>; hintOff: Shaped<boolean>; adding: Shaped<boolean>; renaming: Shaped<string>; sidecars: Shaped<Sidecar[]>; asking: Shaped<boolean>; files: Shaped<FileView[]> }
  }
}
