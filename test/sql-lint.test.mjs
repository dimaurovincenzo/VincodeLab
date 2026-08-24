import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { EditorState } from '@codemirror/state'
import { MSSQL, sql } from '@codemirror/lang-sql'

import { sqlLintDiagnostics } from '../src/lib/sql-lint.ts'

test('il lint SQL segnala la sintassi incompleta senza errori sulle query valide', () => {
  const valid = EditorState.create({ doc: 'SELECT 1 AS risultato', extensions: [sql({ dialect: MSSQL })] })
  const invalid = EditorState.create({ doc: 'SELECT * FROM dbo.Users WHERE (id = 1', extensions: [sql({ dialect: MSSQL })] })

  assert.deepEqual(sqlLintDiagnostics(valid), [])
  assert.deepEqual(sqlLintDiagnostics(invalid), [{
    from: 36,
    to: 37,
    severity: 'error',
    message: 'Sintassi SQL non valida o incompleta.',
  }])
})

test('l editor Database abilita tema Graphite, dialetto persistente e diagnostica CodeMirror', () => {
  const component = fs.readFileSync(path.join(import.meta.dirname, '../src/features/database/hooks/use-database-sql-editor.ts'), 'utf8')

  assert.match(component, /graphiteCodeMirrorTheme/)
  assert.match(component, /sqlLanguageCompartment\.current\.of/)
  assert.match(component, /sqlLanguageCompartment\.current\.reconfigure/)
  assert.match(component, /linter\(sqlLintSource/)
  assert.match(component, /lintGutter\(\)/)
})
