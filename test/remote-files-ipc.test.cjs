const assert = require('node:assert/strict')
const test = require('node:test')

const {
  REMOTE_FILES_INVOKE_CHANNELS,
  createRemoteFilesHandlers,
  registerRemoteFilesIpc,
} = require('../electron/ipc/domains/remote-files.ipc.cjs')

const REMOTE_CASES = [
  ['remoteFiles:browse', 'browse', ['connection-1', 'directory-1']],
  ['remoteFiles:downloadAndTrack', 'downloadAndTrack', ['entry-1']],
  ['remoteFiles:downloadAs', 'downloadAs', ['entry-1']],
  ['remoteFiles:read', 'readLocal', ['file-1']],
  ['remoteFiles:preview', 'readPreview', ['file-1']],
  ['remoteFiles:saveLocal', 'saveLocal', ['file-1', 'contenuto']],
  ['remoteFiles:compare', 'compare', ['file-1']],
  ['remoteFiles:upload', 'upload', ['file-1', { force: true }]],
  ['remoteFiles:chooseAndUpload', 'chooseAndUpload', ['connection-1', 'directory-1']],
  ['remoteFiles:cancelTransfer', 'cancelTransfer', ['transfer-1']],
  ['remoteFiles:createDirectory', 'createDirectory', ['connection-1', 'directory-1', 'nuova']],
  ['remoteFiles:rename', 'rename', ['entry-1', 'nuovo.txt']],
  ['remoteFiles:remove', 'remove', ['entry-1']],
  ['remoteFiles:discard', 'discard', ['file-1', { force: true }]],
  ['remoteFiles:listTracked', 'listTracked', []],
  ['remoteFiles:revealLocal', 'revealLocal', ['file-1']],
  ['remoteFiles:cleanup', 'cleanup', [{ olderThanDays: 7 }]],
]

function remoteFilesFixture(overrides = {}) {
  const calls = []
  const registrations = new Map()
  const results = {}
  const service = {}
  for (const [, method] of REMOTE_CASES) {
    if (service[method]) continue
    results[method] = method === 'cancelTransfer' ? true : { method }
    service[method] = (...args) => {
      calls.push(['service', method, ...args])
      return results[method]
    }
  }
  Object.assign(service, overrides.service)
  const dependencies = {
    assertTrustedSender: (event) => { calls.push(['guard', event]) },
    getRemoteFileService: () => { calls.push(['service-factory']); return service },
    requireActiveWorkspace: () => { calls.push(['workspace']); return '/workspace/current' },
    ...overrides.dependencies,
  }
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(registrations.has(channel), false, `registrazione duplicata: ${channel}`)
      registrations.set(channel, handler)
    },
  }
  return { calls, dependencies, ipcMain, registrations, results }
}

test('registra il manifesto completo Remote Files senza duplicati', () => {
  const fixture = remoteFilesFixture()
  const registration = registerRemoteFilesIpc({ ipcMain: fixture.ipcMain, ...fixture.dependencies })

  assert.equal(REMOTE_CASES.length, 17)
  assert.deepEqual(REMOTE_FILES_INVOKE_CHANNELS, REMOTE_CASES.map(([channel]) => channel))
  assert.deepEqual(registration.channels, REMOTE_FILES_INVOKE_CHANNELS)
  assert.deepEqual([...fixture.registrations.keys()], REMOTE_FILES_INVOKE_CHANNELS)
})

test('tutti i canali preservano guardia, factory, workspace, argomenti e ritorno', () => {
  const fixture = remoteFilesFixture()
  const handlers = createRemoteFilesHandlers(fixture.dependencies)
  const event = { sender: { id: 42 } }

  for (const [channel, method, args] of REMOTE_CASES) {
    fixture.calls.length = 0
    const result = handlers.get(channel)(event, ...args)
    assert.deepEqual(fixture.calls, [
      ['guard', event],
      ['service-factory'],
      ['workspace'],
      ['service', method, '/workspace/current', ...args],
    ], channel)
    assert.deepEqual(
      result,
      method === 'cancelTransfer' ? { cancelled: true } : fixture.results[method],
      channel,
    )
  }
})

test('inoltra senza wrapping le Promise del service factory', async () => {
  let resolveDownload
  const download = new Promise((resolve) => { resolveDownload = resolve })
  const fixture = remoteFilesFixture({ service: { downloadAndTrack: () => download } })
  const handler = createRemoteFilesHandlers(fixture.dependencies).get('remoteFiles:downloadAndTrack')
  const operation = handler({ sender: { id: 7 } }, 'entry-1')

  assert.equal(operation, download)
  resolveDownload({ tracked: true })
  assert.deepEqual(await operation, { tracked: true })
})

test('cancelTransfer conserva anche un esito false esplicito', () => {
  const fixture = remoteFilesFixture({ service: { cancelTransfer: () => false } })
  const handler = createRemoteFilesHandlers(fixture.dependencies).get('remoteFiles:cancelTransfer')

  assert.deepEqual(handler({ sender: { id: 8 } }, 'missing-transfer'), { cancelled: false })
})

test('propaga invariati errori di guardia, factory, workspace e servizio', () => {
  const event = { sender: { id: 9 } }
  for (const [dependency, expected] of [
    ['assertTrustedSender', new Error('untrusted sender')],
    ['getRemoteFileService', new Error('factory failed')],
    ['requireActiveWorkspace', new Error('workspace missing')],
  ]) {
    const fixture = remoteFilesFixture({ dependencies: { [dependency]: () => { throw expected } } })
    const handler = createRemoteFilesHandlers(fixture.dependencies).get('remoteFiles:browse')
    assert.throws(() => handler(event, 'connection-1', 'directory-1'), (error) => error === expected)
  }

  const serviceError = new Error('browse failed')
  const serviceFixture = remoteFilesFixture({ service: { browse: () => { throw serviceError } } })
  const serviceHandler = createRemoteFilesHandlers(serviceFixture.dependencies).get('remoteFiles:browse')
  assert.throws(() => serviceHandler(event, 'connection-1', 'directory-1'), (error) => error === serviceError)
})
