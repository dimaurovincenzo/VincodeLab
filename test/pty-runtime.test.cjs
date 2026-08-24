const assert = require('node:assert/strict')
const test = require('node:test')

const { createPtyRuntime } = require('../electron/infrastructure/processes/pty-runtime.adapter.cjs')

test('il runtime PTY inoltra spawn quando il modulo incluso è pronto', () => {
  const calls = []
  const runtime = createPtyRuntime(() => ({ spawn: (...args) => { calls.push(args); return { pid: 42 } } }))
  assert.deepEqual(runtime.getStatus(), { state: 'ready' })
  assert.deepEqual(runtime.spawn('/bin/zsh', [], { cwd: '/tmp' }), { pid: 42 })
  assert.equal(calls.length, 1)
})

test('il confine PTY isola i descrittori immutabili dalle mutazioni di node-pty', () => {
  const args = Object.freeze([])
  const environment = Object.freeze({ PATH: '/usr/bin' })
  const options = Object.freeze({ cwd: '/tmp', env: environment })
  let receivedArgs
  let receivedOptions
  const runtime = createPtyRuntime(() => ({
    spawn: (_executable, nextArgs, nextOptions) => {
      receivedArgs = nextArgs
      receivedOptions = nextOptions
      nextOptions.env = { ...nextOptions.env, TERM_PROGRAM: 'node-pty' }
      return { pid: 43 }
    },
  }))

  assert.deepEqual(runtime.spawn('/bin/zsh', args, options), { pid: 43 })
  assert.notEqual(receivedArgs, args)
  assert.notEqual(receivedOptions, options)
  assert.notEqual(receivedOptions.env, environment)
  assert.deepEqual(options, { cwd: '/tmp', env: { PATH: '/usr/bin' } })
  assert.equal(receivedOptions.env.TERM_PROGRAM, 'node-pty')
})

test('un modulo PTY mancante degrada terminali senza errore raw', () => {
  const runtime = createPtyRuntime(() => { const error = new Error('/Users/private/node-pty missing'); error.code = 'MODULE_NOT_FOUND'; throw error })
  assert.deepEqual(runtime.getStatus(), { state: 'broken', code: 'PTY_RUNTIME_UNAVAILABLE' })
  assert.throws(() => runtime.spawn('/bin/zsh', [], {}), (error) => {
    assert.equal(error.publicCode, 'PTY_RUNTIME_UNAVAILABLE')
    assert.match(error.publicMessage, /Gli altri strumenti restano utilizzabili/u)
    assert.doesNotMatch(error.publicMessage, /Users|node-pty/u)
    return true
  })
})

test('un binding PTY dell’architettura errata espone recovery di reinstallazione', () => {
  const runtime = createPtyRuntime(() => { const error = new Error('incompatible architecture'); error.code = 'ERR_DLOPEN_FAILED'; throw error })
  assert.deepEqual(runtime.getStatus(), { state: 'broken', code: 'PTY_RUNTIME_INCOMPATIBLE' })
})
