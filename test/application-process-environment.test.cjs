const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  createApplicationProcessEnvironment,
  discoverHomebrewPrefix,
  installApplicationProcessEnvironment,
  validatedHomebrewPrefix,
} = require('../electron/infrastructure/processes/application-process-environment.adapter.cjs')

function homebrewFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vincodelab-homebrew-'))
  const bin = path.join(root, 'bin')
  const sbin = path.join(root, 'sbin')
  fs.mkdirSync(bin)
  fs.mkdirSync(sbin)
  fs.writeFileSync(path.join(bin, 'brew'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { bin, root, sbin }
}

test('rileva soltanto un prefisso Homebrew assoluto con brew eseguibile', (t) => {
  const fixture = homebrewFixture(t)
  assert.equal(validatedHomebrewPrefix(fixture.root), fs.realpathSync(fixture.root))
  assert.equal(validatedHomebrewPrefix('percorso/relativo'), null)
  assert.equal(validatedHomebrewPrefix(`${fixture.root}\0invalido`), null)

  fs.chmodSync(path.join(fixture.bin, 'brew'), 0o644)
  assert.equal(validatedHomebrewPrefix(fixture.root), null)
})

test('preferisce HOMEBREW_PREFIX valido e non esegue discovery fuori da macOS', (t) => {
  const fixture = homebrewFixture(t)
  assert.equal(discoverHomebrewPrefix({
    candidatePrefixes: ['/prefisso/inesistente'],
    environment: { HOMEBREW_PREFIX: fixture.root },
    platform: 'darwin',
  }), fs.realpathSync(fixture.root))
  assert.equal(discoverHomebrewPrefix({
    candidatePrefixes: [fixture.root],
    environment: {},
    platform: 'linux',
  }), null)
})

test('prepone bin e sbin Homebrew, elimina duplicati e non altera l input', (t) => {
  const fixture = homebrewFixture(t)
  const prefix = fs.realpathSync(fixture.root)
  const homebrewBin = path.join(prefix, 'bin')
  const homebrewSbin = path.join(prefix, 'sbin')
  const input = { LANG: 'it_IT.UTF-8', PATH: `/usr/bin:${fixture.bin}::/bin` }
  const configured = createApplicationProcessEnvironment(input, {
    candidatePrefixes: [fixture.root],
    platform: 'darwin',
  })

  assert.equal(input.PATH, `/usr/bin:${fixture.bin}::/bin`)
  assert.deepEqual(configured.pathEntries, [homebrewBin, homebrewSbin, '/usr/bin', '/bin'])
  assert.equal(configured.environment.LANG, 'it_IT.UTF-8')
  assert.equal(configured.environment.PATH, [homebrewBin, homebrewSbin, '/usr/bin', '/bin'].join(path.delimiter))
})

test('installa il PATH validato in modo idempotente e può disattivare la discovery', (t) => {
  const fixture = homebrewFixture(t)
  const prefix = fs.realpathSync(fixture.root)
  const environment = { PATH: '/usr/bin:/bin' }
  installApplicationProcessEnvironment(environment, { candidatePrefixes: [fixture.root], platform: 'darwin' })
  const firstPath = environment.PATH
  installApplicationProcessEnvironment(environment, { candidatePrefixes: [fixture.root], platform: 'darwin' })

  assert.equal(environment.PATH, firstPath)
  assert.equal(environment.PATH, [path.join(prefix, 'bin'), path.join(prefix, 'sbin'), '/usr/bin', '/bin'].join(path.delimiter))
  assert.equal(createApplicationProcessEnvironment({ PATH: '/usr/bin' }, {
    candidatePrefixes: [fixture.root],
    discoverHomebrew: false,
    platform: 'darwin',
  }).environment.PATH, '/usr/bin')
})
