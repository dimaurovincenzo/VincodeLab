const { execFile } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const HERDR_PREFLIGHT_TIMEOUT_MS = 1_000
const HERDR_VERSION_OUTPUT_LIMIT_BYTES = 4 * 1024
const HERDR_COMMAND_OUTPUT_LIMIT_BYTES = 256 * 1024
const HERDR_COMMAND_TIMEOUT_MS = 15_000
const HERDR_WORKSPACE_COMMANDS = new Set([
  'new-pi',
  'new-pi-right',
  'new-pi-down',
  'previous-agent',
  'next-agent',
  'zoom-pane',
  'close-pane',
])

function herdrSessionNameForWorkspace(workspacePath) {
  if (typeof workspacePath !== 'string' || !path.isAbsolute(workspacePath) || workspacePath.includes('\0')) {
    throw new TypeError('Percorso workspace Herdr non valido.')
  }
  const identity = crypto.createHash('sha256').update(path.resolve(workspacePath)).digest('hex').slice(0, 16)
  return `vincodelab-${identity}`
}

function parseHerdrResponse(stdout) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout, 'utf8') > HERDR_COMMAND_OUTPUT_LIMIT_BYTES) {
    throw Object.assign(new Error('Risposta Herdr non valida.'), { code: 'HERDR_RESPONSE_INVALID' })
  }
  try {
    const parsed = JSON.parse(stdout)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.result || typeof parsed.result !== 'object') throw new Error('shape')
    return parsed.result
  } catch (cause) {
    throw Object.assign(new Error('Herdr ha restituito una risposta non riconoscibile.'), { code: 'HERDR_RESPONSE_INVALID', cause })
  }
}

function executeHerdrJson(executable, sessionName, args, environment, {
  executeFile = execFile,
  timeoutMs = HERDR_COMMAND_TIMEOUT_MS,
} = {}) {
  if (typeof executeFile !== 'function') throw new TypeError('Executor comando Herdr non valido.')
  if (typeof executable !== 'string' || !path.isAbsolute(executable) || executable.includes('\0')) throw new TypeError('Eseguibile Herdr non valido.')
  if (typeof sessionName !== 'string' || !/^vincodelab-[a-f0-9]{16}$/u.test(sessionName)) throw new TypeError('Sessione Herdr non valida.')
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string' || argument.includes('\0'))) throw new TypeError('Argomenti comando Herdr non validi.')
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) throw new TypeError('Ambiente comando Herdr non valido.')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) throw new TypeError('Timeout comando Herdr non valido.')

  return new Promise((resolve, reject) => {
    executeFile(executable, ['--session', sessionName, ...args], {
      env: environment,
      maxBuffer: HERDR_COMMAND_OUTPUT_LIMIT_BYTES,
      timeout: timeoutMs,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        const timedOut = error.killed === true || error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM'
        reject(Object.assign(new Error(timedOut ? 'Herdr non ha risposto entro il tempo previsto.' : 'Herdr non ha completato il comando richiesto.'), {
          code: timedOut ? 'HERDR_COMMAND_TIMEOUT' : 'HERDR_COMMAND_FAILED',
        }))
        return
      }
      try {
        resolve(parseHerdrResponse(stdout))
      } catch (parseError) {
        reject(parseError)
      }
    })
  })
}

function normalizeWorkspacePath(candidate) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || candidate.includes('\0')) return null
  return path.resolve(candidate)
}

function nextPiAgentName(agents) {
  const names = new Set(agents.map((agent) => agent?.name).filter((name) => typeof name === 'string'))
  if (!names.has('pi-main')) return 'pi-main'
  for (let index = 2; index <= 99; index += 1) {
    const candidate = `pi-${index}`
    if (!names.has(candidate)) return candidate
  }
  throw Object.assign(new Error('Limite agenti Pi raggiunto.'), { code: 'HERDR_PI_AGENT_LIMIT' })
}

