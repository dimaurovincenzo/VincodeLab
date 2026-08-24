const path = require('node:path')
const { toApplicationError } = require('../domains/errors/application-error.cjs')

const CONTROLLED_FAILURES = Object.freeze({
  'ai-crash': Object.freeze({
    category: 'process', code: 'BENCHMARK_AI_CRASH', domain: 'ai', operation: 'benchmark-ai-crash',
    message: 'La sessione AI si è interrotta. Il contenuto utile è rimasto disponibile. Riavvia la sessione.', technicalCode: 'EPIPE',
  }),
  'pty-failure': Object.freeze({
    category: 'process', code: 'BENCHMARK_PTY_FAILURE', domain: 'terminal', operation: 'benchmark-pty-failure',
    message: 'Il terminale non è stato avviato. Le altre sessioni sono rimaste disponibili. Riprova.', technicalCode: 'PTY_SPAWN_FAILED',
  }),
  'file-not-found': Object.freeze({
    category: 'not-found', code: 'BENCHMARK_FILE_NOT_FOUND', domain: 'filesystem', operation: 'benchmark-file-read',
    message: 'Il file di prova non è più disponibile. Gli altri file non sono stati modificati. Aggiorna l’Explorer e riprova.', technicalCode: 'ENOENT',
  }),
  'file-permission': Object.freeze({
    category: 'permission', code: 'BENCHMARK_FILE_PERMISSION', domain: 'filesystem', operation: 'benchmark-file-read',
    message: 'Il file di prova non è accessibile. Le modifiche in memoria sono rimaste disponibili. Verifica i permessi e riprova.', technicalCode: 'EACCES',
  }),
  'git-failure': Object.freeze({
    category: 'git', code: 'BENCHMARK_GIT_FAILURE', domain: 'git', operation: 'benchmark-git-refresh',
    message: 'Git non ha aggiornato il repository di prova. Le modifiche locali sono rimaste intatte. Aggiorna lo stato e riprova.', technicalCode: 'GIT_TEST_FAILURE',
  }),
  'github-network': Object.freeze({
    category: 'network', code: 'BENCHMARK_GITHUB_NETWORK', domain: 'github', operation: 'benchmark-github-refresh',
    message: 'GitHub non è raggiungibile. Le modifiche locali sono rimaste intatte. Controlla la connessione e riprova.', technicalCode: 'ENETUNREACH',
  }),
  'database-connection': Object.freeze({
    category: 'network', code: 'BENCHMARK_DATABASE_CONNECTION', domain: 'database', operation: 'benchmark-database-connect',
    message: 'Impossibile raggiungere il database di prova. La query è rimasta disponibile. Riconnetti e riprova.', technicalCode: 'ECONNREFUSED',
  }),
  'database-query': Object.freeze({
    category: 'database', code: 'BENCHMARK_DATABASE_QUERY', domain: 'database', operation: 'benchmark-database-query',
    message: 'La query di prova non è stata completata. Il testo e i risultati precedenti sono rimasti disponibili. Correggi la query e riprova.', technicalCode: 'SQLITE_ERROR',
  }),
  'sftp-failure': Object.freeze({
    category: 'remote', code: 'BENCHMARK_SFTP_FAILURE', domain: 'remote', operation: 'benchmark-sftp-transfer',
    message: 'Il server remoto di prova non è raggiungibile. Le copie locali sono rimaste disponibili. Riconnetti e riprova.', technicalCode: 'SFTP_CONNECTION_LOST',
  }),
})
const RELIABILITY_FAULTS = Object.freeze(['ipc-rejection', 'persistence-corrupt', ...Object.keys(CONTROLLED_FAILURES)])
const RELIABILITY_FAULT_SET = new Set(RELIABILITY_FAULTS)
const CORRUPTED_WORKSPACE_SESSION_PAYLOAD = '{"benchmarkFault":'

