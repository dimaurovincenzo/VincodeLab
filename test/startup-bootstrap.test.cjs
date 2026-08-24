const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const { classifyStartupLoadFailure } = require('../electron/app/startup-bootstrap-guard.cjs')

test('il bootstrap installa la gestione fatal prima di caricare il main applicativo', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'app', 'bootstrap.cjs'), 'utf8')
  assert.equal(manifest.main, 'electron/app/bootstrap.cjs')
  const uncaughtHandler = source.indexOf("process.on('uncaughtException'")
  const rejectionHandler = source.indexOf("process.on('unhandledRejection'")
  assert.ok(uncaughtHandler < source.indexOf("require('../main.cjs')"))
  assert.ok(rejectionHandler < source.indexOf("require('../main.cjs')"))
  for (const protectedModule of [
    "require('./fatal-error-experience.cjs')",
    "require('../infrastructure/logging/logger.adapter.cjs')",
    "require('./startup-bootstrap-guard.cjs')",
  ]) {
    assert.ok(uncaughtHandler < source.indexOf(protectedModule), `${protectedModule} deve essere caricato dopo gli handler di emergenza`)
  }
  assert.doesNotMatch(source.slice(0, uncaughtHandler), /require\('\.\//u)
  assert.match(source, /createEmergencyFatalExperience/u)
  assert.match(source, /Node, npm e i client database di sistema non possono riparare/u)
  assert.doesNotMatch(source, /node-pty|better-sqlite3/u)
})

test('il main inizializza le dipendenze di cleanup prima di comporre i runtime', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
  const shellCleanup = source.indexOf('const closeShellSessions = shellSessionRuntime.closeSessions')
  const workspaceCleanup = source.indexOf('createWorkspaceRuntimeCleanup({')

  assert.ok(shellCleanup >= 0)
  assert.ok(workspaceCleanup >= 0)
  assert.ok(shellCleanup < workspaceCleanup, 'closeShellSessions non deve essere letto nella temporal dead zone')
})

test('un bundle incompleto o dell’architettura errata produce messaggi reinstallabili e sanitizzati', () => {
  const missing = new Error("Cannot find module '/Users/alice/private/better-sqlite3'")
  missing.code = 'MODULE_NOT_FOUND'
  const missingFailure = classifyStartupLoadFailure(missing)
  assert.equal(missingFailure.publicCode, 'APP_INSTALLATION_INCOMPLETE')
  assert.match(missingFailure.publicMessage, /Node, npm e i client database di sistema non risolvono/u)
  assert.doesNotMatch(missingFailure.publicMessage, /alice|better-sqlite3/u)

  const incompatible = new Error('dlopen incompatible architecture arm64')
  incompatible.code = 'ERR_DLOPEN_FAILED'
  const incompatibleFailure = classifyStartupLoadFailure(incompatible)
  assert.equal(incompatibleFailure.publicCode, 'APP_RUNTIME_INCOMPATIBLE')
  assert.match(incompatibleFailure.publicMessage, /pacchetto corretto per questo Mac/u)
  assert.equal(classifyStartupLoadFailure(new Error('normale errore applicativo')), null)
})

test('un modulo di supporto mancante viene confinato dal bootstrap di emergenza', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'app', 'bootstrap.cjs'), 'utf8')
  const events = []
  let dialogOptions
  const app = {
    exit: (code) => { events.push(`exit:${code}`) },
    whenReady: () => Promise.resolve(),
  }
  const context = {
    Date,
    Math,
    Symbol,
    globalThis: {},
    process: {
      on: (event) => { events.push(`handler:${event}`) },
    },
    require: (moduleId) => {
      events.push(`require:${moduleId}`)
      if (moduleId === 'electron') return {
        app,
        clipboard: { writeText: () => undefined },
        dialog: {
          showMessageBox: async (options) => {
            dialogOptions = options
            return { response: 0 }
          },
        },
      }
      const error = new Error("Cannot find module '/Users/private/secret-runtime'")
      error.code = 'MODULE_NOT_FOUND'
      throw error
    },
  }

  vm.runInNewContext(source, context)
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))

  assert.ok(events.indexOf('handler:uncaughtException') < events.indexOf('require:./fatal-error-experience.cjs'))
  assert.equal(dialogOptions.title, 'Installazione da riparare')
  assert.match(dialogOptions.message, /installazione di VincodeLab è incompleta/u)
  assert.match(dialogOptions.detail, /Node, npm e i client database di sistema non possono riparare/u)
  assert.doesNotMatch(`${dialogOptions.message} ${dialogOptions.detail}`, /private|secret-runtime|Cannot find module/u)
  assert.ok(events.includes('exit:1'))
})
