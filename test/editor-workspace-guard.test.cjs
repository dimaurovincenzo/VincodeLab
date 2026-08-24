const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { readAppSource } = require('./helpers/app-source.cjs')
const { readEditorModule } = require('./helpers/editor-source.cjs')

const root = path.join(__dirname, '..')

test('l’editor espone un contratto per proteggere le modifiche durante il cambio workspace', () => {
  const contract = fs.readFileSync(path.join(root, 'src/lib/workspace-change-guard.ts'), 'utf8')
  const editor = readEditorModule('hooks/use-editor-file-persistence.ts')

  assert.match(contract, /export type WorkspaceChangeGuard/)
  assert.match(contract, /hasUnsavedChanges\(\): boolean/)
  assert.match(contract, /saveAll\(\): Promise<void>/)
  assert.match(contract, /discardAll\(\): void \| Promise<void>/)
  assert.match(editor, /onWorkspaceGuardChange/)
  assert.match(editor, /tabsRef\.current\.filter\(\(tab\) => tab\.content !== tab\.savedContent\)/)
  assert.match(editor, /await saveEditorTabById\(fileId\)/)
  assert.match(editor, /await tab\.pendingJob\.catch/)
  assert.match(editor, /content: discarded\.savedContent/)
  assert.match(editor, /await editorBridge\.files\.save\(tab\.id, tab\.savedContent, \{ revision \}\)/)
  assert.match(editor, /setDocumentFailure\(\{ error: incident, recovery: \{ kind: 'save-all' \} \}\)/)
})

test('il cambio workspace offre salvataggio, scarto e annullamento senza nascondere il rischio', () => {
  const app = readAppSource()
  const dialog = fs.readFileSync(path.join(root, 'src/components/workspace-change-dialog.tsx'), 'utf8')

  assert.match(dialog, /Salva e cambia/)
  assert.match(dialog, /Scarta e cambia/)
  assert.match(dialog, /Annulla/)
  assert.match(app, /onWorkspaceGuardChange=/)
  assert.match(app, /hasUnsavedChanges\(\)/)
  assert.match(app, /await .*\.saveAll\(\)/)
  assert.match(app, /\.discardAll\(\)/)
})
