const assert = require('node:assert/strict')
const test = require('node:test')

const { createContextCommandDispatcher } = require('../electron/domains/menu/context-command-dispatcher.cjs')

function fixture() {
  const copied = []
  const deliveries = []
  const shown = []
  const errors = []
  const dispatcher = createContextCommandDispatcher({
    clipboard: { writeText: (value) => copied.push(value) },
    dialog: {
      showErrorBox: (...entry) => errors.push(entry),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    getWindow: () => ({}),
    log() {},
    openProjectFileWith: async () => ({ opened: true }),
    requireActiveWorkspace: () => '/workspace',
    resolveProjectDirectory: (_workspace, relativePath) => `/workspace/${relativePath}`.replace(/\/$/u, ''),
    resolveProjectFile: (_workspace, relativePath) => `/workspace/${relativePath}`,
    sendToRenderer: (...entry) => deliveries.push(entry),
    shell: {
      openPath: async () => '',
      showItemInFolder: (value) => shown.push(value),
    },
    toPublicErrorMessage: () => 'Operazione non completata.',
  })
  return { copied, deliveries, dispatcher, errors, shown }
}

test('copia nome e percorsi del bersaglio workspace', () => {
  const { copied, dispatcher } = fixture()
  dispatcher.dispatch('workspaceEntry.copyName', 'src/app.ts', 'workspace-file')
  dispatcher.dispatch('workspaceEntry.copyRelativePath', 'src/app.ts', 'workspace-file')
  dispatcher.dispatch('workspaceEntry.copyAbsolutePath', 'src/app.ts', 'workspace-file')
  assert.deepEqual(copied, ['app.ts', 'src/app.ts', '/workspace/src/app.ts'])
})

test('rivela soltanto file Git confinati nel workspace', () => {
  const { dispatcher, errors, shown } = fixture()
  dispatcher.dispatch('gitFile.reveal', 'src/app.ts', 'git-staged-file')
  dispatcher.dispatch('gitFile.reveal', '../secret', 'git-staged-file')
  assert.deepEqual(shown, ['/workspace/src/app.ts'])
  assert.equal(errors.length, 1)
})

test('inoltra al renderer i comandi posseduti dalla feature', () => {
  const { deliveries, dispatcher } = fixture()
  dispatcher.dispatch('terminalTab.restart', 'session-id', 'terminal-tab')
  assert.deepEqual(deliveries, [['contextMenu:action', {
    command: 'terminalTab.restart',
    contextId: 'session-id',
    contextKind: 'terminal-tab',
  }]])
})
