// Refs: a way to point at something the pane holds from the prompt box, without pasting it.
// A ref is a short token, ‹kind:id›. A button puts one in the prompt box; when the prompt is sent,
// each token is resolved to its body and handed to the model as context the person does not see.
// This file knows nothing about what the kinds are and never touches the engine: the caller reads
// its own state and passes one lookup for each kind. To make a new kind of thing pointable, add
// its lookup to that table (refKinds in register.tsx) and give its row a button that fills
// refLine(kind, id, label).
export type RefLookup = (id: string) => string | undefined
export type RefKinds = Record<string, RefLookup>

const TOKEN = /‹([a-z][a-z0-9-]*):([^›\s]+)›/g

export const refToken = (kind: string, id: string) => '‹' + kind + ':' + id + '›'
// The line a button puts in the prompt box: the token, then a label so the person can tell refs apart.
export const refLine = (kind: string, id: string, label?: string) => '⟜ threads › ' + refToken(kind, id) + (label ? ' "' + label + '"' : '')
// Text with each token replaced by a mark, for titles and other places a raw id is noise.
export const stripRefs = (text: string, mark = '') => text.replace(TOKEN, mark)
export const hasRefs = (text: string) => text.includes('‹') && stripRefs(text) !== text

// One context block for each distinct token of a known kind in the text, in the order they appear.
// A token whose thing is gone still gets a block saying so, so the model does not guess at it.
export function resolveRefs(text: string, kinds: RefKinds): string[] {
  const seen = new Set<string>(), out: string[] = []
  for (const m of text.matchAll(TOKEN)) {
    const kind = m[1] || '', id = m[2] || '', lookup = kinds[kind]
    if (!lookup || seen.has(m[0])) continue
    seen.add(m[0])
    out.push(lookup(id) ?? 'Threads mod: ' + m[0] + ' points at a ' + kind + ' that is no longer in the threads pane. Say so if the prompt depends on it.')
  }
  return out
}
