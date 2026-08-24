import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import {
  buildAuthenticationArguments,
  buildControlMasterArguments,
  buildKnownHostsLine,
  buildSftpIsolationArguments,
  buildSshClientOptions,
  buildSshdConfig,
  CANCEL_FIXTURE_BYTES,
  DEFAULT_TIMEOUT_MS,
  FIXTURE_PREFIX,
  LOOPBACK_HOST,
  MINIMUM_HIGH_PORT,
  SFTP_PATH,
  SSH_KEYGEN_PATH,
  SSH_PATH,
  SSHD_PATH,
  validateUsername,
} from './config-builders.mjs'
import {
  canConnect,
  collectDescendantPids,
  isolatedEnvironment,
  killExactPids,
  processAlive,
  processGroupAlive,
  reserveHighLoopbackPort,
  runCommand,
  startTrackedProcess,
  stopControlMaster,
  terminateTrackedProcess,
  waitForCondition,
  waitForControlMaster,
  waitForSshd,
} from './process-runtime.mjs'
import {
  allChecksPassed,
  createPrivacySafeReport,
  ensure,
  fail,
  initialChecks,
  UatFailure,
} from './report.mjs'

const require = createRequire(import.meta.url)
const { createSftpService } = require('../../../electron/infrastructure/remote/sftp-service.adapter.cjs')

