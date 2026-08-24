const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const test = require('node:test')

const { launchWorkspaceInstance, readWorkspaceArgument } = require('../electron/infrastructure/processes/instance-launcher.adapter.cjs')

test('legge un unico argomento workspace assoluto', () => {
  assert.equal(readWorkspaceArgument(['electron', '.', '--workspace', '/tmp/a']), '/tmp/a')
  assert.equal(readWorkspaceArgument(['VincodeLab', '--workspace']), null)
  assert.equal(readWorkspaceArgument(['VincodeLab', '--workspace', 'relativo']), null)
  assert.equal(readWorkspaceArgument(['VincodeLab', '--workspace', '/tmp/a', '--workspace', '/tmp/b']), null)
  assert.equal(readWorkspaceArgument(['VincodeLab', '--workspace', `/${'x'.repeat(4_096)}`]), null)
})

test('avvia il bundle senza shell e preserva gli spazi nel percorso', async () => {
  const calls = []
  let unrefCalled = false
  const spawn = (...args) => {
    calls.push(args)
    const child = new EventEmitter()
    child.unref = () => { unrefCalled = true }
    queueMicrotask(() => child.emit('spawn'))
    return child
  }

  const result = await launchWorkspaceInstance({
    executable: '/Applications/VincodeLab.app/Contents/MacOS/VincodeLab',
    appPath: '/Applications/VincodeLab.app/Contents/Resources/app.asar',
    packaged: true,
    workspacePath: '/tmp/a b',
    spawn,
  })

  assert.deepEqual(result, { launched: true })
  assert.deepEqual(calls[0], [
    '/Applications/VincodeLab.app/Contents/MacOS/VincodeLab',
    ['--workspace', '/tmp/a b'],
    { detached: true, stdio: 'ignore' },
  ])
  assert.equal(unrefCalled, true)
})

test('in sviluppo passa il percorso app a Electron', async () => {
  const calls = []
  const spawn = (...args) => {
    calls.push(args)
    const child = new EventEmitter()
    child.unref = () => {}
    queueMicrotask(() => child.emit('spawn'))
    return child
  }

  await launchWorkspaceInstance({
    executable: '/node_modules/.bin/electron',
    appPath: '/workspace/VincodeLab',
    packaged: false,
    workspacePath: '/tmp/project',
    spawn,
  })

  assert.deepEqual(calls[0], [
    '/node_modules/.bin/electron',
    ['/workspace/VincodeLab', '--workspace', '/tmp/project'],
    { detached: true, stdio: 'ignore' },
  ])
})

test('riporta al chiamante un errore asincrono prima della conferma di spawn', async () => {
  const failure = new Error('spawn EACCES')
  let unrefCalled = false
  const child = new EventEmitter()
  child.unref = () => { unrefCalled = true }

  const launch = launchWorkspaceInstance({
    executable: '/Applications/VincodeLab.app/Contents/MacOS/VincodeLab',
    appPath: '/Applications/VincodeLab.app/Contents/Resources/app.asar',
    packaged: true,
    workspacePath: '/tmp/project',
    spawn: () => {
      queueMicrotask(() => child.emit('error', failure))
      return child
    },
  })

  await assert.rejects(launch, (error) => error === failure)
  assert.equal(unrefCalled, false)
  assert.equal(child.listenerCount('spawn'), 0)
})

test('rende osservabile un errore del child successivo alla conferma di spawn', async () => {
  const firstFailure = new Error('process channel failed')
  const secondFailure = new Error('process channel failed again')
  const reported = []
  const child = new EventEmitter()
  child.unref = () => {}

  const launch = launchWorkspaceInstance({
    executable: '/Applications/VincodeLab.app/Contents/MacOS/VincodeLab',
    appPath: '/Applications/VincodeLab.app/Contents/Resources/app.asar',
    packaged: true,
    workspacePath: '/tmp/project',
    spawn: () => {
      queueMicrotask(() => child.emit('spawn'))
      return child
    },
    onPostLaunchError: (error) => reported.push(error),
  })

  assert.deepEqual(await launch, { launched: true })
  child.emit('error', firstFailure)
  child.emit('error', secondFailure)
  assert.deepEqual(reported, [firstFailure, secondFailure])
})