function createHerdrWorkspaceRuntime({ executeJson }) {
  async function resolveWorkspace({ executable, environment, sessionName, workspacePath }) {
    const normalizedWorkspace = normalizeWorkspacePath(workspacePath)
    if (!normalizedWorkspace) throw new TypeError('Percorso workspace Herdr non valido.')
    const paneResult = await executeJson(executable, sessionName, ['pane', 'list'], environment)
    const panes = Array.isArray(paneResult.panes) ? paneResult.panes : []
    const matchingPanes = panes.filter((candidate) => [candidate?.cwd, candidate?.foreground_cwd].some((cwd) => normalizeWorkspacePath(cwd) === normalizedWorkspace))
    let pane = matchingPanes.find((candidate) => candidate?.focused === true) ?? matchingPanes[0]
    let workspaceId = typeof pane?.workspace_id === 'string' ? pane.workspace_id : null

    if (!workspaceId) {
      const created = await executeJson(executable, sessionName, [
        'workspace', 'create', '--cwd', normalizedWorkspace, '--label', path.basename(normalizedWorkspace), '--focus',
      ], environment)
      workspaceId = typeof created.workspace?.workspace_id === 'string' ? created.workspace.workspace_id : null
      pane = created.root_pane
    } else {
      await executeJson(executable, sessionName, ['workspace', 'focus', workspaceId], environment)
    }

    const paneId = typeof pane?.pane_id === 'string' ? pane.pane_id : null
    if (!workspaceId || !paneId) throw Object.assign(new Error('Workspace Herdr non disponibile.'), { code: 'HERDR_WORKSPACE_UNAVAILABLE' })
    return { paneId, workspaceId }
  }

  async function startPi({ executable, environment, sessionName, workspaceId, paneId, agents, workspacePath, forceNewTab = false }) {
    let targetPaneId = paneId
    if (forceNewTab) {
      const created = await executeJson(executable, sessionName, [
        'tab', 'create', '--workspace', workspaceId, '--cwd', workspacePath, '--label', 'Pi', '--focus',
      ], environment)
      targetPaneId = typeof created.root_pane?.pane_id === 'string' ? created.root_pane.pane_id : null
    }
    if (!targetPaneId) throw Object.assign(new Error('Pane Herdr non disponibile.'), { code: 'HERDR_PANE_UNAVAILABLE' })
    const agentName = nextPiAgentName(agents)
    await executeJson(executable, sessionName, ['agent', 'start', agentName, '--kind', 'pi', '--pane', targetPaneId, '--timeout', '15000'], environment)
    return { agentName, paneId: targetPaneId }
  }

  async function initialize(input) {
    const environment = { ...input.environment }
    const target = await resolveWorkspace({ ...input, environment })
    const agentResult = await executeJson(input.executable, input.sessionName, ['agent', 'list'], environment)
    const agents = Array.isArray(agentResult.agents) ? agentResult.agents : []
    const existingPi = agents.find((agent) => agent?.workspace_id === target.workspaceId && agent?.agent === 'pi')
    if (existingPi || input.startPi !== true) {
      return Object.freeze({ workspaceId: target.workspaceId, piStarted: false, piAvailable: Boolean(existingPi) })
    }
    const occupied = new Set(agents.map((agent) => agent?.pane_id).filter((paneId) => typeof paneId === 'string'))
    let started
    try {
      started = await startPi({ ...input, environment, ...target, agents, forceNewTab: occupied.has(target.paneId) })
    } catch (error) {
      if (occupied.has(target.paneId)) throw error
      started = await startPi({ ...input, environment, ...target, agents, forceNewTab: true })
    }
    return Object.freeze({ workspaceId: target.workspaceId, piStarted: true, piAvailable: true, ...started })
  }

  async function command(input) {
    if (!HERDR_WORKSPACE_COMMANDS.has(input.command)) throw new TypeError('Comando workspace Herdr non valido.')
    const environment = { ...input.environment }
    const target = await resolveWorkspace({ ...input, environment })
    const agentResult = await executeJson(input.executable, input.sessionName, ['agent', 'list'], environment)
    const agents = (Array.isArray(agentResult.agents) ? agentResult.agents : []).filter((agent) => agent?.workspace_id === target.workspaceId)

    if (input.command === 'new-pi') {
      const started = await startPi({ ...input, environment, ...target, agents, forceNewTab: true })
      return Object.freeze({ command: input.command, workspaceId: target.workspaceId, ...started })
    }
    if (input.command === 'new-pi-right' || input.command === 'new-pi-down') {
      const direction = input.command === 'new-pi-right' ? 'right' : 'down'
      const split = await executeJson(input.executable, input.sessionName, [
        'pane', 'split', target.paneId, '--direction', direction, '--cwd', input.workspacePath, '--focus',
      ], environment)
      const paneId = typeof split.pane?.pane_id === 'string' ? split.pane.pane_id : null
      const started = await startPi({ ...input, environment, workspaceId: target.workspaceId, paneId, agents, forceNewTab: false })
      return Object.freeze({ command: input.command, workspaceId: target.workspaceId, ...started })
    }
    if (input.command === 'zoom-pane') {
      await executeJson(input.executable, input.sessionName, ['pane', 'zoom', target.paneId, '--toggle'], environment)
      return Object.freeze({ command: input.command, workspaceId: target.workspaceId, paneId: target.paneId })
    }
    if (input.command === 'close-pane') {
      await executeJson(input.executable, input.sessionName, ['pane', 'close', target.paneId], environment)
      return Object.freeze({ command: input.command, workspaceId: target.workspaceId, paneId: target.paneId })
    }
    if (agents.length === 0) return Object.freeze({ command: input.command, workspaceId: target.workspaceId, focused: false })
    const currentIndex = agents.findIndex((agent) => agent?.focused === true)
    const offset = input.command === 'next-agent' ? 1 : -1
    const nextIndex = currentIndex < 0
      ? input.command === 'next-agent' ? 0 : agents.length - 1
      : (currentIndex + offset + agents.length) % agents.length
    const nextAgent = agents[nextIndex]
    const targetId = typeof nextAgent?.name === 'string' ? nextAgent.name : nextAgent?.pane_id
    if (typeof targetId !== 'string') throw Object.assign(new Error('Agente Herdr non disponibile.'), { code: 'HERDR_AGENT_UNAVAILABLE' })
    await executeJson(input.executable, input.sessionName, ['agent', 'focus', targetId], environment)
    return Object.freeze({ command: input.command, workspaceId: target.workspaceId, focused: true, paneId: nextAgent.pane_id })
  }

  return Object.freeze({ command, initialize })
}

