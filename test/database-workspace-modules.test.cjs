const assert = require('node:assert/strict')
const test = require('node:test')
const { databaseSourceFiles, readDatabaseModule, readDatabaseSource } = require('./helpers/database-source.cjs')

test('DatabaseWorkspace resta un orchestratore sotto 500 righe', () => {
  const workspace = readDatabaseModule('components/database-workspace.tsx')

  assert.ok(workspace.split('\n').length < 500, 'DatabaseWorkspace deve restare sotto 500 righe')
  for (const hook of [
    'useDatabaseConnections',
    'useDatabaseExecutionGate',
    'useDatabaseQuery',
    'useDatabaseResources',
    'useDatabaseSqlEditor',
    'useDatabaseTransactions',
    'useDatabaseWorkspaceGuard',
  ]) assert.match(workspace, new RegExp(`import \\{ ${hook} \\} from '../hooks/`))

  for (const component of [
    'DatabaseConnectionDialog',
    'DatabaseExplorer',
    'DatabaseResultsPanel',
    'DatabaseToolbar',
  ]) assert.match(workspace, new RegExp(`<${component}`))
})

test('Database conserva un solo owner CodeMirror e il remount esplicito della griglia', () => {
  const database = readDatabaseSource()
  const sqlEditor = readDatabaseModule('hooks/use-database-sql-editor.ts')
  const results = readDatabaseModule('components/database-results-panel.tsx')

  assert.equal((database.match(/new EditorView\(/g) ?? []).length, 1)
  assert.match(sqlEditor, /const view = new EditorView\(/)
  assert.match(sqlEditor, /return \(\) => \{[\s\S]*?view\.destroy\(\)/)
  assert.match(results, /<DatabaseTableGrid[\s\S]*?key=\{`\$\{selectedTableName\}:\$\{tableRevision\}`\}/)
})

test('la modularizzazione Database usa solo owner canonici nella feature', () => {
  for (const expected of [
    'src/features/database/components/database-connection-dialog.tsx',
    'src/features/database/components/database-explorer.tsx',
    'src/features/database/components/database-results-panel.tsx',
    'src/features/database/components/database-toolbar.tsx',
    'src/features/database/hooks/use-database-connections.ts',
    'src/features/database/hooks/use-database-execution-gate.ts',
    'src/features/database/hooks/use-database-query.ts',
    'src/features/database/hooks/use-database-resources.ts',
    'src/features/database/hooks/use-database-sql-editor.ts',
    'src/features/database/hooks/use-database-transactions.ts',
    'src/features/database/hooks/use-database-workspace-guard.ts',
  ]) assert.ok(databaseSourceFiles.includes(expected), `owner Database mancante: ${expected}`)
})
