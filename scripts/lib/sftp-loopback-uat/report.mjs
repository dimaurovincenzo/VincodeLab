export class UatFailure extends Error {
  constructor(stage, code) {
    super(code)
    this.name = 'UatFailure'
    this.stage = stage
    this.code = code
  }
}

export function fail(stage, code) {
  throw new UatFailure(stage, code)
}

export function ensure(condition, stage, code) {
  if (!condition) fail(stage, code)
}

export function initialChecks() {
  return {
    isolation: {
      highPort: false,
      hostKeyPinned: false,
      loopbackOnly: false,
      noUserSshConfiguration: false,
      nonRoot: false,
      temporaryConfig: false,
      temporaryHome: false,
    },
    authentication: {
      badKeyRejected: false,
      goodKeyAccepted: false,
    },
    sftp: {
      cancellation: false,
      chmod: false,
      downloadHash: false,
      listing: false,
      mkdirRmdir: false,
      permissionDenied: false,
      rename: false,
      uploadHash: false,
    },
    cleanup: {
      controlMasterStopped: false,
      fixtureRemoved: false,
      noFixtureProcesses: false,
      portReleased: false,
      serviceDrained: false,
      socketRemoved: false,
      sshdStopped: false,
    },
  }
}

export function allChecksPassed(checks) {
  return Object.values(checks).every((section) => Object.values(section).every(Boolean))
}

function sanitizeChecks(checks) {
  const safeChecks = initialChecks()
  for (const [sectionName, section] of Object.entries(safeChecks)) {
    for (const checkName of Object.keys(section)) {
      section[checkName] = checks?.[sectionName]?.[checkName] === true
    }
  }
  return safeChecks
}

function sanitizeFailure(failure) {
  const code = /^[A-Z0-9_]+$/u.test(failure?.code ?? '') ? failure.code : 'UNEXPECTED_FAILURE'
  const stage = /^[a-z0-9-]+$/u.test(failure?.stage ?? '') ? failure.stage : 'unknown'
  return { code, stage }
}

function sanitizeHashes(hashes) {
  const allowedNames = ['seedSource', 'seedDownload', 'uploadSource', 'uploadRoundTrip']
  return Object.fromEntries(allowedNames.flatMap((name) => {
    const value = hashes?.[name]
    return /^[a-f0-9]{64}$/u.test(value ?? '') ? [[name, value]] : []
  }))
}

export function createPrivacySafeReport({
  checks,
  startedAt,
  finishedAt,
  failure = null,
  hashes = null,
}) {
  const safeChecks = sanitizeChecks(checks)
  const safeHashes = sanitizeHashes(hashes)
  const ok = !failure && allChecksPassed(safeChecks)
  const report = {
    schemaVersion: 1,
    suite: 'vincodelab-sftp-loopback',
    classification: 'fixture-reale-locale',
    ok,
    status: ok ? 'passed' : 'failed',
    environment: {
      architecture: process.arch,
      node: process.versions.node,
      platform: process.platform,
      transport: 'OpenSSH loopback non-root',
    },
    timing: {
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      finishedAt: finishedAt.toISOString(),
      startedAt: startedAt.toISOString(),
    },
    checks: safeChecks,
  }
  if (Object.keys(safeHashes).length > 0) report.evidence = { hashes: safeHashes }
  if (!ok) {
    report.failure = sanitizeFailure(failure ?? { code: 'INCOMPLETE_EVIDENCE', stage: 'report' })
  }
  return report
}
