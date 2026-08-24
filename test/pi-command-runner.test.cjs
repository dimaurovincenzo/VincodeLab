const assert = require('node:assert/strict')
const test = require('node:test')

const {
  PI_COMMAND_MAX_BUFFER_BYTES,
  createPiCommandRunner,
  isPiProcessAlive,
} = require('../electron/infrastructure/processes/pi-command-runner.adapter.cjs')

test('esegue Pi senza shell usando ambiente, timeout e budget espliciti', async () => {
  const calls = []
  const environment = { LANG: 'it_IT.UTF-8', PATH: '/opt/homebrew/bin:/usr/bin' }
  const runner = createPiCommandRunner({
    buildEnvironment: (executable, inherited) => ({ ...inherited, PATH: `${executable.slice(0, executable.lastIndexOf('/'))}:${inherited.PATH}` }),
    executeFile: (executable, args, options, callback) => {
      calls.push({ executable, args, options })
      callback(null, Buffer.from('ok'), '')
    },
    getEnvironment: () => environment,
    timeoutMs: 30_000,
  })

  assert.deepEqual(await runner.run('/opt/pi/bin/pi', ['install', 'owner/plugin']), {
    stdout: Buffer.from('ok'),
    stderr: '',
  })
  assert.deepEqual(calls, [{
    executable: '/opt/pi/bin/pi',
    args: ['install', 'owner/plugin'],
    options: {
      env: { LANG: 'it_IT.UTF-8', PATH: '/opt/pi/bin:/opt/homebrew/bin:/usr/bin' },
      maxBuffer: PI_COMMAND_MAX_BUFFER_BYTES,
      timeout: 30_000,
      windowsHide: true,
    },
  }])
})

test('preserva cause e segnali operativi necessari alla classificazione del dominio', async () => {
  const cause = Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT', killed: true, signal: 'SIGTERM' })
  const runner = createPiCommandRunner({
    buildEnvironment: (_executable, environment) => environment,
    executeFile: (_executable, _args, _options, callback) => callback(cause, 'stdout parziale', 'stderr parziale'),
    getEnvironment: () => ({ PATH: '/usr/bin' }),
    timeoutMs: 30_000,
  })

  await assert.rejects(runner.run('/opt/pi/bin/pi', ['install', 'npm:pkg']), (error) => {
    assert.equal(error.cause, cause)
    assert.equal(error.code, 'ENOENT')
    assert.equal(error.killed, true)
    assert.equal(error.signal, 'SIGTERM')
    assert.equal(error.stdout, 'stdout parziale')
    assert.equal(error.stderr, 'stderr parziale')
    return true
  })
})

test('espone la liveness Pi senza lasciare process nel dominio', () => {
  assert.equal(isPiProcessAlive(process.pid), true)
  assert.equal(isPiProcessAlive(0), null)
})
