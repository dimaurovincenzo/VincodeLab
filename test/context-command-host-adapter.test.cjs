const assert = require('node:assert/strict')
const test = require('node:test')

const { createContextCommandHostAdapter } = require('../electron/infrastructure/menu/context-command-host.adapter.cjs')

function fixture(overrides = {}) {
  const calls = []
  const dependencies = {
    clipboard: { writeText: (value) => calls.push(['copy', value]) },
    dialog: {
      showErrorBox: (...entry) => calls.push(['error', ...entry]),
      showOpenDialog: async (...entry) => {
        calls.push(['choose', ...entry])
        return { canceled: false, filePaths: ['/Applications/Editor.app'] }
      },
    },
    execFileImpl: (executable, args, options, callback) => {
      calls.push(['exec', executable, args, options])
      callback(null)
    },
    getWindow: () => ({ id: 'main-window' }),
    platform: 'darwin',
    shell: {
      openPath: async (value) => { calls.push(['open', value]); return '' },
      showItemInFolder: (value) => calls.push(['reveal', value]),
    },
    ...overrides,
  }
  return { adapter: createContextCommandHostAdapter(dependencies), calls }
}

test('espone soltanto operazioni host nominate e preserva il dialog Apri con', async () => {
  const { adapter, calls } = fixture()
  assert.equal(Object.isFrozen(adapter), true)
  assert.deepEqual(Object.keys(adapter), [
    'chooseApplication',
    'copyText',
    'openPath',
    'openWithApplication',
    'revealItem',
    'showError',
  ])

  assert.equal(await adapter.chooseApplication(), '/Applications/Editor.app')
  adapter.copyText('/workspace/src/app.ts')
  assert.equal(await adapter.openPath('/workspace'), '')
  adapter.revealItem('/workspace/src/app.ts')
  adapter.showError('File non mostrato', 'Operazione non completata.')
  await adapter.openWithApplication('/Applications/Editor.app', '/workspace/src/app.ts')

  assert.deepEqual(calls, [
    ['choose', { id: 'main-window' }, {
      title: 'Apri con',
      buttonLabel: 'Apri',
      defaultPath: '/Applications',
      properties: ['openFile'],
    }],
    ['copy', '/workspace/src/app.ts'],
    ['open', '/workspace'],
    ['reveal', '/workspace/src/app.ts'],
    ['error', 'File non mostrato', 'Operazione non completata.'],
    ['exec', '/usr/bin/open', ['-a', '/Applications/Editor.app', '/workspace/src/app.ts'], {
      timeout: 15_000,
      windowsHide: true,
    }],
  ])
})

test('restituisce null quando il dialog viene annullato', async () => {
  const { adapter } = fixture({
    dialog: {
      showErrorBox() {},
      showOpenDialog: async () => ({ canceled: true, filePaths: ['/Applications/Editor.app'] }),
    },
  })
  assert.equal(await adapter.chooseApplication(), null)
})

test('valida dipendenze, timeout, piattaforma e percorsi prima del processo', async () => {
  assert.throws(() => createContextCommandHostAdapter({}), /Adapter host dei comandi contestuali non valido/)
  assert.throws(() => fixture({ openTimeoutMs: 0 }), /Timeout apertura applicazione non valido/)

  const { adapter } = fixture()
  assert.throws(() => adapter.copyText(''), /Testo da copiare non valido/)
  assert.throws(() => adapter.openPath('workspace'), /Percorso da aprire non valido/)
  assert.throws(() => adapter.revealItem('../file'), /Percorso da mostrare non valido/)
  await assert.rejects(adapter.openWithApplication('/Applications/Editor', '/workspace/file'), /applicazione macOS valida/)

  const unsupported = fixture({ platform: 'linux' }).adapter
  await assert.rejects(unsupported.openWithApplication('/Applications/Editor.app', '/workspace/file'), /soltanto su macOS/)
})

test('propaga il failure bounded di usr/bin/open al runtime applicativo', async () => {
  const failure = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
  const { adapter } = fixture({
    execFileImpl: (_executable, _args, _options, callback) => callback(failure),
  })
  await assert.rejects(adapter.openWithApplication('/Applications/Editor.app', '/workspace/file'), failure)
})
