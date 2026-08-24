const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { createIpcOneWayFailure, wrapIpcListener } = require('../electron/infrastructure/ipc/ipc-one-way-error.cjs')

test('converte un failure Terminale AI one-way in evento pubblico classificato', () => {
  const error = Object.assign(new Error('EPIPE token=private /Users/alice/project'), { code: 'EPIPE' })
  const failure = createIpcOneWayFailure(error, 'terminal:key')

  assert.equal(failure.eventChannel, 'terminal:error')
  assert.equal(failure.incident.domain, 'terminal')
  assert.equal(failure.payload.operation, 'key')
  assert.equal(failure.payload.recovery, 'restart')
  assert.equal(failure.payload.error.code, 'TERMINAL_INPUT_FAILED')
  assert.match(failure.payload.error.correlationId, /^ERR-[A-F0-9]{6}$/u)
  assert.doesNotMatch(JSON.stringify(failure.payload), /EPIPE|private|alice|project/u)
})

test('converte un failure piConfig one-way senza esporre la causa tecnica', () => {
  const failure = createIpcOneWayFailure(new Error('pty.resize failed password=hunter2'), 'piConfig:resize')

  assert.equal(failure.eventChannel, 'piConfig:error')
  assert.equal(failure.payload.operation, 'resize')
  assert.equal(failure.payload.recovery, 'resize')
  assert.equal(failure.payload.error.code, 'PI_CONFIG_RESIZE_FAILED')
  assert.doesNotMatch(JSON.stringify(failure.payload), /pty|password|hunter2/u)
})

test('confina eccezioni sincrone e rejection asincrone senza uncaught', async () => {
  const logs = []
  const failures = []
  const sync = wrapIpcListener('terminal:key', () => {
    throw new Error('write failed')
  }, {
    log: (...args) => logs.push(args),
    onFailure: (failure) => failures.push(failure),
  })
  const asyncListener = wrapIpcListener('appMenu:setContext', async () => {
    throw new Error('persistence failed')
  }, {
    log: (...args) => logs.push(args),
    onFailure: (failure) => failures.push(failure),
  })

  assert.doesNotThrow(() => sync({ sender: {} }, 'x'))
  assert.equal(asyncListener({ sender: {} }, {}), undefined)
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(failures.length, 2)
  assert.equal(failures[0].payload.operation, 'key')
  assert.equal(failures[1].payload, null)
  assert.equal(logs.length, 2)
  assert.ok(logs.every((entry) => entry[1] === 'ipc_listener_failed'))
  assert.ok(logs.every((entry) => /^ERR-[A-F0-9]{6}$/u.test(entry[2].correlationId)))
})

test('un errore del delivery viene confinato e registrato separatamente', () => {
  const logs = []
  const listener = wrapIpcListener('terminal:resize', () => {
    throw new Error('resize failed')
  }, {
    log: (...args) => logs.push(args),
    onFailure: () => { throw new Error('renderer gone') },
  })

  assert.doesNotThrow(() => listener({ sender: {} }, { cols: 80, rows: 24 }))
  assert.deepEqual(logs.map((entry) => entry[1]), ['ipc_listener_failed', 'ipc_listener_error_delivery_failed'])
})

test('tutti i listener ipcMain one-way sono registrati attraverso la boundary', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const domainsRoot = path.join(__dirname, '../electron/ipc/domains')
  const modulePaths = fs.readdirSync(domainsRoot)
    .filter((name) => name.endsWith('.ipc.cjs'))
    .map((name) => path.join(domainsRoot, name))
  const channelOwners = new Map()

  for (const modulePath of modulePaths) {
    const moduleExports = require(modulePath)
    const source = fs.readFileSync(modulePath, 'utf8')
    for (const [name, channels] of Object.entries(moduleExports)) {
      if (!name.endsWith('_SEND_CHANNELS') || !Array.isArray(channels)) continue
      assert.match(source, /confineIpcOneWay/)
      for (const channel of channels) {
        assert.match(source, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        assert.equal(channelOwners.has(channel), false, `owner duplicato per ${channel}`)
        channelOwners.set(channel, modulePath)
      }
    }
  }

  assert.ok(channelOwners.size > 0)
  assert.doesNotMatch(main, /ipcMain\.on\(/)
})

test('il caricamento finestra osserva la Promise e il delivery renderer resta best-effort', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
  const windowLifecycle = fs.readFileSync(path.join(__dirname, '../electron/app/window-lifecycle-runtime.cjs'), 'utf8')
  const rendererEventSender = fs.readFileSync(path.join(__dirname, '../electron/infrastructure/ipc/renderer-event-sender.cjs'), 'utf8')

  assert.match(windowLifecycle, /const loadPromise = devServerUrl[\s\S]{0,220}window\.loadURL\(devServerUrl\)[\s\S]{0,120}window\.loadFile\(/)
  assert.match(windowLifecycle, /Promise\.resolve\(loadPromise\)\.catch\(\(\) => \{[\s\S]{0,220}`did-fail-load` possiede logging e recovery/)
  assert.match(windowLifecycle, /renderer_load_start_failed[\s\S]{0,260}recoveryController\.handleLoadFailure/)
  assert.match(rendererEventSender, /function sendToRenderer[\s\S]{0,220}window\.webContents\.isDestroyed\(\)[\s\S]{0,180}try \{[\s\S]{0,160}window\.webContents\.send\(channel, payload\)/)
  assert.match(rendererEventSender, /renderer_event_delivery_failed/)
  assert.match(source, /createRendererEventSender\(\{/)
})
