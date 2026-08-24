import path from 'node:path'

export const LOOPBACK_HOST = '127.0.0.1'
export const SSH_PATH = '/usr/bin/ssh'
export const SFTP_PATH = '/usr/bin/sftp'
export const SSH_KEYGEN_PATH = '/usr/bin/ssh-keygen'
export const SSHD_PATH = '/usr/sbin/sshd'
export const DEFAULT_TIMEOUT_MS = 30_000
export const MINIMUM_HIGH_PORT = 49_152
export const MAXIMUM_PORT = 65_535
export const CANCEL_FIXTURE_BYTES = 512 * 1024 * 1024
export const FIXTURE_PREFIX = '/tmp/vincodelab-sftp-uat-'

export function validatePort(port) {
  if (!Number.isInteger(port) || port < MINIMUM_HIGH_PORT || port > MAXIMUM_PORT) throw new Error('Porta loopback non valida.')
  return port
}

export function validateUsername(username) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]+$/u.test(username)) throw new Error('Account locale non valido.')
  return username
}

export function validateAbsolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/u.test(value)) throw new Error(`${label} non valido.`)
  return value
}

function quoteSshdValue(value) {
  validateAbsolutePath(value, 'Percorso configurazione sshd')
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function parseCliArguments(args) {
  const options = { execute: false, help: false, outputPath: null, timeoutMs: DEFAULT_TIMEOUT_MS }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--run') options.execute = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else if (argument === '--output') {
      const outputValue = args[++index]
      if (!outputValue || outputValue.startsWith('--')) throw new Error('Percorso report non valido.')
      options.outputPath = path.resolve(outputValue)
    }
    else if (argument === '--timeout-ms') options.timeoutMs = Number(args[++index])
    else throw new Error(`Argomento non riconosciuto: ${argument}`)
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 10_000 || options.timeoutMs > 120_000) {
    throw new Error('Timeout UAT non valido.')
  }
  if (options.outputPath !== null && !path.isAbsolute(options.outputPath)) throw new Error('Percorso report non valido.')
  return options
}

export function buildSshdConfig({
  port,
  username,
  hostKeyPath,
  authorizedKeysPath,
  pidFilePath,
  remoteRoot,
}) {
  validatePort(port)
  validateUsername(username)
  const hostKey = quoteSshdValue(hostKeyPath)
  const authorizedKeys = quoteSshdValue(authorizedKeysPath)
  const pidFile = quoteSshdValue(pidFilePath)
  const sftpRoot = quoteSshdValue(remoteRoot)
  return [
    `Port ${port}`,
    'AddressFamily inet',
    `ListenAddress ${LOOPBACK_HOST}`,
    `HostKey ${hostKey}`,
    `PidFile ${pidFile}`,
    `AuthorizedKeysFile ${authorizedKeys}`,
    `AllowUsers ${username}`,
    'AuthenticationMethods publickey',
    'PubkeyAuthentication yes',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'ChallengeResponseAuthentication no',
    'PermitEmptyPasswords no',
    'HostbasedAuthentication no',
    'GSSAPIAuthentication no',
    'UsePAM no',
    'PermitRootLogin no',
    'StrictModes no',
    'IgnoreRhosts yes',
    'PermitUserEnvironment no',
    'PermitUserRC no',
    'AllowAgentForwarding no',
    'AllowTcpForwarding no',
    'X11Forwarding no',
    'PermitTunnel no',
    'GatewayPorts no',
    'PermitTTY no',
    'UseDNS no',
    'MaxAuthTries 2',
    'MaxSessions 8',
    'LogLevel ERROR',
    `Subsystem sftp internal-sftp -d ${sftpRoot}`,
    '',
  ].join('\n')
}

export function buildKnownHostsLine({ host = LOOPBACK_HOST, port, publicKey }) {
  validatePort(port)
  if (host !== LOOPBACK_HOST) throw new Error('Host UAT non consentito.')
  const [keyType, keyData] = String(publicKey).trim().split(/\s+/u)
  if (keyType !== 'ssh-ed25519' || !/^[a-zA-Z0-9+/]+={0,2}$/u.test(keyData ?? '')) throw new Error('Chiave host non valida.')
  return `[${LOOPBACK_HOST}]:${port} ${keyType} ${keyData}\n`
}

