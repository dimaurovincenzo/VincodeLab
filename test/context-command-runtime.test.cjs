const assert = require('node:assert/strict')
const test = require('node:test')

const { createContextCommandRuntime } = require('../electron/app/context-command-runtime.cjs')

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve))
}

function fixture(overrides = {}) {
  const copied = []
  const deliveries = []
  const errors = []
  const launched = []
  const logs = []
  const opened = []
  const shown = []
  const dependencies = {
    chooseApplication: async () => '/Applications/Editor.app',
    copyText: (value) => copied.push(value),
    log: (...entry) => logs.push(entry),
    openPath: async (value) => { opened.push(value); return '' },
    openProjectFileWith: async (workspacePath, fileId, { chooseApplication, openWith }) => {
      const applicationPath = await chooseApplication()
      if (applicationPath) await openWith(applicationPath, `${workspacePath}/${fileId}`)
      return { opened: Boolean(applicationPath) }
    },
    openWithApplication: async (...entry) => { launched.push(entry) },
    requireActiveWorkspace: () => '/workspace',
    resolveProjectDirectory: (_workspace, relativePath) => `/workspace/${relativePath}`.replace(/\/$/u, ''),
    resolveProjectFile: (_workspace, relativePath) => `/workspace/${relativePath}`,
    revealItem: (value) => shown.push(value),
    sendToRenderer: (...entry) => deliveries.push(entry),
    showError: (...entry) => errors.push(entry),
    toPublicErrorMessage: () => 'Operazione non completata.',
    ...overrides,
  }
  const runtime = createContextCommandRuntime(dependencies)
  return { copied, deliveries, errors, launched, logs, opened, runtime, shown }
}

test('richiede porte applicative nominate', () => {
  assert.throws(() => createContextCommandRuntime({}), /Dipendenze comandi contestuali non valide/)
})

test('copia nome e percorsi del bersaglio workspace', () => {
  const { copied, runtime } = fixture()
  runtime.dispatch('workspaceEntry.copyName', 'src/app.ts', 'workspace-file')
  runtime.dispatch('workspaceEntry.copyRelativePath', 'src/app.ts', 'workspace-file')
  runtime.dispatch('workspaceEntry.copyAbsolutePath', 'src/app.ts', 'workspace-file')
  runtime.dispatch('recentWorkspace.copyPath', '/workspace/recent', 'recent-workspace')
  runtime.dispatch('gitFile.copyPath', 'src/app.ts', 'git-staged-file')
  assert.deepEqual(copied, ['app.ts', 'src/app.ts', '/workspace/src/app.ts', '/workspace/recent', 'src/app.ts'])
})

test('rivela file, directory e workspace attraverso le porte host', async () => {
  const { opened, runtime, shown } = fixture()
  runtime.dispatch('workspaceEntry.reveal', 'src/app.ts', 'workspace-file')
  runtime.dispatch('workspaceEntry.reveal', 'src', 'workspace-directory')
  runtime.dispatch('workspaceEntry.reveal', '', 'workspace-root')
  runtime.dispatch('recentWorkspace.reveal', '/workspace/recent', 'recent-workspace')
  await flushAsyncWork()

  assert.deepEqual(shown, ['/workspace/src/app.ts', '/workspace/src'])
  assert.deepEqual(opened, ['/workspace', '/workspace/recent'])
})

test('apri con collega selezione e lancio senza conoscere processi host', async () => {
  const { launched, runtime } = fixture()
  runtime.dispatch('workspaceFile.openWith', 'src/app.ts', 'workspace-file')
  await flushAsyncWork()
  assert.deepEqual(launched, [['/Applications/Editor.app', '/workspace/src/app.ts']])
})

test('rivela soltanto file Git confinati nel workspace', () => {
  const { errors, runtime, shown } = fixture()
  runtime.dispatch('gitFile.reveal', 'src/app.ts', 'git-staged-file')
  runtime.dispatch('gitFile.reveal', '../secret', 'git-staged-file')
  assert.deepEqual(shown, ['/workspace/src/app.ts'])
  assert.deepEqual(errors, [['File non mostrato', 'Operazione non completata.']])
})

test('traduce i failure asincroni una sola volta sulla superficie nativa', async () => {
  const { errors, logs, runtime } = fixture({
    openPath: async () => 'Finder non disponibile',
    openProjectFileWith: async () => { throw new Error('open failed') },
  })
  runtime.dispatch('recentWorkspace.reveal', '/workspace/recent', 'recent-workspace')
  runtime.dispatch('workspaceFile.openWith', 'src/app.ts', 'workspace-file')
  await flushAsyncWork()

  assert.deepEqual(errors.toSorted(([left], [right]) => left.localeCompare(right)), [
    ['Impossibile aprire il file', 'Operazione non completata.'],
    ['Workspace non mostrato', 'Operazione non completata.'],
  ])
  assert.deepEqual(logs.toSorted((left, right) => left[1].localeCompare(right[1])), [
    ['error', 'recent_workspace_reveal_failed'],
    ['error', 'workspace_file_open_with_failed'],
  ].toSorted((left, right) => left[1].localeCompare(right[1])))
})

test('inoltra al renderer canale e payload dei comandi posseduti dalla feature', () => {
  const { deliveries, runtime } = fixture()
  runtime.dispatch('terminalTab.restart', 'session-id', 'terminal-tab')
  assert.deepEqual(deliveries, [['contextMenu:action', {
    command: 'terminalTab.restart',
    contextId: 'session-id',
    contextKind: 'terminal-tab',
  }]])
})
