import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

/**
 * Tema CodeMirror condiviso da Editor, Database e viste diff.
 * Usa esclusivamente semantic token CSS: il cambio light/dark/system aggiorna
 * le superfici in-place e non richiede di ricreare la vista persistente.
 */
export const graphiteHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], color: 'var(--syntax-keyword)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--syntax-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.name), tags.function(tags.variableName), tags.definition(tags.function(tags.name))], color: 'var(--syntax-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.name)], color: 'var(--syntax-type)' },
  { tag: [tags.operator, tags.operatorKeyword, tags.punctuation, tags.bracket, tags.separator], color: 'var(--syntax-operator)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--syntax-property)' },
  { tag: [tags.tagName, tags.heading, tags.link], color: 'var(--syntax-accent)' },
  { tag: [tags.name, tags.variableName, tags.labelName], color: 'var(--code-text)' },
  { tag: [tags.invalid, tags.deleted], color: 'var(--state-error)', textDecoration: 'underline' },
  { tag: [tags.inserted, tags.changed], color: 'var(--state-success)' },
  { tag: tags.meta, color: 'var(--code-muted)' },
])

export const graphiteCodeMirrorTheme: Extension = [
  EditorView.theme({
    '&': {
      backgroundColor: 'var(--code-surface)',
      color: 'var(--code-text)',
      height: '100%',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-code)',
      lineHeight: 'var(--line-height-code)',
    },
    '.cm-content': { caretColor: 'var(--code-caret)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--code-caret)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--code-selection)',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'var(--code-selection-match)',
      outline: '1px solid var(--code-selection-border)',
    },
    '.cm-activeLine': { backgroundColor: 'var(--code-active-line)' },
    '.cm-gutters': {
      backgroundColor: 'var(--code-gutter)',
      borderRight: '1px solid var(--code-line)',
      color: 'var(--code-muted)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--code-active-line)',
      color: 'var(--code-text)',
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--surface-hover)',
      border: '1px solid var(--code-line)',
      color: 'var(--text-secondary)',
    },
    '.cm-panels': {
      backgroundColor: 'var(--surface-raised)',
      color: 'var(--text-primary)',
    },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
    '.cm-searchMatch': {
      backgroundColor: 'var(--code-search-match)',
      outline: '1px solid var(--state-warning)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--code-selection)' },
    '.cm-matchingBracket': {
      backgroundColor: 'var(--code-selection-match)',
      outline: '1px solid var(--code-selection-border)',
    },
    '.cm-nonmatchingBracket': { color: 'var(--state-error)' },
    '.cm-tooltip': {
      backgroundColor: 'var(--surface-raised)',
      border: '1px solid var(--line-strong)',
      color: 'var(--text-primary)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--surface-selected)',
      color: 'var(--text-primary)',
    },
  }),
  syntaxHighlighting(graphiteHighlightStyle),
]