function createReliabilityFaultInjection({
  enabled = false,
  getDatabase,
  getWorkspacePath,
  now = () => Date.now(),
} = {}) {
  if (typeof enabled !== 'boolean') throw new TypeError('Modalità fault injection non valida.')
  if (enabled && (typeof getDatabase !== 'function' || typeof getWorkspacePath !== 'function' || typeof now !== 'function')) {
    throw new TypeError('Dipendenze fault injection non valide.')
  }

  let persistenceCorruptionArmed = false

  function assertEnabled() {
    if (!enabled) {
      throw toApplicationError(new Error('Fault injection non disponibile.'), {
        category: 'configuration',
        code: 'BENCHMARK_FAULT_INJECTION_DISABLED',
        domain: 'internal',
        message: 'La modalità di verifica controllata non è attiva.',
        operation: 'fault-injection',
        recoverable: false,
        severity: 'warning',
      })
    }
  }

  function inject(fault) {
    assertEnabled()
    if (!RELIABILITY_FAULT_SET.has(fault)) {
      throw toApplicationError(new Error('Fault benchmark non valido.'), {
        category: 'validation',
        code: 'BENCHMARK_FAULT_INVALID',
        domain: 'internal',
        message: 'La verifica controllata richiesta non è disponibile.',
        operation: 'inject-fault',
        recoverable: false,
        severity: 'warning',
      })
    }

    if (fault === 'ipc-rejection') {
      // Il dettaglio volutamente sensibile prova che il confine IPC non lo
      // propaga né alla UI né ai log. Non contiene dati dell'utente.
      const rawError = new Error('token=benchmark-secret /Users/benchmark/private/query.sql')
      rawError.code = 'ETIMEDOUT'
      throw toApplicationError(rawError, {
        category: 'timeout',
        code: 'BENCHMARK_IPC_REJECTION',
        domain: 'internal',
        message: 'La richiesta IPC controllata è stata interrotta. Riprova.',
        operation: 'benchmark-ipc-rejection',
        recoverable: true,
        severity: 'warning',
      })
    }

    const controlled = CONTROLLED_FAILURES[fault]
    if (controlled) {
      // Ogni dominio attraversa il vero confine IPC del bundle. Il dettaglio
      // avverso permette allo smoke di verificare che UI e log restino puliti.
      const rawError = new Error(`access_token benchmark-secret /tmp/vincodelab-private/${fault}.json`)
      rawError.code = controlled.technicalCode
      throw toApplicationError(rawError, {
        category: controlled.category,
        code: controlled.code,
        domain: controlled.domain,
        message: controlled.message,
        operation: controlled.operation,
        recoverable: true,
        severity: 'error',
      })
    }

    persistenceCorruptionArmed = true
    return Object.freeze({ armed: true, fault })
  }

  function beforeWorkspaceSessionRead() {
    if (!enabled || !persistenceCorruptionArmed) return false
    const workspacePath = getWorkspacePath()
    if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath) || workspacePath.includes('\0')) {
      throw toApplicationError(new Error('Workspace benchmark non disponibile.'), {
        category: 'validation',
        code: 'BENCHMARK_WORKSPACE_REQUIRED',
        domain: 'persistence',
        message: 'Apri il workspace temporaneo prima della verifica di persistenza.',
        operation: 'inject-persistence-corruption',
        recoverable: true,
        severity: 'warning',
      })
    }

    const database = getDatabase()
    database.exec(`
      CREATE TABLE IF NOT EXISTS workspace_ui_state (
        workspace_path TEXT PRIMARY KEY NOT NULL,
        schema_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    database.prepare(`
      INSERT INTO workspace_ui_state (workspace_path, schema_version, payload_json, updated_at)
      VALUES (?, 1, ?, ?)
      ON CONFLICT(workspace_path) DO UPDATE SET
        schema_version = excluded.schema_version,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(workspacePath, CORRUPTED_WORKSPACE_SESSION_PAYLOAD, now())
    persistenceCorruptionArmed = false
    return true
  }

  function probe() {
    assertEnabled()
    return Object.freeze({ ok: true })
  }

  return Object.freeze({ beforeWorkspaceSessionRead, inject, probe })
}

module.exports = {
  CONTROLLED_FAILURES,
  CORRUPTED_WORKSPACE_SESSION_PAYLOAD,
  RELIABILITY_FAULTS,
  createReliabilityFaultInjection,
}
