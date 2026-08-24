const assert = require('node:assert/strict')
const test = require('node:test')

const { getApplicationErrorLogMetadata, isApplicationError } = require('../electron/domains/errors/application-error.cjs')
const {
  commandFailure,
  githubAccessDiagnostic,
  githubUnavailableData,
  isGitRepository,
} = require('../electron/infrastructure/github/github-service.adapter.cjs')
const { createPublicError, isPublicError } = require('../electron/domains/errors/public-error.cjs')

const PRIVATE_MARKER = 'SENSITIVE_MARKER_7K9'

function rawError(detail, code) {
  const error = new Error(detail)
  if (code) error.code = code
  return error
}

const FAILURE_CASES = [
  {
    name: 'Git non installato',
    command: 'git',
    args: ['rev-parse', '--is-inside-work-tree'],
    error: rawError(`spawn git ENOENT /Users/alice/${PRIVATE_MARKER}`, 'ENOENT'),
    code: 'GIT_NOT_INSTALLED',
    category: 'configuration',
    domain: 'git',
    operation: 'gitStatus',
    recovery: /Installalo e riprova/,
  },
  {
    name: 'permessi repository locale',
    command: 'git',
    args: ['status', '--short'],
    error: rawError(`fatal: could not open '.git/index': Permission denied /Users/alice/${PRIVATE_MARKER}`, 'EACCES'),
    code: 'GIT_PERMISSION_DENIED',
    category: 'permission',
    domain: 'git',
    operation: 'gitStatus',
    recovery: /Verifica i permessi/,
  },
  {
    name: 'timeout Git',
    command: 'git',
    args: ['fetch', 'origin'],
    error: rawError(`connect ETIMEDOUT token=${PRIVATE_MARKER}`, 'ETIMEDOUT'),
    code: 'GIT_COMMAND_TIMEOUT',
    category: 'timeout',
    domain: 'git',
    operation: 'fetch',
    recovery: /tempo disponibile/,
  },
  {
    name: 'detached HEAD',
    command: 'git',
    args: ['push'],
    error: rawError(`fatal: You are not currently on a branch. ${PRIVATE_MARKER}`),
    code: 'GIT_DETACHED_HEAD',
    category: 'conflict',
    domain: 'git',
    operation: 'push',
    recovery: /Crea o seleziona un branch/,
  },
  {
    name: 'conflitto Git',
    command: 'git',
    args: ['switch', 'feature/private'],
    error: rawError(`fatal: cannot switch branch while merging ${PRIVATE_MARKER}`),
    code: 'GIT_CONFLICT',
    category: 'conflict',
    domain: 'git',
    operation: 'switchBranch',
    recovery: /Risolvi i conflitti/,
  },
  {
    name: 'autenticazione remote Git',
    command: 'git',
    args: ['push'],
    error: rawError(`fatal: Authentication failed for 'https://token:${PRIVATE_MARKER}@github.com/acme/private.git'`),
    code: 'GIT_AUTH_REQUIRED',
    category: 'authentication',
    domain: 'git',
    operation: 'push',
    recovery: /Verifica credenziali o chiave SSH/,
  },
  {
    name: 'permessi remote Git',
    command: 'git',
    args: ['push'],
    error: rawError(`remote: Permission to acme/private.git denied to ${PRIVATE_MARKER}. fatal: requested URL returned error: 403`),
    code: 'GIT_REMOTE_PERMISSION_DENIED',
    category: 'permission',
    domain: 'git',
    operation: 'push',
    recovery: /Verifica i permessi/,
  },
  {
    name: 'push Git non fast-forward',
    command: 'git',
    args: ['push'],
    error: rawError(`error: failed to push some refs; updates were rejected (non-fast-forward) ${PRIVATE_MARKER}`),
    code: 'GIT_CONFLICT',
    category: 'conflict',
    domain: 'git',
    operation: 'push',
    recovery: /Risolvi i conflitti/,
  },
  {
    name: 'rete remote Git',
    command: 'git',
    args: ['fetch', 'origin'],
    error: rawError(`fatal: Could not resolve host: github.com /Users/alice/${PRIVATE_MARKER}`),
    code: 'GIT_REMOTE_UNREACHABLE',
    category: 'network',
    domain: 'git',
    operation: 'fetch',
    recovery: /Controlla la connessione/,
  },
  {
    name: 'repository remoto Git non trovato',
    command: 'git',
    args: ['push'],
    error: rawError(`remote: Repository not found. fatal: repository 'https://github.com/acme/${PRIVATE_MARKER}.git' not found`),
    code: 'GIT_REMOTE_REPOSITORY_NOT_FOUND',
    category: 'not-found',
    domain: 'git',
    operation: 'push',
    recovery: /Verifica il remote e i permessi/,
  },
  {
    name: 'branch remoto Git non trovato',
    command: 'git',
    args: ['fetch', 'origin'],
    error: rawError(`fatal: couldn't find remote ref ${PRIVATE_MARKER}`),
    code: 'GIT_REMOTE_BRANCH_NOT_FOUND',
    category: 'not-found',
    domain: 'git',
    operation: 'fetch',
    recovery: /Aggiorna i riferimenti/,
  },
  {
    name: 'token GitHub non valido',
    command: 'gh',
    args: ['issue', 'list'],
    error: rawError(`HTTP 401: Bad credentials token=ghp_${PRIVATE_MARKER}`),
    code: 'GITHUB_AUTH_REQUIRED',
    category: 'authentication',
    domain: 'github',
    operation: 'data',
    recovery: /Autenticazione GitHub richiesta/,
  },
  {
    name: 'rate limit GitHub',
    command: 'gh',
    args: ['api', 'graphql'],
    error: rawError(`HTTP 403: API rate limit exceeded for ${PRIVATE_MARKER}`),
    code: 'GITHUB_RATE_LIMITED',
    category: 'network',
    domain: 'github',
    operation: 'projects',
    recovery: /Attendi qualche minuto/,
  },
  {
    name: 'rete GitHub',
    command: 'gh',
    args: ['repo', 'view'],
    error: rawError(`failed to connect to api.github.com /Users/alice/${PRIVATE_MARKER}`),
    code: 'GITHUB_NETWORK_UNAVAILABLE',
    category: 'network',
    domain: 'github',
    operation: 'data',
    recovery: /Controlla la connessione/,
  },
  {
    name: 'repository GitHub non trovato',
    command: 'gh',
    args: ['repo', 'view'],
    error: rawError(`GraphQL: Could not resolve to a Repository with the name 'acme/${PRIVATE_MARKER}'.`),
    code: 'GITHUB_REPOSITORY_NOT_FOUND',
    category: 'not-found',
    domain: 'github',
    operation: 'data',
    recovery: /Verifica il collegamento/,
  },
  {
    name: 'branch remoto GitHub non trovato',
    command: 'gh',
    args: ['api', 'graphql'],
    error: rawError(`GraphQL: Head ref branch '${PRIVATE_MARKER}' not found`),
    code: 'GITHUB_REMOTE_BRANCH_NOT_FOUND',
    category: 'not-found',
    domain: 'github',
    operation: 'projects',
    recovery: /Aggiorna i riferimenti/,
  },
  {
    name: 'permessi GitHub',
    command: 'gh',
    args: ['issue', 'edit'],
    error: rawError(`HTTP 403: Resource not accessible by personal access token ghp_${PRIVATE_MARKER}`),
    code: 'GITHUB_PERMISSION_DENIED',
    category: 'permission',
    domain: 'github',
    operation: 'updateIssue',
    recovery: /Verifica i permessi/,
  },
  {
    name: 'conflitto GitHub',
    command: 'gh',
    args: ['issue', 'edit'],
    error: rawError(`HTTP 409: update is not a fast forward ${PRIVATE_MARKER}`),
    code: 'GITHUB_CONFLICT',
    category: 'conflict',
    domain: 'github',
    operation: 'updateIssue',
    recovery: /Aggiorna i dati/,
  },
]

