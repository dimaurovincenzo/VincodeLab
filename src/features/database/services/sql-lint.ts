import { syntaxTree } from '@codemirror/language'
import type { Diagnostic } from '@codemirror/lint'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

const SQL_SYNTAX_ERROR = 'Sintassi SQL non valida o incompleta.'
const MAX_DIAGNOSTICS = 100

export function sqlLintDiagnostics(state: EditorState): Diagnostic[] {
  if (state.doc.length === 0) return []

  const diagnostics: Diagnostic[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (!node.type.isError || diagnostics.length >= MAX_DIAGNOSTICS) return

      // Gli errori Lezer possono essere puntuali, ad esempio una parentesi
      // mancante a fine query. Evidenziamo l'ultimo carattere utile affinché
      // il marker resti visibile senza inventare una posizione fuori documento.
      const from = node.from === node.to ? Math.max(0, node.from - 1) : node.from
      const to = node.from === node.to
        ? Math.min(state.doc.length, Math.max(node.to, from + 1))
        : node.to

      diagnostics.push({ from, to, severity: 'error', message: SQL_SYNTAX_ERROR })
    },
  })

  return diagnostics
}

export function sqlLintSource(view: EditorView): Diagnostic[] {
  return sqlLintDiagnostics(view.state)
}