function validateExecutable(candidate, dependencies = {}) {
  const accessFile = dependencies.accessFile ?? fs.accessSync
  const realpathFile = dependencies.realpathFile ?? fs.realpathSync
  const statFile = dependencies.statFile ?? fs.statSync
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || candidate.includes('\0')) {
    return Object.freeze({ reason: 'not-executable' })
  }
  try {
    const resolved = realpathFile(candidate)
    const stats = statFile(resolved)
    if (!stats.isFile()) return Object.freeze({ reason: 'not-executable' })
    accessFile(resolved, fs.constants.X_OK)
    return Object.freeze({ executable: resolved })
  } catch (error) {
    return Object.freeze({ reason: error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? 'missing' : 'not-executable' })
  }
}

function executableFromPath(environment, dependencies = {}) {
  const pathValue = typeof environment?.PATH === 'string' ? environment.PATH : ''
  let invalidCandidate = false
  const includeUserCandidates = dependencies.includeUserCandidates !== false
  const userCandidates = Array.isArray(dependencies.userCandidates) ? dependencies.userCandidates : []

  if (includeUserCandidates && Object.hasOwn(environment ?? {}, 'VINCODELAB_HERDR_PATH')) {
    return validateExecutable(environment.VINCODELAB_HERDR_PATH, dependencies)
  }

  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue
    const candidate = path.join(directory, 'herdr')
    const result = validateExecutable(candidate, dependencies)
    if (result.executable) return result
    if (result.reason !== 'missing') invalidCandidate = true
  }

  if (includeUserCandidates) {
    for (const candidate of userCandidates) {
      const result = validateExecutable(candidate, dependencies)
      if (result.executable) return result
      if (result.reason !== 'missing') invalidCandidate = true
    }
  }

  return Object.freeze({ reason: invalidCandidate ? 'not-executable' : 'missing' })
}

