const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { environmentForPi } = require('../electron/infrastructure/processes/pi-executable.adapter.cjs')

test('Pi eseguito da NVM aggiunge il proprio bin al PATH del processo', () => {
  const executable = '/Users/example/.nvm/versions/node/v24.19.0/bin/pi'
  const environment = environmentForPi(executable, { PATH: '/usr/bin:/bin', LANG: 'it_IT.UTF-8' })

  assert.equal(environment.PATH, '/Users/example/.nvm/versions/node/v24.19.0/bin:/usr/bin:/bin')
  assert.equal(environment.LANG, 'it_IT.UTF-8')
})

test('avvia Pi Config senza oscurare il processo Node globale', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/domains/ai/pi-runtime.cjs'), 'utf8')
  const startPiConfig = source.match(/function startConfig\(\) \{([\s\S]*?)\n  \}/)?.[1]

  assert.ok(startPiConfig, 'il gestore Pi Config deve esistere nel runtime AI')
  assert.doesNotMatch(startPiConfig, /const process\s*=/)
  assert.match(startPiConfig, /const ptyProcess = ptyRuntime\.spawn/)
  assert.match(startPiConfig, /env: \{ \.\.\.environmentForExecutable\(executable\), TERM: 'xterm-256color' \}/)
})