export function buildSshClientOptions({ port, identityPath, knownHostsPath }) {
  validatePort(port)
  validateAbsolutePath(identityPath, 'Chiave client')
  validateAbsolutePath(knownHostsPath, 'Known hosts')
  return [
    '-F', '/dev/null',
    '-p', String(port),
    '-i', identityPath,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'IdentityAgent=none',
    '-o', 'BatchMode=yes',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${knownHostsPath}`,
    '-o', 'GlobalKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=5',
    '-o', 'ConnectionAttempts=1',
    '-o', 'LogLevel=ERROR',
  ]
}

export function buildSftpIsolationArguments({ serviceArguments, port, identityPath, knownHostsPath }) {
  validatePort(port)
  validateAbsolutePath(identityPath, 'Chiave client SFTP')
  validateAbsolutePath(knownHostsPath, 'Known hosts SFTP')
  if (!Array.isArray(serviceArguments) || serviceArguments.some((argument) => typeof argument !== 'string')) {
    throw new Error('Argomenti SFTP non validi.')
  }
  const separatorIndex = serviceArguments.lastIndexOf('--')
  const destination = serviceArguments[separatorIndex + 1]
  if (separatorIndex < 0 || separatorIndex !== serviceArguments.length - 2 || !destination?.endsWith(`@${LOOPBACK_HOST}`)) {
    throw new Error('Destinazione SFTP UAT non valida.')
  }
  if (!serviceArguments.some((argument) => argument === '-o')
    || !serviceArguments.some((argument) => argument.startsWith('ControlPath='))) {
    throw new Error('ControlPath SFTP mancante.')
  }
  return [
    ...serviceArguments.slice(0, separatorIndex),
    '-F', '/dev/null',
    '-P', String(port),
    '-i', identityPath,
    '-l', '8192',
    '-o', 'IdentitiesOnly=yes',
    '-o', 'IdentityAgent=none',
    '-o', 'BatchMode=yes',
    '-o', 'PreferredAuthentications=publickey',
    '-o', 'PasswordAuthentication=no',
    '-o', 'KbdInteractiveAuthentication=no',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${knownHostsPath}`,
    '-o', 'GlobalKnownHostsFile=/dev/null',
    '-o', 'ConnectTimeout=5',
    '-o', 'ConnectionAttempts=1',
    '-o', 'LogLevel=ERROR',
    '--', destination,
  ]
}

export function buildAuthenticationArguments({ port, identityPath, knownHostsPath, destination }) {
  if (typeof destination !== 'string' || !destination.endsWith(`@${LOOPBACK_HOST}`)) throw new Error('Destinazione UAT non valida.')
  return [
    ...buildSshClientOptions({ port, identityPath, knownHostsPath }),
    '-N',
    '--', destination,
  ]
}

export function buildControlMasterArguments({ port, identityPath, knownHostsPath, socketPath, destination }) {
  validateAbsolutePath(socketPath, 'Socket ControlMaster')
  const authentication = buildAuthenticationArguments({ port, identityPath, knownHostsPath, destination })
  authentication.splice(authentication.length - 2, 0,
    '-o', 'ControlMaster=yes',
    '-o', 'ControlPersist=no',
    '-o', `ControlPath=${socketPath}`)
  return authentication
}

export function buildControlCommandArguments({ port, identityPath, knownHostsPath, socketPath, destination, operation }) {
  if (!['check', 'exit'].includes(operation)) throw new Error('Operazione ControlMaster non valida.')
  validateAbsolutePath(socketPath, 'Socket ControlMaster')
  if (typeof destination !== 'string' || !destination.endsWith(`@${LOOPBACK_HOST}`)) throw new Error('Destinazione UAT non valida.')
  return [
    ...buildSshClientOptions({ port, identityPath, knownHostsPath }),
    '-S', socketPath,
    '-O', operation,
    '--', destination,
  ]
}
