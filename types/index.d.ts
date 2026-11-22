export type Thread = { name: string; words: string[]; isOpen: boolean }
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

declare module 'claude-code' {
  interface PluginState {
    threads: { threads: Shaped<Thread[]>; items: Shaped<Item[]>; open1: Shaped<string>; tick: Shaped<number>; hintOff: Shaped<boolean>; adding: Shaped<boolean> }
  }
}
