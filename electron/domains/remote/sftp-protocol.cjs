const path = require('node:path')
const { getApplicationErrorLogMetadata, isApplicationError, toApplicationError } = require('../errors/application-error.cjs')

const SFTP_ERROR_METADATA = Symbol('vincodelab.sftp-error-metadata')
const MAX_FAILURE_SIGNAL_LENGTH = 16_384
const SAFE_OPERATION = /^[a-z][a-z0-9-]{0,47}$/u
const SAFE_CONNECTION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/u

const OPERATION_COPY = Object.freeze({
  chmod: 'Impossibile aggiornare i permessi remoti.',
  download: 'Impossibile scaricare il file remoto.',
  list: 'Impossibile leggere la cartella remota.',
  mkdir: 'Impossibile creare la cartella remota.',
  remove: 'Impossibile eliminare il file remoto.',
  rename: 'Impossibile rinominare la risorsa remota.',
  'resolve-root': 'Impossibile aprire la cartella remota iniziale.',
  rmdir: 'Impossibile eliminare la cartella remota.',
  upload: 'Impossibile caricare il file remoto.',
})

function internalSftpError(code, message, name = 'Error') {
  const error = new Error(message)
  error.code = code
  error.name = name
  return error
}

function safeOperation(value) {
  return typeof value === 'string' && SAFE_OPERATION.test(value) ? value : 'operation'
}

function safeFileName(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096 || /[\0\r\n]/u.test(value)) return null
  const fileName = path.posix.basename(value.replaceAll('\\', '/')).trim()
  if (!fileName || fileName === '.' || fileName === '..' || fileName === '/' || fileName === '~' || fileName.length > 160 || /[\p{Cc}\p{Cf}]/u.test(fileName)) return null
  if (/\b(?:password|passwd|token|secret|authorization|cookie|api[_-]?key)\b/iu.test(fileName)) return 'risorsa-redatta'
  return fileName
}

function safeConnectionId(value) {
  if (typeof value !== 'string' || !SAFE_CONNECTION_ID.test(value)) return null
  if (/\b(?:password|passwd|token|secret|authorization|cookie|api[_-]?key)\b/iu.test(value)) return null
  return value
}

function failureSignal(error, stderr) {
  const values = []
  for (const key of ['name', 'code', 'message']) {
    const value = error && typeof error === 'object' ? error[key] : undefined
    if (typeof value === 'string') values.push(value)
  }
  if (typeof error === 'string') values.push(error)
  if (Buffer.isBuffer(stderr)) values.push(stderr.subarray(0, MAX_FAILURE_SIGNAL_LENGTH).toString('utf8'))
  else if (typeof stderr === 'string') values.push(stderr.slice(0, MAX_FAILURE_SIGNAL_LENGTH))
  return values.join(' ').slice(0, MAX_FAILURE_SIGNAL_LENGTH).toLowerCase()
}

function operationFailureCode(operation) {
  const token = safeOperation(operation).replaceAll('-', '_').toUpperCase()
  return `SFTP_${token}_FAILED`
}