function hasValidHerdrVersionOutput(stdout, stderr) {
  const output = `${typeof stdout === 'string' ? stdout : ''}\n${typeof stderr === 'string' ? stderr : ''}`.trim()
  if (!output || Buffer.byteLength(output, 'utf8') > HERDR_VERSION_OUTPUT_LIMIT_BYTES) return false
  return /\bherdr\b[^\r\n]{0,48}\bv?\d+\.\d+\.\d+(?:[-+][0-9a-z.-]+)?\b/iu.test(output)
}

function preflightHerdr(executable, environment, {
  executeFile = execFile,
  timeoutMs = HERDR_PREFLIGHT_TIMEOUT_MS,
} = {}) {
  if (typeof executeFile !== 'function') throw new TypeError('Executor preflight Herdr non valido.')
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10_000) throw new TypeError('Timeout preflight Herdr non valido.')

  return new Promise((resolve) => {
    executeFile(executable, ['--version'], {
      env: environment,
      maxBuffer: HERDR_VERSION_OUTPUT_LIMIT_BYTES,
      timeout: timeoutMs,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        const timedOut = error.killed === true || error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM'
        resolve(Object.freeze({ available: false, reason: timedOut ? 'timeout' : 'preflight-failed' }))
        return
      }
      if (!hasValidHerdrVersionOutput(stdout, stderr)) {
        resolve(Object.freeze({ available: false, reason: 'invalid-version-output' }))
        return
      }
      resolve(Object.freeze({ available: true, executable }))
    })
  })
}

function createHerdrRuntimeAdapter({
  executeFile = execFile,
  getEnvironment,
  getHomePath,
  includeUserCandidates = true,
  timeoutMs = HERDR_PREFLIGHT_TIMEOUT_MS,
  ...filesystemDependencies
} = {}) {
  if (typeof getEnvironment !== 'function') throw new TypeError('Provider ambiente Herdr non valido.')
  if (typeof getHomePath !== 'function') throw new TypeError('Provider home Herdr non valido.')
  const workspaceRuntime = createHerdrWorkspaceRuntime({
    executeJson: (executable, sessionName, args, environment, options) => executeHerdrJson(executable, sessionName, args, environment, { executeFile, ...options }),
  })

  async function inspect(environment = getEnvironment()) {
    if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
      return Object.freeze({ available: false, reason: 'preflight-failed' })
    }
    const homePath = getHomePath()
    const userCandidates = includeUserCandidates && typeof homePath === 'string' && path.isAbsolute(homePath)
      ? [path.join(homePath, '.local', 'bin', 'herdr')]
      : []
    const resolved = executableFromPath(environment, {
      ...filesystemDependencies,
      includeUserCandidates,
      userCandidates,
    })
    if (!resolved.executable) return Object.freeze({ available: false, reason: resolved.reason })
    return preflightHerdr(resolved.executable, environment, { executeFile, timeoutMs })
  }

  async function initializeWorkspace(input) {
    return workspaceRuntime.initialize(input)
  }

  async function runWorkspaceCommand(workspacePath, command) {
    const environment = getEnvironment()
    const inspection = await inspect(environment)
    if (inspection.available !== true || typeof inspection.executable !== 'string') {
      throw Object.assign(new Error('Herdr non è disponibile.'), { code: 'HERDR_UNAVAILABLE' })
    }
    return workspaceRuntime.command({
      command,
      environment,
      executable: inspection.executable,
      sessionName: herdrSessionNameForWorkspace(workspacePath),
      workspacePath,
    })
  }

  return Object.freeze({
    initializeWorkspace,
    inspect,
    runWorkspaceCommand,
    sessionNameForWorkspace: herdrSessionNameForWorkspace,
  })
}

module.exports = {
  HERDR_COMMAND_OUTPUT_LIMIT_BYTES,
  HERDR_COMMAND_TIMEOUT_MS,
  HERDR_PREFLIGHT_TIMEOUT_MS,
  HERDR_VERSION_OUTPUT_LIMIT_BYTES,
  createHerdrWorkspaceRuntime,
  createHerdrRuntimeAdapter,
  executeHerdrJson,
  executableFromPath,
  hasValidHerdrVersionOutput,
  herdrSessionNameForWorkspace,
  parseHerdrResponse,
  preflightHerdr,
  validateExecutable,
}
