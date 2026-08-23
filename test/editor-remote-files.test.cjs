const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('l’editor distingue i file remoti e li salva soltanto nella cache locale', () => {
  const editor = fs.readFileSync(path.join(__dirname, '../src/components/project-editor.tsx'), 'utf8')

  assert.match(editor, /source: 'workspace' \| 'remote'/)
  assert.match(editor, /window\.vincodeLab\.remoteFiles\.saveLocal/)
  assert.match(editor, /Remoto · Modificato/)
  assert.match(editor, /remoteOpenRequest/)
})

test('il confronto remoto usa CodeMirror MergeView e richiede un caricamento esplicito', () => {
  const dialog = fs.readFileSync(path.join(__dirname, '../src/components/remote-diff-dialog.tsx'), 'utf8')

  assert.match(dialog, /MergeView/)
  assert.match(dialog, /Carica sul server/)
  assert.match(dialog, /Forza sostituzione/)
  assert.match(dialog, /baselineChanged/)
})

test('il terminale passa il file remoto all’Editor senza perdere le viste montate', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8')
  const workspace = fs.readFileSync(path.join(__dirname, '../src/components/terminal-workspace.tsx'), 'utf8')

  assert.match(app, /setRemoteOpenRequest/)
  assert.match(app, /<ProjectEditor[^>]*remoteOpenRequest=/)
  assert.match(app, /<TerminalWorkspace[^>]*onOpenRemoteFile=/)
  assert.match(workspace, /onOpenRemoteFile=\{onOpenRemoteFile\}/)
})
