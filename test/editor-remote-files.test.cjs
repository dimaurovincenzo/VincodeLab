const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { readAppSource } = require('./helpers/app-source.cjs')
const { readEditorModule } = require('./helpers/editor-source.cjs')

test('l’editor distingue i file remoti e li salva soltanto nella cache locale', () => {
  const tabs = readEditorModule('hooks/use-editor-tabs.ts')
  const persistence = readEditorModule('hooks/use-editor-file-persistence.ts')
  const types = readEditorModule('model/editor.types.ts')
  const documentModel = readEditorModule('model/editor-document.ts')
  const bridge = readEditorModule('api/editor.bridge.ts')

  assert.match(types, /source: 'workspace' \| 'remote'/)
  assert.match(bridge, /get remoteFiles\(\)/)
  assert.match(persistence, /editorBridge\.remoteFiles\.saveLocal/)
  assert.match(documentModel, /Remoto · Modificato/)
  assert.match(tabs, /remoteOpenRequest/)
})

test('il confronto remoto usa CodeMirror MergeView e richiede un caricamento esplicito', () => {
  const dialog = fs.readFileSync(path.join(__dirname, '../src/components/remote-diff-dialog.tsx'), 'utf8')

  assert.match(dialog, /MergeView/)
  assert.match(dialog, /Carica sul server/)
  assert.match(dialog, /Forza sostituzione/)
  assert.match(dialog, /baselineChanged/)
})

test('il terminale passa il file remoto all’Editor senza perdere le viste montate', () => {
  const app = readAppSource()
  const workspace = fs.readFileSync(path.join(__dirname, '../src/features/terminal/components/terminal-workspace.tsx'), 'utf8')

  assert.match(app, /setRemoteOpenRequest/)
  assert.match(app, /<ProjectEditor[^>]*remoteOpenRequest=/)
  assert.match(app, /<TerminalWorkspace[^>]*onOpenRemoteFile=/)
  assert.match(workspace, /onOpenRemoteFile=\{onOpenRemoteFile\}/)
})
