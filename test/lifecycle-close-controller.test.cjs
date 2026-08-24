const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { createLifecycleCloseController } = require('../electron/app/lifecycle-close-controller.cjs')

function createFixture() {
  const sent = []
  const proceeded = []
  const cancelled = []
  const timedOut = []
  const timers = []
  let requestOrdinal = 0
  const controller = createLifecycleCloseController({
    sendRequest: (request) => sent.push(request),
    onProceed: (reason) => proceeded.push(reason),
    onCancel: (reason) => cancelled.push(reason),
    onTimeout: (request) => timedOut.push(request),
    timeoutMs: 100,
    createRequestId: () => `request-${++requestOrdinal}`,
    setTimer: (callback) => {
      const timer = { callback, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer) => { timer.cleared = true },
  })
  return {
    cancelled,
    controller,
    fireTimer(index) {
      const timer = timers[index]
      if (!timer.cleared) timer.callback()
    },
    proceeded,
    sent,
    timedOut,
  }
}

test('coalesca richieste duplicate e promuove window a quit senza doppio proceed', () => {
  const fixture = createFixture()
  const first = fixture.controller.request('window')
  assert.deepEqual(fixture.controller.request('window'), first)
  assert.deepEqual(fixture.sent, [first])

  const upgraded = fixture.controller.request('quit')
  assert.deepEqual(upgraded, { requestId: first.requestId, reason: 'quit' })
  assert.deepEqual(fixture.controller.request('quit'), upgraded)
  assert.deepEqual(fixture.sent, [first, upgraded])

  assert.equal(fixture.controller.respondRenderer({ requestId: first.requestId, decision: 'proceed' }), true)
  assert.equal(fixture.controller.respondRenderer({ requestId: first.requestId, decision: 'proceed' }), false)
  assert.deepEqual(fixture.proceeded, ['quit'])
  assert.deepEqual(fixture.cancelled, [])
})

test('rifiuta risposte stale, malformate o con requestId non corrispondente e accetta cancel', () => {
  const fixture = createFixture()
  const first = fixture.controller.request('window')

  assert.equal(fixture.controller.respondRenderer({ requestId: first.requestId, decision: 'proceed', extra: true }), false)
  assert.equal(fixture.controller.respondRenderer({ requestId: 'spoofed-request', decision: 'proceed' }), false)
  assert.equal(fixture.controller.respondRenderer({ requestId: first.requestId, decision: 'unknown' }), false)
  assert.equal(fixture.controller.respondRenderer({ requestId: first.requestId, decision: 'cancel' }), true)
  assert.deepEqual(fixture.cancelled, ['window'])
  assert.deepEqual(fixture.proceeded, [])

  const second = fixture.controller.request('quit')
  assert.notEqual(second.requestId, first.requestId)
  assert.equal(fixture.controller.respondRenderer({ requestId: first.requestId, decision: 'proceed' }), false)
  assert.deepEqual(fixture.controller.getPending(), { ...second, phase: 'waiting' })
  fixture.controller.dispose()
})

test('il timeout resta fail-closed finché una scelta nativa esplicita non risolve la richiesta', async () => {
  const fixture = createFixture()
  const first = fixture.controller.request('window')
  fixture.fireTimer(0)
  await Promise.resolve()

  assert.deepEqual(fixture.timedOut, [first])
  assert.deepEqual(fixture.proceeded, [])
  assert.deepEqual(fixture.controller.getPending(), { ...first, phase: 'timed-out' })
  assert.equal(fixture.controller.respondRenderer({ requestId: first.requestId, decision: 'proceed' }), false)
  assert.equal(fixture.controller.respondTimeout('spoofed-request', 'proceed'), false)
  assert.equal(fixture.controller.respondTimeout(first.requestId, 'cancel'), true)
  assert.deepEqual(fixture.cancelled, ['window'])

  const second = fixture.controller.request('quit')
  fixture.fireTimer(1)
  await Promise.resolve()
  assert.deepEqual(fixture.proceeded, [])
  assert.equal(fixture.controller.respondTimeout(second.requestId, 'proceed'), true)
  assert.deepEqual(fixture.proceeded, ['quit'])
})

test('main e preload confinano la handshake e non aprono il workspace direttamente dal menu', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const shutdownRuntime = fs.readFileSync(path.join(__dirname, '../electron/app/application-shutdown-runtime.cjs'), 'utf8')
  const menuFeedbackRuntime = fs.readFileSync(path.join(__dirname, '../electron/app/application-menu-feedback-runtime.cjs'), 'utf8')
  const windowLifecycle = fs.readFileSync(path.join(__dirname, '../electron/app/window-lifecycle-runtime.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(__dirname, '../electron/preload.cjs'), 'utf8')
  const menu = fs.readFileSync(path.join(__dirname, '../electron/domains/menu/application-menu.cjs'), 'utf8')
  const lifecycleBenchmarkIpc = fs.readFileSync(path.join(__dirname, '../electron/ipc/domains/lifecycle-benchmark.ipc.cjs'), 'utf8')

  assert.match(windowLifecycle, /window\.on\('close'[\s\S]*event\.preventDefault\(\)[\s\S]*windowCloseCoordinator\.isPending\(\)[\s\S]*lifecycleCloseGuard\.request\('window'\)/)
  assert.match(shutdownRuntime, /app\.on\('before-quit'[\s\S]*event\.preventDefault\(\)[\s\S]*lifecycleCloseGuard\.request\('quit'\)/)
  assert.match(main, /registerLifecycleBenchmarkIpc\(\{/)
  assert.match(lifecycleBenchmarkIpc, /lifecycle:closeResponse[\s\S]{0,360}assertTrustedSender\(event\)/)
  assert.match(windowLifecycle, /buttons: \['Resta aperto', 'Chiudi comunque'\][\s\S]*defaultId: 0[\s\S]*cancelId: 0/)
  assert.match(windowLifecycle, /createWindowCloseCoordinator\(\{[\s\S]*cleanupWorkspaceRuntime\(workspacePath, 'window-close'\)[\s\S]*allowWindowCloseOnce = true[\s\S]*window\.close\(\)/)
  assert.match(windowLifecycle, /buttons: \['Resta aperto', 'Riprova chiusura'\][\s\S]*defaultId: 0[\s\S]*cancelId: 0/)
  assert.match(windowLifecycle, /createRendererRecoveryController\(\{[\s\S]*Ricarica interfaccia[\s\S]*window\.webContents\.reload\(\)/)
  assert.match(preload, /respondToClose: \(requestId, decision\) => ipcRenderer\.send\('lifecycle:closeResponse'/)
  assert.match(preload, /ipcRenderer\.on\('lifecycle:closeRequested'/)
  assert.match(menu, /commandItem\(\{ label: 'Apri cartella…', command: 'workspace\.open'[\s\S]*onCommand\)/)
  assert.match(main, /createApplicationMenuFeedbackRuntime\(\{/)
  assert.doesNotMatch(menuFeedbackRuntime, /chooseAndOpenWorkspace|openWorkspaceForRenderer|showOpenDialog/)
})