test('classifica Git e GitHub senza esporre comando, output o segreti', async (t) => {
  for (const fixture of FAILURE_CASES) {
    await t.test(fixture.name, () => {
      const error = commandFailure(fixture.command, fixture.error, fixture.error.stderr, fixture.args)
      assert.equal(isPublicError(error), true)
      assert.equal(isApplicationError(error), true)
      assert.equal(error.code, fixture.code)
      assert.equal(error.category, fixture.category)
      assert.equal(error.domain, fixture.domain)
      assert.equal(error.operation, fixture.operation)
      assert.match(error.message, fixture.recovery)
      assert.match(error.message, new RegExp(`\\[${fixture.code}\\] \\[ERR-[A-F0-9]{6}\\]$`))
      assert.doesNotMatch(error.message, new RegExp(`${PRIVATE_MARKER}|ghp_|token=|/Users/alice|private\\.git`, 'i'))
      const logMetadata = getApplicationErrorLogMetadata(error)
      assert.deepEqual(Object.keys(logMetadata).sort(), ['category', 'code', 'component', 'correlationId', 'fingerprint', 'operation', 'severity', 'technicalCode', 'technicalName'])
      assert.match(logMetadata.fingerprint, /^FP-[A-F0-9]{12}$/u)
      assert.doesNotMatch(JSON.stringify(logMetadata), new RegExp(`${PRIVATE_MARKER}|ghp_|token=|/Users/alice|private\\.git`, 'i'))
    })
  }
})

