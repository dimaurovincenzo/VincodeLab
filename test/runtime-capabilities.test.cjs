const assert = require('node:assert/strict')
const test = require('node:test')

const { getRuntimeCapabilities, probeBundledModule, resolveSystemExecutable } = require('../electron/infrastructure/system/runtime-capabilities.adapter.cjs')

test('una macchina senza Node, npm, Pi o tool esterni resta uno stato supportato', () => {
  const snapshot = getRuntimeCapabilities({
    environment: { PATH: '' },
    homeDirectory: '/home-fixture',
    herdrStatus: { available: false, reason: 'missing' },
    loadModule: () => ({}),
    piExecutable: null,
    ptyStatus: { state: 'ready' },
    resolveExecutable: () => null,
  })
  const byId = new Map(snapshot.items.map((item) => [item.id, item]))

  assert.equal(byId.get('app-runtime').state, 'ready')
  assert.match(byId.get('app-runtime').detail, /Non è richiesta un’installazione Node\/npm/u)
  assert.equal(byId.get('pi-agent').state, 'missing')
  assert.match(byId.get('pi-agent').detail, /Solo il Terminale AI resta disattivato/u)
  assert.equal(byId.get('herdr').state, 'missing')
  assert.equal(byId.get('node-system').state, 'missing')
  assert.match(byId.get('node-system').detail, /Non serve per avviare VincodeLab/u)
  assert.equal(byId.get('npm-system').state, 'missing')
  assert.equal(byId.get('git-system').state, 'missing')
  assert.ok(['database-sqlite', 'database-postgresql', 'database-mysql', 'database-sqlserver', 'redis-client'].every((id) => byId.get(id).state === 'ready'))
})

test('Herdr pronto mantiene il Terminale AI disponibile anche senza Pi locale', () => {
  const snapshot = getRuntimeCapabilities({
    environment: { PATH: '' },
    herdrStatus: { available: true, executable: '/opt/homebrew/bin/herdr' },
    homeDirectory: '/home-fixture',
    loadModule: () => ({}),
    piExecutable: null,
    resolveExecutable: () => null,
  })
  const byId = new Map(snapshot.items.map((item) => [item.id, item]))
  assert.equal(byId.get('herdr').state, 'ready')
  assert.equal(byId.get('pi-agent').state, 'missing')
  assert.match(byId.get('pi-agent').detail, /Herdr può comunque aprire la fleet/u)
  assert.doesNotMatch(byId.get('pi-agent').detail, /Terminale AI resta disattivato/u)
})

test('Herdr guasto è distinto da Herdr assente e non espone dettagli tecnici', () => {
  const snapshot = getRuntimeCapabilities({
    herdrStatus: { available: false, reason: 'invalid-version-output', technical: 'token=secret' },
    loadModule: () => ({}),
    resolveExecutable: () => null,
  })
  const herdr = snapshot.items.find((item) => item.id === 'herdr')
  assert.equal(herdr.state, 'broken')
  assert.equal(herdr.code, 'HERDR_INVALID_VERSION_OUTPUT')
  assert.doesNotMatch(herdr.detail, /secret/u)
})

test('un driver bundle mancante o incompatibile è distinto dai client di sistema', () => {
  assert.deepEqual(probeBundledModule('driver', () => { const error = new Error('missing'); error.code = 'MODULE_NOT_FOUND'; throw error }), {
    code: 'APP_INSTALLATION_INCOMPLETE',
    state: 'broken',
  })
  assert.deepEqual(probeBundledModule('driver', () => { const error = new Error('incompatible architecture'); error.code = 'ERR_DLOPEN_FAILED'; throw error }), {
    code: 'APP_RUNTIME_INCOMPATIBLE',
    state: 'broken',
  })
})

test('il resolver non tratta directory e file non eseguibili come tool disponibili', () => {
  assert.equal(resolveSystemExecutable(['vincodelab-command-that-does-not-exist'], { PATH: '' }, '/home-fixture'), null)
})

test('la modalità macchina pulita limita la ricerca al PATH isolato', () => {
  assert.equal(resolveSystemExecutable(
    ['node'],
    { PATH: '' },
    '/home-fixture',
    { includeCommonDirectories: false, includeNvm: false },
  ), null)
})
