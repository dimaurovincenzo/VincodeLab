import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildAuthenticationArguments,
  buildControlCommandArguments,
  buildControlMasterArguments,
  buildKnownHostsLine,
  buildSftpIsolationArguments,
  buildSshClientOptions,
  buildSshdConfig,
  createPrivacySafeReport,
  parseCliArguments,
} from '../scripts/uat-sftp-loopback.mjs'

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(TEST_DIRECTORY, '..')
const SCRIPT_PATH = path.join(ROOT, 'scripts', 'uat-sftp-loopback.mjs')
const SCENARIO_PATH = path.join(ROOT, 'scripts', 'lib', 'sftp-loopback-uat', 'scenario.mjs')
const PORT = 55_321
const FIXTURE = '/tmp/vincodelab-sftp-uat-unit'

function clientParameters(identityPath = `${FIXTURE}/keys/client`) {
  return {
    destination: 'fixture-user@127.0.0.1',
    identityPath,
    knownHostsPath: `${FIXTURE}/known-hosts`,
    port: PORT,
    socketPath: `${FIXTURE}/control.sock`,
  }
}

function passingChecks() {
  return {
    isolation: {
      highPort: true,
      hostKeyPinned: true,
      loopbackOnly: true,
      noUserSshConfiguration: true,
      nonRoot: true,
      temporaryConfig: true,
      temporaryHome: true,
    },
    authentication: { badKeyRejected: true, goodKeyAccepted: true },
    sftp: {
      cancellation: true,
      chmod: true,
      downloadHash: true,
      listing: true,
      mkdirRmdir: true,
      permissionDenied: true,
      rename: true,
      uploadHash: true,
    },
    cleanup: {
      controlMasterStopped: true,
      fixtureRemoved: true,
      noFixtureProcesses: true,
      portReleased: true,
      serviceDrained: true,
      socketRemoved: true,
      sshdStopped: true,
    },
  }
}