test('rev-parse restituisce false soltanto per un workspace realmente non Git', async (t) => {
  assert.equal(await isGitRepository('/workspace', { runCommand: async () => 'true' }), true)
  assert.equal(await isGitRepository('/workspace', {
    runCommand: async () => {
      const error = rawError(`Command failed ${PRIVATE_MARKER}`)
      error.stderr = 'fatal: not a git repository (or any of the parent directories): .git'
      throw error
    },
  }), false)

  const propagated = [
    ['Git assente', rawError(`spawn git ENOENT ${PRIVATE_MARKER}`, 'ENOENT'), 'GIT_NOT_INSTALLED'],
    ['permessi', rawError(`fatal: Permission denied ${PRIVATE_MARKER}`, 'EACCES'), 'GIT_PERMISSION_DENIED'],
    ['timeout', rawError(`fatal: operation timed out ${PRIVATE_MARKER}`, 'ETIMEDOUT'), 'GIT_COMMAND_TIMEOUT'],
    ['gitdir corrotto', Object.assign(rawError(`Command failed ${PRIVATE_MARKER}`), { stderr: 'fatal: not a git repository: (null)' }), 'GIT_REPOSITORY_INVALID'],
  ]
  for (const [name, raw, code] of propagated) {
    await t.test(name, async () => {
      await assert.rejects(
        () => isGitRepository('/workspace', { runCommand: async () => { throw raw } }),
        (error) => error.code === code && !error.message.includes(PRIVATE_MARKER),
      )
    })
  }

  await assert.rejects(
    () => isGitRepository('/workspace', { runCommand: async () => 'false' }),
    (error) => error.code === 'GIT_WORKTREE_REQUIRED',
  )
  await assert.rejects(
    () => isGitRepository('/workspace', { runCommand: async () => PRIVATE_MARKER }),
    (error) => error.code === 'GIT_REPOSITORY_CHECK_FAILED' && !error.message.includes(PRIVATE_MARKER),
  )
})

test('mantiene idempotente un errore pubblico già classificato', () => {
  const publicError = createPublicError('GITHUB_AUTH_REQUIRED', 'Autenticazione GitHub richiesta.')
  const classified = commandFailure('gh', publicError, `token=ghp_${PRIVATE_MARKER}`, ['issue', 'list'])
  const classifiedAgain = commandFailure('gh', classified, PRIVATE_MARKER, ['repo', 'view'])

  assert.equal(classifiedAgain, classified)
  assert.equal(classified, publicError)
  assert.equal((classified.message.match(/ERR-[A-F0-9]{6}/g) ?? []).length, 1)
  assert.doesNotMatch(classified.message, /ghp_|SENSITIVE_MARKER/)
})

test('espone recovery contestuali nei DTO degradati GitHub', () => {
  const diagnostics = [
    ['GITHUB_RATE_LIMITED', /Attendi qualche minuto/],
    ['GITHUB_NETWORK_UNAVAILABLE', /Controlla la connessione/],
    ['GITHUB_REPOSITORY_NOT_FOUND', /Verifica il collegamento/],
    ['GITHUB_PERMISSION_DENIED', /Verifica i permessi/],
    ['GITHUB_CLI_NOT_FOUND', /Installala o configurala/],
  ]

  for (const [code, expected] of diagnostics) {
    const error = Object.assign(new Error(PRIVATE_MARKER), { code })
    assert.match(githubAccessDiagnostic(error), expected)
    const unavailable = githubUnavailableData(error)
    assert.match(unavailable.githubDiagnostic, expected)
    assert.doesNotMatch(JSON.stringify(unavailable), new RegExp(PRIVATE_MARKER))
  }
})
