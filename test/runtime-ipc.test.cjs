const assert = require('node:assert/strict')
const test = require('node:test')

const {
  RUNTIME_INVOKE_CHANNELS,
  createRuntimeHandlers,
  registerRuntimeIpc,
} = require('../electron/ipc/domains/runtime.ipc.cjs')

function runtimeFixture(overrides = {}) {
  const calls = []
  const registrations = new Map()
  const snapshot = { checkedAt: '2026-08-24T00:00:00.000Z', items: [] }
  const dependencies = {
    assertTrustedSender: (event) => { calls.push(['guard', event]) },
    getPtyStatus: () => ({ available: true }),
    getRuntimeCapabilities: (options) => {
      calls.push(['service', options])
      return snapshot
    },
    inspectHerdr: async () => ({ available: true, executable: '/opt/homebrew/bin/herdr' }),
    resolvePiExecutable: () => '/usr/local/bin/pi',
    ...overrides,
  }
  const ipcMain = {
    handle(channel, handler) {
      assert.equal(registrations.has(channel), false, `registrazione duplicata: ${channel}`)
      registrations.set(channel, handler)
    },
  }
  return { calls, dependencies, ipcMain, registrations, snapshot }
}

test('registra una sola volta il manifesto IPC Runtime', () => {
  const fixture = runtimeFixture()
  const registration = registerRuntimeIpc({ ipcMain: fixture.ipcMain, ...fixture.dependencies })

  assert.deepEqual(RUNTIME_INVOKE_CHANNELS, ['runtime:capabilities'])
  assert.deepEqual(registration.channels, RUNTIME_INVOKE_CHANNELS)
  assert.deepEqual([...fixture.registrations.keys()], RUNTIME_INVOKE_CHANNELS)
})

test('verifica il sender prima di leggere le capability e conserva le opzioni normali', async () => {
  const fixture = runtimeFixture()
  const event = { sender: { id: 42 } }
  const handler = createRuntimeHandlers(fixture.dependencies).get('runtime:capabilities')

  assert.equal(await handler(event), fixture.snapshot)
  assert.equal(fixture.calls[0][0], 'guard')
  assert.equal(fixture.calls[0][1], event)
  assert.deepEqual(fixture.calls[1], ['service', {
    herdrStatus: { available: true, executable: '/opt/homebrew/bin/herdr' },
    piExecutable: '/usr/local/bin/pi',
    ptyStatus: { available: true },
    systemToolSearchOptions: undefined,
  }])
})

test('mantiene confinata la ricerca strumenti nello smoke clean-machine', async () => {
  const fixture = runtimeFixture({ cleanMachineSmokeMode: true })
  const handler = createRuntimeHandlers(fixture.dependencies).get('runtime:capabilities')

  await handler({ sender: { id: 1 } })
  assert.deepEqual(fixture.calls[1][1].systemToolSearchOptions, {
    includeCommonDirectories: false,
    includeNvm: false,
  })
})

test('non intercetta gli errori destinati alla boundary IPC globale', async () => {
  const expected = new Error('runtime probe failed')
  const fixture = runtimeFixture({ getRuntimeCapabilities: () => { throw expected } })
  const handler = createRuntimeHandlers(fixture.dependencies).get('runtime:capabilities')

  await assert.rejects(handler({ sender: { id: 1 } }), (error) => error === expected)
})
