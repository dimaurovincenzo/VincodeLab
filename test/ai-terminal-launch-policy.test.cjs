const assert = require('node:assert/strict')
const test = require('node:test')

const {
  createAiTerminalLaunchPolicy,
  createLaunchDescriptor,
} = require('../electron/domains/ai/ai-terminal-launch-policy.cjs')
const { isPublicError } = require('../electron/domains/errors/public-error.cjs')

function hasPublicCode(code) {
  return (error) => {
    assert.equal(isPublicError(error), true)
    assert.equal(error.publicCode, code)
    return true
  }
}

test('la policy del Terminale AI produce una sola sessione Pi confinata al workspace', async () => {
  const policy = createAiTerminalLaunchPolicy({
    environmentForExecutable: (executable) => ({ PATH: `/tools:${executable}` }),
    resolvePiExecutable: () => '/opt/pi/bin/pi',
  })

  const candidates = await policy.resolveCandidates('/workspace')

  assert.equal(candidates.length, 1)
  assert.deepEqual(candidates[0], createLaunchDescriptor({
    executable: '/opt/pi/bin/pi',
    workspacePath: '/workspace',
    environment: { PATH: '/tools:/opt/pi/bin/pi' },
  }))
  assert.equal(candidates[0].runtime, 'pi')
  assert.deepEqual(candidates[0].args, [])
  assert.equal(candidates[0].options.cwd, '/workspace')
  assert.equal(candidates[0].options.env.TERM, 'xterm-256color')
})

test('Pi assente o non avviabile produce errori pubblici specifici', async () => {
  const missing = createAiTerminalLaunchPolicy({
    environmentForExecutable: () => ({}),
    resolvePiExecutable: () => null,
  })
  await assert.rejects(missing.resolveCandidates('/workspace'), hasPublicCode('PI_NOT_INSTALLED'))

  const broken = createAiTerminalLaunchPolicy({
    environmentForExecutable: () => { throw new Error('ambiente non disponibile') },
    resolvePiExecutable: () => '/opt/pi/bin/pi',
  })
  await assert.rejects(broken.resolveCandidates('/workspace'), hasPublicCode('PI_NOT_RUNNABLE'))
})

test('la policy richiede soltanto i due collaboratori necessari a Pi', () => {
  assert.throws(() => createAiTerminalLaunchPolicy(), /Provider ambiente Terminale AI non valido/u)
  assert.throws(
    () => createAiTerminalLaunchPolicy({ environmentForExecutable: () => ({}) }),
    /Resolver Pi Terminale AI non valido/u,
  )
})

test('aggiunge l’estensione di stato VincodeLab senza esporre il token negli argomenti', async () => {
  const policy = createAiTerminalLaunchPolicy({
    environmentForExecutable: () => ({ PATH: '/opt/pi/bin' }),
    getStatusTransport: async () => ({ socketPath: '/tmp/vincodelab-pi.sock', token: 'token-test' }),
    resolvePiExecutable: () => '/opt/pi/bin/pi',
    statusExtensionPath: '/Applications/VincodeLab.app/Contents/Resources/pi/vincodelab-agent-status.mjs',
  })
  const [candidate] = await policy.resolveCandidates('/tmp/workspace', { sessionId: 'session-test' })
  assert.deepEqual(candidate.args, ['--extension', '/Applications/VincodeLab.app/Contents/Resources/pi/vincodelab-agent-status.mjs'])
  assert.equal(candidate.options.env.VINCODELAB_PI_SESSION_ID, 'session-test')
  assert.equal(candidate.options.env.VINCODELAB_PI_STATUS_SOCKET, '/tmp/vincodelab-pi.sock')
  assert.equal(candidate.options.env.VINCODELAB_PI_STATUS_TOKEN, 'token-test')
  assert.equal(candidate.args.includes('token-test'), false)
})