test('la CLI richiede un consenso esplicito prima della fixture reale', () => {
  assert.deepEqual(parseCliArguments([]), { execute: false, help: false, outputPath: null, timeoutMs: 30_000 })
  assert.deepEqual(parseCliArguments(['--run', '--timeout-ms', '45000', '--output', '.local-reports/sftp-uat.json']), {
    execute: true,
    help: false,
    outputPath: path.join(ROOT, '.local-reports', 'sftp-uat.json'),
    timeoutMs: 45_000,
  })
  assert.throws(() => parseCliArguments(['--timeout-ms', '9999']), /Timeout UAT non valido/)
  assert.throws(() => parseCliArguments(['--output']), /Percorso report non valido/)
  assert.throws(() => parseCliArguments(['--port', '22']), /Argomento non riconosciuto/)

  const guarded = spawnSync(process.execPath, [SCRIPT_PATH], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(guarded.status, 2)
  assert.equal(guarded.stdout, '')
  assert.match(guarded.stderr, /Esecuzione reale non avviata/)
})

test('sshd è confinato a loopback, porta alta, chiavi e directory temporanee', () => {
  const config = buildSshdConfig({
    authorizedKeysPath: `${FIXTURE}/authorized-keys`,
    hostKeyPath: `${FIXTURE}/keys/host`,
    pidFilePath: `${FIXTURE}/sshd.pid`,
    port: PORT,
    remoteRoot: `${FIXTURE}/remote`,
    username: 'fixture-user',
  })

  assert.match(config, new RegExp(`^Port ${PORT}$`, 'm'))
  assert.match(config, /^AddressFamily inet$/m)
  assert.match(config, /^ListenAddress 127\.0\.0\.1$/m)
  assert.match(config, new RegExp(`^HostKey "${FIXTURE}/keys/host"$`, 'm'))
  assert.match(config, new RegExp(`^AuthorizedKeysFile "${FIXTURE}/authorized-keys"$`, 'm'))
  assert.match(config, /^AuthenticationMethods publickey$/m)
  assert.match(config, /^PasswordAuthentication no$/m)
  assert.match(config, /^KbdInteractiveAuthentication no$/m)
  assert.match(config, /^UsePAM no$/m)
  assert.match(config, /^PermitRootLogin no$/m)
  assert.match(config, /^AllowTcpForwarding no$/m)
  assert.match(config, new RegExp(`^Subsystem sftp internal-sftp -d "${FIXTURE}/remote"$`, 'm'))
  assert.doesNotMatch(config, /0\.0\.0\.0|::|~\/\.ssh/u)
  assert.throws(() => buildSshdConfig({
    authorizedKeysPath: `${FIXTURE}/authorized-keys`,
    hostKeyPath: `${FIXTURE}/host`,
    pidFilePath: `${FIXTURE}/pid`,
    port: 22,
    remoteRoot: `${FIXTURE}/remote`,
    username: 'fixture-user',
  }), /Porta loopback non valida/)
})

test('il client ignora config, agent e known_hosts utente e accetta solo il target loopback', () => {
  const parameters = clientParameters()
  const options = buildSshClientOptions(parameters)
  assert.deepEqual(options.slice(0, 6), ['-F', '/dev/null', '-p', String(PORT), '-i', parameters.identityPath])
  assert.ok(options.includes('IdentitiesOnly=yes'))
  assert.ok(options.includes('IdentityAgent=none'))
  assert.ok(options.includes('BatchMode=yes'))
  assert.ok(options.includes('StrictHostKeyChecking=yes'))
  assert.ok(options.includes(`UserKnownHostsFile=${parameters.knownHostsPath}`))
  assert.ok(options.includes('GlobalKnownHostsFile=/dev/null'))
  assert.ok(!options.some((value) => value.includes('/Users/') || value.includes('~/.ssh')))

  const authentication = buildAuthenticationArguments(parameters)
  assert.deepEqual(authentication.slice(-3), ['-N', '--', parameters.destination])
  const master = buildControlMasterArguments(parameters)
  assert.ok(master.includes('ControlMaster=yes'))
  assert.ok(master.includes('ControlPersist=no'))
  assert.ok(master.includes(`ControlPath=${parameters.socketPath}`))
  const check = buildControlCommandArguments({ ...parameters, operation: 'check' })
  assert.deepEqual(check.slice(-4), ['-O', 'check', '--', parameters.destination])
  assert.throws(() => buildAuthenticationArguments({ ...parameters, destination: 'fixture-user@example.com' }), /Destinazione UAT non valida/)
})

test('l invocazione SFTP reale riceve isolamento, porta alta, pinning e limite banda', () => {
  const parameters = clientParameters()
  const serviceArguments = [
    '-q', '-b', '-', '-o', `ControlPath=${parameters.socketPath}`, '--', parameters.destination,
  ]
  const args = buildSftpIsolationArguments({ ...parameters, serviceArguments })
  assert.deepEqual(args.slice(0, 5), serviceArguments.slice(0, 5))
  assert.ok(args.includes('/dev/null'))
  assert.ok(args.includes('-P'))
  assert.equal(args[args.indexOf('-P') + 1], String(PORT))
  assert.ok(args.includes(parameters.identityPath))
  assert.ok(args.includes('8192'))
  assert.ok(args.includes('IdentitiesOnly=yes'))
  assert.ok(args.includes('IdentityAgent=none'))
  assert.ok(args.includes('BatchMode=yes'))
  assert.ok(args.includes('StrictHostKeyChecking=yes'))
  assert.ok(args.includes(`UserKnownHostsFile=${parameters.knownHostsPath}`))
  assert.ok(args.includes('GlobalKnownHostsFile=/dev/null'))
  assert.deepEqual(args.slice(-2), ['--', parameters.destination])
  assert.throws(() => buildSftpIsolationArguments({
    ...parameters,
    serviceArguments: ['-q', '--', parameters.destination],
  }), /ControlPath SFTP mancante/)
  assert.throws(() => buildSftpIsolationArguments({
    ...parameters,
    serviceArguments: ['-q', '-o', `ControlPath=${parameters.socketPath}`, '--', 'fixture-user@example.com'],
  }), /Destinazione SFTP UAT non valida/)
})

test('known_hosts è pinning esplicito della chiave host temporanea', () => {
  const key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnly vincodelab-uat'
  assert.equal(buildKnownHostsLine({ port: PORT, publicKey: key }), `[127.0.0.1]:${PORT} ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixtureOnly\n`)
  assert.throws(() => buildKnownHostsLine({ host: 'localhost', port: PORT, publicKey: key }), /Host UAT non consentito/)
  assert.throws(() => buildKnownHostsLine({ port: PORT, publicKey: 'ssh-rsa AAAA' }), /Chiave host non valida/)
})

test('il report JSON espone solo esiti, ambiente e hash ammessi', () => {
  const hash = 'a'.repeat(64)
  const report = createPrivacySafeReport({
    checks: { ...passingChecks(), injected: { path: '/Users/private/.ssh/id_ed25519' } },
    finishedAt: new Date('2026-08-22T20:00:01.000Z'),
    hashes: { seedSource: hash, secretPath: '/Users/private' },
    startedAt: new Date('2026-08-22T20:00:00.000Z'),
  })
  assert.equal(report.ok, true)
  assert.deepEqual(report.evidence.hashes, { seedSource: hash })
  const serialized = JSON.stringify(report)
  assert.doesNotMatch(serialized, /\/Users\/|\.ssh|private|fixture-user|55321/u)

  const failed = createPrivacySafeReport({
    checks: passingChecks(),
    failure: { code: 'BAD_KEY_NOT_REJECTED', stage: 'authentication-bad-key', detail: '/Users/private' },
    finishedAt: new Date('2026-08-22T20:00:01.000Z'),
    startedAt: new Date('2026-08-22T20:00:00.000Z'),
  })
  assert.deepEqual(failed.failure, { code: 'BAD_KEY_NOT_REJECTED', stage: 'authentication-bad-key' })
  assert.doesNotMatch(JSON.stringify(failed), /\/Users\/|detail|private/u)
})

test('il contratto statico usa il servizio reale e copre operazioni, cancellazione e cleanup finale', async () => {
  const source = await readFile(SCENARIO_PATH, 'utf8')
  assert.match(source, /createSftpService\(/u)
  for (const operation of ['list', 'download', 'uploadTemp', 'chmod', 'rename', 'mkdir', 'rmdir', 'remove']) {
    assert.match(source, new RegExp(`sftpService\\.${operation}\\(`, 'u'))
  }
  assert.match(source, /new AbortController\(\)/u)
  assert.match(source, /transferredBytes > 0 && transferredBytes < CANCEL_FIXTURE_BYTES/u)
  assert.match(source, /controlListingAfterDenial/u)
  assert.match(source, /sftpService\.closeAll\(\)/u)
  assert.match(source, /terminateTrackedProcess\(masterProcess\)/u)
  assert.match(source, /terminateTrackedProcess\(sshdProcess\)/u)
  assert.match(source, /rm\(fixtureRoot, \{ force: true, maxRetries: 3, recursive: true/u)
  assert.match(source, /finally \{/u)
  assert.doesNotMatch(source, /execSync|execFileSync|shell:\s*true|os\.homedir\(\)/u)
})