async function pathExists(targetPath) {
  try {
    await lstat(targetPath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function sha256File(targetPath) {
  const content = await readFile(targetPath)
  return createHash('sha256').update(content).digest('hex')
}

export async function runLoopbackUat({ timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}) {
  const startedAt = new Date()
  const checks = initialChecks()
  const hashes = {}
  let activeStage = 'preflight'
  let failure
  let fixtureRoot
  let socketPath
  let port
  let sshdProcess
  let masterProcess
  let sftpService
  let controlParameters
  let environment
  let readOnlyDirectory
  const activeSftpPids = new Set()
  const trackedFixturePids = new Set()
  const trackPid = (pid) => { if (Number.isInteger(pid) && pid > 1 && pid !== process.pid) trackedFixturePids.add(pid) }
  const untrackPid = (pid) => { trackedFixturePids.delete(pid) }
  const processTracking = { onExit: untrackPid, onSpawn: trackPid }
  let sftpSpawnCount = 0

  try {
    if (process.platform !== 'darwin') fail(activeStage, 'MACOS_REQUIRED')
    if (typeof process.getuid !== 'function' || process.getuid() === 0) fail(activeStage, 'NON_ROOT_ACCOUNT_REQUIRED')
    checks.isolation.nonRoot = true
    for (const executable of [SSH_PATH, SFTP_PATH, SSH_KEYGEN_PATH, SSHD_PATH]) await access(executable, fsConstants.X_OK)

    const username = validateUsername(os.userInfo().username)
    port = await reserveHighLoopbackPort()
    checks.isolation.highPort = port >= MINIMUM_HIGH_PORT
    checks.isolation.loopbackOnly = true

    activeStage = 'fixture'
    fixtureRoot = await mkdtemp(FIXTURE_PREFIX)
    ensure(fixtureRoot.startsWith(FIXTURE_PREFIX), activeStage, 'UNSAFE_FIXTURE_ROOT')
    await chmod(fixtureRoot, 0o700)
    const clientHome = path.join(fixtureRoot, 'client-home')
    const temporaryPath = path.join(fixtureRoot, 'tmp')
    const keysPath = path.join(fixtureRoot, 'keys')
    const configPath = path.join(fixtureRoot, 'sshd-config')
    const pidFilePath = path.join(fixtureRoot, 'sshd.pid')
    const knownHostsPath = path.join(fixtureRoot, 'known-hosts')
    const authorizedKeysPath = path.join(fixtureRoot, 'authorized-keys')
    const remoteDirectory = path.join(fixtureRoot, 'remote')
    const localDirectory = path.join(fixtureRoot, 'local')
    const workspaceDirectory = path.join(fixtureRoot, 'workspace')
    socketPath = path.join(fixtureRoot, 'control.sock')
    ensure(Buffer.byteLength(socketPath) < 90, activeStage, 'CONTROL_SOCKET_PATH_TOO_LONG')
    await Promise.all([
      mkdir(clientHome, { mode: 0o700 }),
      mkdir(temporaryPath, { mode: 0o700 }),
      mkdir(keysPath, { mode: 0o700 }),
      mkdir(remoteDirectory, { mode: 0o700 }),
      mkdir(localDirectory, { mode: 0o700 }),
      mkdir(workspaceDirectory, { mode: 0o700 }),
    ])
    const canonicalRemoteRoot = await realpath(remoteDirectory)
    const canonicalWorkspace = await realpath(workspaceDirectory)
    environment = isolatedEnvironment(clientHome, temporaryPath, username)
    checks.isolation.temporaryHome = environment.HOME.startsWith(fixtureRoot)
    checks.isolation.temporaryConfig = configPath.startsWith(fixtureRoot)

    const hostKeyPath = path.join(keysPath, 'host-ed25519')
    const goodKeyPath = path.join(keysPath, 'client-good-ed25519')
    const badKeyPath = path.join(keysPath, 'client-bad-ed25519')
    for (const [keyPath, comment] of [
      [hostKeyPath, 'vincodelab-sftp-uat-host'],
      [goodKeyPath, 'vincodelab-sftp-uat-good'],
      [badKeyPath, 'vincodelab-sftp-uat-bad'],
    ]) {
      const keygen = await runCommand(SSH_KEYGEN_PATH, ['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', keyPath], {
        env: environment,
        ...processTracking,
        signal,
        timeoutMs,
      })
      ensure(keygen.code === 0 && !keygen.timedOut && !keygen.aborted, activeStage, 'KEY_GENERATION_FAILED')
    }

    const goodPublicKey = await readFile(`${goodKeyPath}.pub`, 'utf8')
    const hostPublicKey = await readFile(`${hostKeyPath}.pub`, 'utf8')
    const [goodKeyType, goodKeyData] = goodPublicKey.trim().split(/\s+/u)
    ensure(goodKeyType === 'ssh-ed25519' && Boolean(goodKeyData), activeStage, 'CLIENT_PUBLIC_KEY_INVALID')
    await writeFile(authorizedKeysPath, `${goodKeyType} ${goodKeyData} vincodelab-sftp-uat\n`, { mode: 0o600 })
    await writeFile(knownHostsPath, buildKnownHostsLine({ port, publicKey: hostPublicKey }), { mode: 0o600 })
    checks.isolation.hostKeyPinned = true

    const destination = `${username}@${LOOPBACK_HOST}`
    const goodOptions = buildSshClientOptions({ port, identityPath: goodKeyPath, knownHostsPath })
    const isolatedSftpOptions = buildSftpIsolationArguments({
      identityPath: goodKeyPath,
      knownHostsPath,
      port,
      serviceArguments: ['-q', '-b', '-', '-o', `ControlPath=${socketPath}`, '--', destination],
    })
    checks.isolation.noUserSshConfiguration = [goodOptions, isolatedSftpOptions].every((options) => options.includes('/dev/null')
      && options.includes('IdentityAgent=none')
      && options.some((value) => value.startsWith('UserKnownHostsFile=') && value.endsWith(knownHostsPath)))

    await writeFile(configPath, buildSshdConfig({
      authorizedKeysPath,
      hostKeyPath,
      pidFilePath,
      port,
      remoteRoot: canonicalRemoteRoot,
      username,
    }), { mode: 0o600 })

    activeStage = 'sshd-startup'
    const configValidation = await runCommand(SSHD_PATH, ['-t', '-f', configPath], {
      env: environment,
      ...processTracking,
      signal,
      timeoutMs,
    })
    ensure(configValidation.code === 0 && !configValidation.timedOut && !configValidation.aborted, activeStage, 'SSHD_CONFIG_INVALID')
    sshdProcess = startTrackedProcess(SSHD_PATH, ['-D', '-e', '-f', configPath], { env: environment })
    trackPid(sshdProcess.pid)
    ensure(await waitForSshd(port, sshdProcess, timeoutMs, signal), activeStage, 'SSHD_NOT_READY')

    activeStage = 'authentication-bad-key'
    const badAuthentication = await runCommand(SSH_PATH, buildAuthenticationArguments({
      destination,
      identityPath: badKeyPath,
      knownHostsPath,
      port,
    }), {
      env: environment,
      ...processTracking,
      signal,
      timeoutMs: Math.min(timeoutMs, 10_000),
    })
    checks.authentication.badKeyRejected = badAuthentication.code !== 0
      && !badAuthentication.timedOut
      && !badAuthentication.aborted
      && !badAuthentication.spawnFailed
    ensure(checks.authentication.badKeyRejected, activeStage, 'BAD_KEY_NOT_REJECTED')

    activeStage = 'authentication-good-key'
    controlParameters = {
      destination,
      identityPath: goodKeyPath,
      knownHostsPath,
      port,
      socketPath,
    }
    masterProcess = startTrackedProcess(SSH_PATH, buildControlMasterArguments(controlParameters), { env: environment })
    trackPid(masterProcess.pid)
    checks.authentication.goodKeyAccepted = await waitForControlMaster(controlParameters, masterProcess, environment, timeoutMs, signal, processTracking)
    ensure(checks.authentication.goodKeyAccepted, activeStage, 'GOOD_KEY_NOT_ACCEPTED')
    for (const pid of await collectDescendantPids(sshdProcess.pid, environment)) trackPid(pid)

    activeStage = 'sftp-operations'
    const instrumentedSftpSpawn = (executable, args, options) => {
      ensure(executable === SFTP_PATH, activeStage, 'UNEXPECTED_SFTP_EXECUTABLE')
      const isolatedArguments = buildSftpIsolationArguments({
        identityPath: goodKeyPath,
        knownHostsPath,
        port,
        serviceArguments: args,
      })
      const child = spawn(executable, isolatedArguments, {
        ...options,
        cwd: fixtureRoot,
        env: environment,
        shell: false,
      })
      sftpSpawnCount += 1
      if (Number.isInteger(child.pid)) {
        activeSftpPids.add(child.pid)
        trackPid(child.pid)
      }
      child.once('close', () => {
        if (Number.isInteger(child.pid)) {
          activeSftpPids.delete(child.pid)
          untrackPid(child.pid)
        }
      })
      return child
    }
    sftpService = createSftpService({
      killGraceMs: 250,
      maxConcurrentPerConnection: 1,
      spawn: instrumentedSftpSpawn,
      timeoutMs,
    })
    const connection = {
      destination,
      id: 'uat-loopback',
      sftpPath: SFTP_PATH,
      socketPath,
      workspacePath: canonicalWorkspace,
    }
    const seedRemotePath = path.posix.join(canonicalRemoteRoot, 'seed.txt')
    const seedLocalPath = path.join(localDirectory, 'seed.download.txt')
    const uploadSourcePath = path.join(localDirectory, 'upload-source.bin')
    const uploadTemporaryPath = path.posix.join(canonicalRemoteRoot, 'upload.partial')
    const uploadVerificationPath = path.join(localDirectory, 'upload.verify.bin')
    const uploadFinalPath = path.posix.join(canonicalRemoteRoot, 'upload-final.bin')
    const createdDirectoryPath = path.posix.join(canonicalRemoteRoot, 'created-directory')
    await writeFile(seedRemotePath, 'VincodeLab SFTP loopback seed\n', { mode: 0o600 })
    await writeFile(uploadSourcePath, randomBytes(16 * 1024), { mode: 0o600 })

    const initialListing = await sftpService.list(connection, canonicalRemoteRoot, signal)
    checks.sftp.listing = initialListing.some((entry) => entry.name === 'seed.txt' && entry.kind === 'file')
    ensure(checks.sftp.listing, activeStage, 'LISTING_FAILED')

    await sftpService.download(connection, seedRemotePath, seedLocalPath, signal)
    hashes.seedSource = await sha256File(seedRemotePath)
    hashes.seedDownload = await sha256File(seedLocalPath)
    checks.sftp.downloadHash = hashes.seedSource === hashes.seedDownload
    ensure(checks.sftp.downloadHash, activeStage, 'DOWNLOAD_HASH_MISMATCH')

    await sftpService.uploadTemp(connection, uploadSourcePath, uploadTemporaryPath, signal)
    await sftpService.download(connection, uploadTemporaryPath, uploadVerificationPath, signal)
    hashes.uploadSource = await sha256File(uploadSourcePath)
    hashes.uploadRoundTrip = await sha256File(uploadVerificationPath)
    checks.sftp.uploadHash = hashes.uploadSource === hashes.uploadRoundTrip
    ensure(checks.sftp.uploadHash, activeStage, 'UPLOAD_HASH_MISMATCH')

    await sftpService.chmod(connection, uploadTemporaryPath, 0o640, signal)
    const chmodListing = await sftpService.list(connection, canonicalRemoteRoot, signal)
    const chmodEntry = chmodListing.find((entry) => entry.name === 'upload.partial')
    checks.sftp.chmod = chmodEntry?.mode === 0o640 && (await stat(uploadTemporaryPath)).mode % 0o1000 === 0o640
    ensure(checks.sftp.chmod, activeStage, 'CHMOD_FAILED')

    await sftpService.rename(connection, uploadTemporaryPath, uploadFinalPath, signal)
    const renamedListing = await sftpService.list(connection, canonicalRemoteRoot, signal)
    checks.sftp.rename = renamedListing.some((entry) => entry.name === 'upload-final.bin')
      && !renamedListing.some((entry) => entry.name === 'upload.partial')
    ensure(checks.sftp.rename, activeStage, 'RENAME_FAILED')

    await sftpService.mkdir(connection, createdDirectoryPath, signal)
    const listingWithDirectory = await sftpService.list(connection, canonicalRemoteRoot, signal)
    const directoryCreated = listingWithDirectory.some((entry) => entry.name === 'created-directory' && entry.kind === 'directory')
    await sftpService.rmdir(connection, createdDirectoryPath, signal)
    const listingWithoutDirectory = await sftpService.list(connection, canonicalRemoteRoot, signal)
    checks.sftp.mkdirRmdir = directoryCreated && !listingWithoutDirectory.some((entry) => entry.name === 'created-directory')
    ensure(checks.sftp.mkdirRmdir, activeStage, 'MKDIR_RMDIR_FAILED')

    readOnlyDirectory = path.join(canonicalRemoteRoot, 'read-only')
    await mkdir(readOnlyDirectory, { mode: 0o500 })
    const readOnlyStatus = await stat(readOnlyDirectory)
    const deniedTarget = path.posix.join(readOnlyDirectory, 'denied.bin')
    let permissionRejected = false
    try {
      await sftpService.uploadTemp(connection, uploadSourcePath, deniedTarget, signal)
    } catch {
      permissionRejected = true
    }
    const controlListingAfterDenial = await sftpService.list(connection, canonicalRemoteRoot, signal)
    checks.sftp.permissionDenied = permissionRejected
      && readOnlyStatus.uid === process.getuid()
      && readOnlyStatus.mode % 0o1000 === 0o500
      && !(await pathExists(deniedTarget))
      && controlListingAfterDenial.some((entry) => entry.name === 'seed.txt' && entry.kind === 'file')
    ensure(checks.sftp.permissionDenied, activeStage, 'PERMISSION_DENIAL_FAILED')
    await chmod(readOnlyDirectory, 0o700)
    await rm(readOnlyDirectory, { recursive: true })
    readOnlyDirectory = undefined

    const cancellationSourcePath = path.join(canonicalRemoteRoot, 'cancel-source.bin')
    const cancellationTargetPath = path.join(localDirectory, 'cancel-target.bin')
    const cancellationHandle = await open(cancellationSourcePath, 'w', 0o600)
    await cancellationHandle.truncate(CANCEL_FIXTURE_BYTES)
    await cancellationHandle.close()
    const spawnCountBeforeCancellation = sftpSpawnCount
    const cancellationController = new AbortController()
    const cancellationSignal = signal
      ? AbortSignal.any([signal, cancellationController.signal])
      : cancellationController.signal
    const cancellation = sftpService.download(connection, cancellationSourcePath, cancellationTargetPath, cancellationSignal)
    const cancellationOutcome = cancellation.then(
      () => ({ status: 'fulfilled' }),
      (error) => ({ error, status: 'rejected' }),
    )
    let settledCancellationOutcome
    let progressObserved = false
    void cancellationOutcome.then((outcome) => { settledCancellationOutcome = outcome })
    await waitForCondition(async () => {
      if (settledCancellationOutcome) return true
      if (sftpSpawnCount <= spawnCountBeforeCancellation || activeSftpPids.size === 0) return false
      const transferredBytes = await stat(cancellationTargetPath).then((entry) => entry.size, () => 0)
      progressObserved = transferredBytes > 0 && transferredBytes < CANCEL_FIXTURE_BYTES
      return progressObserved
    }, 5_000, signal)
    ensure(progressObserved, activeStage, 'CANCELLATION_PROGRESS_NOT_OBSERVED')
    for (const pid of await collectDescendantPids(sshdProcess.pid, environment)) trackPid(pid)
    cancellationController.abort()
    const cancelledOutcome = settledCancellationOutcome ?? await cancellationOutcome
    const cancellationDrained = await waitForCondition(() => activeSftpPids.size === 0, 2_000, signal)
    const partialSize = await stat(cancellationTargetPath).then((entry) => entry.size, () => 0)
    checks.sftp.cancellation = cancelledOutcome.status === 'rejected'
      && /annullato/u.test(cancelledOutcome.error?.message ?? '')
      && cancellationDrained
      && partialSize > 0
      && partialSize < CANCEL_FIXTURE_BYTES
    ensure(checks.sftp.cancellation, activeStage, 'CANCELLATION_FAILED')
    await sftpService.remove(connection, uploadFinalPath, signal)
  } catch (error) {
    failure = error instanceof UatFailure
      ? { code: error.code, stage: error.stage }
      : { code: 'UNEXPECTED_FAILURE', stage: activeStage }
  } finally {
    activeStage = 'cleanup'
    for (const rootPid of [sshdProcess?.pid, masterProcess?.pid]) {
      try {
        for (const pid of await collectDescendantPids(rootPid, environment)) trackPid(pid)
      } catch {}
    }
    if (readOnlyDirectory) {
      try { await chmod(readOnlyDirectory, 0o700) } catch {}
    }
    if (sftpService) {
      try {
        await sftpService.closeAll()
        await delay(0)
        checks.cleanup.serviceDrained = sftpService.getResourceCounts().queues === 0
          && sftpService.getResourceCounts().operations === 0
          && activeSftpPids.size === 0
      } catch {
        checks.cleanup.serviceDrained = false
      }
    } else {
      checks.cleanup.serviceDrained = activeSftpPids.size === 0
    }
    if (activeSftpPids.size > 0) {
      await killExactPids(activeSftpPids)
      for (const pid of [...activeSftpPids]) {
        if (!processAlive(pid)) {
          activeSftpPids.delete(pid)
          untrackPid(pid)
        }
      }
    }

    try {
      checks.cleanup.controlMasterStopped = await stopControlMaster(controlParameters, masterProcess, environment, processTracking)
    } catch {
      checks.cleanup.controlMasterStopped = await terminateTrackedProcess(masterProcess)
    }
    try {
      checks.cleanup.sshdStopped = await terminateTrackedProcess(sshdProcess)
    } catch {
      checks.cleanup.sshdStopped = false
    }
    for (const pid of [...trackedFixturePids]) if (!processAlive(pid)) untrackPid(pid)
    if (trackedFixturePids.size > 0) await killExactPids(trackedFixturePids)
    for (const pid of [...trackedFixturePids]) if (!processAlive(pid)) untrackPid(pid)
    checks.cleanup.controlMasterStopped = checks.cleanup.controlMasterStopped
      && !processAlive(masterProcess?.pid)
      && !processGroupAlive(masterProcess?.pid)
    checks.cleanup.sshdStopped = checks.cleanup.sshdStopped
      && !processAlive(sshdProcess?.pid)
      && !processGroupAlive(sshdProcess?.pid)
    checks.cleanup.noFixtureProcesses = activeSftpPids.size === 0
      && trackedFixturePids.size === 0
      && !processGroupAlive(masterProcess?.pid)
      && !processGroupAlive(sshdProcess?.pid)
    checks.cleanup.portReleased = port ? !(await canConnect(port)) : true

    if (fixtureRoot?.startsWith(FIXTURE_PREFIX)) {
      try { await rm(fixtureRoot, { force: true, maxRetries: 3, recursive: true, retryDelay: 50 }) } catch {}
    }
    checks.cleanup.fixtureRemoved = fixtureRoot ? !(await pathExists(fixtureRoot)) : true
    checks.cleanup.socketRemoved = socketPath ? !(await pathExists(socketPath)) : true
    if (!allChecksPassed(checks) && !failure) failure = { code: 'INCOMPLETE_EVIDENCE', stage: activeStage }
  }

  return createPrivacySafeReport({
    checks,
    failure,
    finishedAt: new Date(),
    hashes: Object.keys(hashes).length > 0 ? hashes : null,
    startedAt,
  })
}