function classifySftpFailure(error, { operation, stderr } = {}) {
  const normalizedOperation = safeOperation(operation)
  const technicalSignal = failureSignal(error)
  const signal = failureSignal(error, stderr)
  const baseMessage = OPERATION_COPY[normalizedOperation] ?? 'Il server remoto non ha applicato la richiesta.'

  if (/aborterror|abort_err|sftp_cancelled|cancel(?:led|ed)|annullat/u.test(technicalSignal)) {
    return { category: 'cancelled', code: 'SFTP_CANCELLED', message: 'Trasferimento remoto annullato.' }
  }
  if (/remote host identification has changed|offending .* key|host key has changed/u.test(signal)) {
    return { category: 'conflict', code: 'SFTP_HOST_KEY_CHANGED', message: 'La chiave del server remoto è cambiata. Verificala prima di riconnetterti.' }
  }
  if (/host key verification failed|host key is unknown|no matching host key|unknown host key|authenticity of host .+can.t be established/u.test(signal)) {
    return { category: 'authentication', code: 'SFTP_HOST_KEY_UNVERIFIED', message: 'L’identità del server remoto non è verificata. Controlla la chiave host e riprova.' }
  }
  if (/permission denied \((?:publickey|password|keyboard-interactive)|authentication failed|too many authentication failures|no supported authentication methods|no more authentication methods|login failed|access denied for user/u.test(signal)) {
    return { category: 'authentication', code: 'SFTP_AUTHENTICATION_REQUIRED', message: 'Accesso al server remoto non riuscito. Verifica credenziali e chiave SSH, poi riprova.' }
  }
  if (/etimedout|sftp_timeout|timed?\s*out|(?:connection|operation|request) timeout|timeout (?:expired|reached|waiting|while)|tempo previsto/u.test(signal)) {
    return { category: 'timeout', code: 'SFTP_TIMEOUT', message: `${baseMessage} Il server non ha risposto nel tempo previsto. Riprova.` }
  }
  if (/no space left on device|disk quota exceeded|disk full|insufficient space|spazio.+insufficient/u.test(signal)) {
    return { category: 'remote', code: 'SFTP_NO_SPACE', message: `${baseMessage} Lo spazio sul server non è sufficiente. Libera spazio e riprova.` }
  }
  if (/file exists|already exists|resource busy|failure.*(?:rename|mkdir)|(?:rename|mkdir).*failure|conflict(?: detected|ing)/u.test(signal)) {
    return { category: 'conflict', code: 'SFTP_CONFLICT', message: `${baseMessage} La destinazione è cambiata o esiste già. Aggiorna la cartella prima di riprovare.` }
  }
  if (/control socket connect|controlpath.+no such file/u.test(signal)) {
    return { category: 'network', code: 'SFTP_CONNECTION_UNAVAILABLE', message: `${baseMessage} La connessione remota non è più disponibile. Riconnetti e riprova.` }
  }
  if (/no such file or directory|couldn.t stat|couldn.t canonicali[sz]e|not found|does not exist|inesistent/u.test(signal)) {
    return { category: 'not-found', code: 'SFTP_NOT_FOUND', message: `${baseMessage} Il file o la cartella non è più disponibile. Aggiorna la cartella e riprova.` }
  }
  if (/permission denied|operation not permitted|read.?only file system|access denied|permess/u.test(signal)) {
    return { category: 'permission', code: 'SFTP_PERMISSION_DENIED', message: `${baseMessage} Non hai i permessi necessari sul server. Verifica i permessi e riprova.` }
  }
  if (/could not resolve hostname|name or service not known|nodename nor servname|no route to host|network is unreachable|connection refused|host is down|ehostunreach|enetunreach|econnrefused/u.test(signal)) {
    return { category: 'network', code: 'SFTP_HOST_UNREACHABLE', message: `${baseMessage} Il server remoto non è raggiungibile. Controlla host e connessione, poi riprova.` }
  }
  if (/connection (?:closed|reset)|broken pipe|lost connection|connection lost|unexpected eof|epipe|econnreset|sftp_stream_interrupted/u.test(signal)) {
    return { category: 'network', code: 'SFTP_TRANSFER_INTERRUPTED', message: `${baseMessage} La connessione si è interrotta. Riconnetti e riprova.` }
  }
  if (/sftp_spawn_failed|spawn .*enoent|executable.+not found/u.test(signal)) {
    return { category: 'process', code: 'SFTP_UNAVAILABLE', message: 'Il processo SFTP non è disponibile. Controlla la configurazione e riprova.' }
  }
  if (/sftp_output_limit|risposta sftp.+troppo grande/u.test(signal)) {
    return { category: 'remote', code: 'SFTP_RESPONSE_TOO_LARGE', message: 'La risposta SFTP è troppo grande. Apri una cartella più piccola e riprova.' }
  }
  if (/non valid|invalid (?:request|command|path|argument|packet)|malformed (?:request|response|packet)/u.test(signal)) {
    return { category: 'validation', code: 'SFTP_REQUEST_INVALID', message: 'La richiesta SFTP non è valida. Controlla i dati e riprova.' }
  }
  return { category: 'remote', code: operationFailureCode(normalizedOperation), message: `${baseMessage} Riprova.` }
}

function toSftpApplicationError(error, { connection, operation, resource, stderr } = {}) {
  const normalizedOperation = safeOperation(operation)
  if (isApplicationError(error)) return error
  const classification = classifySftpFailure(error, { operation: normalizedOperation, stderr })
  const applicationError = toApplicationError(error, {
    category: classification.category,
    code: classification.code,
    domain: 'remote',
    message: classification.message,
    operation: normalizedOperation,
  })
  const connectionId = safeConnectionId(connection?.id)
  const fileName = safeFileName(resource)
  const metadata = Object.freeze({
    ...getApplicationErrorLogMetadata(applicationError),
    ...(connectionId ? { connectionId } : {}),
    ...(fileName ? { fileName } : {}),
  })
  Object.defineProperty(applicationError, SFTP_ERROR_METADATA, { value: metadata })
  return applicationError
}

function getSftpErrorMetadata(error) {
  return error && typeof error === 'object' ? error[SFTP_ERROR_METADATA] ?? null : null
}

function quoteSftpPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096 || /[\0\r\n]/.test(value)) throw new Error('Percorso remoto non valido.')
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function validateSftpConnection(connection) {
  if (!connection || typeof connection.id !== 'string' || typeof connection.sftpPath !== 'string' || typeof connection.socketPath !== 'string' || typeof connection.destination !== 'string') {
    throw new Error('Connessione SFTP non valida.')
  }
  return connection
}

function parseMode(permissionText) {
  let mode = 0
  const bits = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001]
  for (let index = 0; index < 9; index += 1) {
    if (permissionText[index + 1] !== '-') mode |= bits[index]
  }
  return mode
}

function parseSftpList(output) {
  if (typeof output !== 'string') throw new Error('Elenco SFTP non valido.')
  return output.split(/\r?\n/).filter((line) => line && !line.startsWith('total ')).map((line) => {
    const match = /^([bcdlps-][rwxStTs-]{9})\s+(?:\d+|\?)\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+(?:\d{4}|\d{1,2}:\d{2})\s+(.+)$/.exec(line)
    if (!match) return { name: line, kind: 'unknown', size: null, mode: null, modifiedAt: null, linkTarget: null, destructiveAllowed: false }
    const type = match[1][0]
    let name = match[3]
    let linkTarget = null
    if (type === 'l') {
      const separator = name.indexOf(' -> ')
      if (separator >= 0) {
        linkTarget = name.slice(separator + 4)
        name = name.slice(0, separator)
      }
    }
    name = path.posix.basename(name)
    return {
      name,
      kind: type === '-' ? 'file' : type === 'd' ? 'directory' : type === 'l' ? 'link' : 'unknown',
      size: Number(match[2]),
      mode: parseMode(match[1]),
      modifiedAt: null,
      linkTarget,
      destructiveAllowed: type === '-' || type === 'd',
    }
  }).filter((entry) => entry.name !== '.' && entry.name !== '..')
}

module.exports = {
  getSftpErrorMetadata,
  internalSftpError,
  parseSftpList,
  quoteSftpPath,
  toSftpApplicationError,
  validateSftpConnection,
}
