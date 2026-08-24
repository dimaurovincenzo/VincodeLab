#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { createDemoWorkspace } from './create-demo-workspace.mjs'
import { OFFLINE_CHROMIUM_FLAGS, resolvePackagedApp, validatePackagedApp } from './lib/packaged-electron.mjs'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, 'docs', 'assets', 'screenshots')
const DEFAULT_WORKSPACE = '/tmp/VincodeLab-Demo'
const DEFAULT_TIMEOUT_MS = 25_000
const MIN_TIMEOUT_MS = 5_000
const MAX_TIMEOUT_MS = 60_000
const DEFAULT_VIEWPORT = Object.freeze({ width: 1440, height: 900 })

export const SCREENSHOT_MANIFEST = Object.freeze([
  { id: 'ai', fileName: 'ai-workbench.png', title: 'Terminale AI' },
  { id: 'editor', fileName: 'editor-workspace.png', title: 'Editor' },
  { id: 'terminal', fileName: 'terminal-workspace.png', title: 'Terminale' },
  { id: 'git', fileName: 'git-workspace.png', title: 'Git' },
  { id: 'database', fileName: 'database-workspace.png', title: 'Database' },
  { id: 'settings', fileName: 'settings.png', title: 'Impostazioni' },
])

function usage() {
  return [
    'Uso: node scripts/capture-app-screenshots.mjs [opzioni]',
    '',
    'Opzioni:',
    '  --app <percorso.app>  Bundle gia creato; default: release/mac*/VincodeLab.app',
    `  --output <cartella>   Immagini PNG (default: ${DEFAULT_OUTPUT})`,
    `  --workspace <cartella> Workspace demo (default: ${DEFAULT_WORKSPACE})`,
    `  --timeout <ms>        Timeout per vista, ${MIN_TIMEOUT_MS}-${MAX_TIMEOUT_MS} (default ${DEFAULT_TIMEOUT_MS})`,
    '  --keep-workspace      Conserva la workspace demo dopo la cattura',
    '  --json                Output JSON compatto',
    '  --help                Mostra questo messaggio',
    '',
    'La cattura usa il renderer Electron reale con profilo isolato e rete bloccata.',
  ].join('\n')
}

export function parseArguments(argumentsList) {
  const options = {
    appPath: null,
    help: false,
    json: false,
    keepWorkspace: false,
    outputPath: DEFAULT_OUTPUT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    workspacePath: DEFAULT_WORKSPACE,
  }
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--app') {
      const value = argumentsList[++index]
      if (!value) throw new Error('Percorso --app mancante.')
      options.appPath = path.resolve(value)
    } else if (argument === '--output') {
      const value = argumentsList[++index]
      if (!value) throw new Error('Percorso --output mancante.')
      options.outputPath = path.resolve(value)
    } else if (argument === '--workspace') {
      const value = argumentsList[++index]
      if (!value) throw new Error('Percorso --workspace mancante.')
      options.workspacePath = path.resolve(value)
    } else if (argument === '--timeout') options.timeoutMs = Number(argumentsList[++index])
    else if (argument === '--keep-workspace') options.keepWorkspace = true
    else if (argument === '--json') options.json = true
    else if (argument === '--help' || argument === '-h') options.help = true
    else throw new Error(`Argomento non riconosciuto: ${argument}`)
  }
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < MIN_TIMEOUT_MS || options.timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`Timeout non valido: usa un intero tra ${MIN_TIMEOUT_MS} e ${MAX_TIMEOUT_MS} ms.`)
  }
  return options
}

async function reserveLoopbackPort() {
  const { createServer } = await import('node:net')
  const server = createServer()
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve) => server.close(resolve))
  if (!port) throw new Error('Impossibile riservare la porta DevTools locale.')
  return port
}

function createCdpClient(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let sequence = 0
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('close', () => {
    for (const { reject } of pending.values()) reject(new Error('Connessione DevTools chiusa.'))
    pending.clear()
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const request = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  const send = async (method, params = {}) => {
    await opened
    const id = ++sequence
    const response = new Promise((resolve, reject) => pending.set(id, { reject, resolve }))
    socket.send(JSON.stringify({ id, method, params }))
    return response
  }
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Valutazione renderer fallita.')
    return response.result.value
  }
  return { close: () => socket.close(), evaluate, send }
}

async function waitForDebugger(port, deadline, childState) {
  while (Date.now() < deadline) {
    if (childState.exited) throw new Error(`Electron e terminato prima della cattura (code=${childState.code}, signal=${childState.signal ?? 'none'}).`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(300) })
      const targets = await response.json()
      const target = targets.find((candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl)
      if (target) return target
    } catch {}
    await delay(50)
  }
  throw new Error('Renderer Electron non disponibile entro il timeout.')
}

async function createRuntimeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vincodelab-screenshot-runtime-'))
  const directories = {
    cache: path.join(root, 'cache'),
    data: path.join(root, 'data'),
    gh: path.join(root, 'gh'),
    home: path.join(root, 'home'),
    profile: path.join(root, 'profile'),
    temp: path.join(root, 'tmp'),
  }
  await Promise.all(Object.values(directories).map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })))
  await mkdir(path.join(directories.home, 'Library', 'Logs'), { recursive: true, mode: 0o700 })
  const fakePi = path.join(root, 'pi-demo-offline')
  await writeFile(fakePi, `#!/bin/sh
case "$1" in
  --version) printf '%s\\n' 'Pi Agent demo offline 1.0' ; exit 0 ;;
  list) exit 0 ;;
esac
printf '\\033[38;5;99m  PI AGENT · SESSIONE DEMO OFFLINE\\033[0m\\r\\n\\r\\n'
printf '  Analisi di \\033[1mOrbit Metrics\\033[0m completata.\\r\\n'
printf '  \\033[38;5;42m✓\\033[0m 3 servizi verificati\\r\\n'
printf '  \\033[38;5;42m✓\\033[0m test locali superati\\r\\n'
printf '  \\033[38;5;75m→\\033[0m Prossimo passo: prepara la release candidate\\r\\n\\r\\n'
printf '  Il workspace e pronto. Cosa vuoi fare?\\r\\n'
trap 'exit 0' TERM INT HUP
while :; do sleep 60; done
`, { mode: 0o700 })
  await chmod(fakePi, 0o700)
  const fakeShell = path.join(root, 'vincodelab-demo-shell')
  await writeFile(fakeShell, `#!/bin/sh
printf '\\033[38;5;75mvincodelab-demo\\033[0m \\033[38;5;99mOrbit-Metrics\\033[0m $ '
while IFS= read -r command; do
  case "$command" in
    *"npm run check"*)
      printf '\\r\\n  \\033[1mVINCODELAB DEMO WORKSPACE\\033[0m\\r\\n'
      printf '  \\033[38;5;42m✓\\033[0m TypeScript check passed\\r\\n'
      printf '  \\033[38;5;42m✓\\033[0m 1 test passed\\r\\n\\r\\n'
      ;;
    *) printf '\\r\\n  Comando demo completato.\\r\\n\\r\\n' ;;
  esac
  printf '\\033[38;5;75mvincodelab-demo\\033[0m \\033[38;5;99mOrbit-Metrics\\033[0m $ '
done
`, { mode: 0o700 })
  await chmod(fakeShell, 0o700)

  const applicationDatabase = new Database(path.join(directories.data, 'vincodelab.sqlite'))
  try {
    applicationDatabase.exec(`
      CREATE TABLE recent_workspaces (path TEXT PRIMARY KEY NOT NULL, last_opened_at INTEGER NOT NULL);
      CREATE TABLE app_preferences (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    `)
    applicationDatabase.prepare('INSERT INTO app_preferences (key, value) VALUES (?, ?)').run('appearance', 'dark')
  } finally {
    applicationDatabase.close()
  }
  return { root, ...directories, fakePi, fakeShell }
}

function isolatedEnvironment(fixture) {
  return {
    GH_CONFIG_DIR: fixture.gh,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    HOME: fixture.home,
    HTTPS_PROXY: 'http://127.0.0.1:9',
    HTTP_PROXY: 'http://127.0.0.1:9',
    LANG: 'it_IT.UTF-8',
    LOGNAME: 'vincodelab-demo',
    NO_PROXY: '127.0.0.1,localhost',
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    SHELL: fixture.fakeShell,
    TMPDIR: fixture.temp,
    USER: 'vincodelab-demo',
    VINCODELAB_DATA_DIR: fixture.data,
    VINCODELAB_LOGS_DIR: path.join(fixture.root, 'logs'),
    VINCODELAB_PI_PATH: fixture.fakePi,
    XDG_CACHE_HOME: fixture.cache,
    XDG_CONFIG_HOME: path.join(fixture.profile, 'config'),
    XDG_DATA_HOME: path.join(fixture.profile, 'share'),
  }
}

export function electronArguments({ port, profile, workspacePath }) {
  return [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--reliability-benchmark',
    '--screenshot-capture',
    ...OFFLINE_CHROMIUM_FLAGS,
    '--workspace',
    workspacePath,
  ]
}

function rendererBootstrapExpression(databasePath, workspacePath) {
  return `(async () => {
    const deadline = performance.now() + 20000
    const waitFor = async (read, label) => {
      while (performance.now() < deadline) {
        const value = await read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      throw new Error('Timeout preparazione screenshot: ' + label)
    }
    await waitFor(() => document.querySelector('[aria-label="Sezioni applicazione"]'), 'shell applicazione')
    const bridge = window.vincodeLab
    const active = await bridge.workspace.getActive()
    if (active?.path !== ${JSON.stringify(workspacePath)}) throw new Error('Workspace demo non attiva.')
    const captureWindow = await bridge.benchmark?.captureWindowBounds?.()
    if (!captureWindow) throw new Error('Bridge bounds della cattura non disponibile.')
    const connections = await bridge.database.listConnections()
    if (!connections.some((connection) => connection.sqlitePath === ${JSON.stringify(databasePath)})) {
      await bridge.database.createConnection({
        driver: 'sqlite',
        name: 'Orbit Analytics',
        sqlitePath: ${JSON.stringify(databasePath)},
      })
    }
    let captureStyle = document.querySelector('#vincodelab-capture-style')
    if (!captureStyle) {
      captureStyle = document.createElement('style')
      captureStyle.id = 'vincodelab-capture-style'
      captureStyle.textContent = '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important}'
      document.head.append(captureStyle)
    }
    globalThis.__vincodelabCaptureErrors = []
    window.addEventListener('error', (event) => {
      const selectDiagnostics = [...document.querySelectorAll('select')].map((element) => ({
        id: element.id,
        optionCount: element.options?.length,
        optionsIterator: typeof element.options?.[Symbol.iterator],
        optionsType: Object.prototype.toString.call(element.options),
        outerHTML: element.outerHTML.slice(0, 1000),
      }))
      const duplicateIds = [...document.querySelectorAll('[id]')]
        .map((element) => element.id)
        .filter((id, index, ids) => id && ids.indexOf(id) !== index)
      globalThis.__vincodelabCaptureErrors.push({
        duplicateIds: [...new Set(duplicateIds)],
        message: event.message || String(event.error),
        selectDiagnostics,
        stack: event.error?.stack || '',
        type: 'error',
      })
    }, { capture: true })
    window.addEventListener('unhandledrejection', (event) => {
      globalThis.__vincodelabCaptureErrors.push({
        message: event.reason?.message || String(event.reason),
        stack: event.reason?.stack || '',
        type: 'unhandledrejection',
      })
    }, { capture: true })
    return { captureWindow, title: document.title, workspace: active.path }
  })()`
}

function navigationExpression(label, preparation = '') {
  return `(async () => {
    const deadline = performance.now() + 20000
    const waitFor = async (read, name) => {
      while (performance.now() < deadline) {
        const value = await read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      throw new Error('Timeout vista screenshot: ' + name)
    }
    const navigation = await waitFor(() => document.querySelector('[aria-label="Sezioni applicazione"]'), 'navigazione')
    const trigger = [...navigation.querySelectorAll('[role="tab"]')].find((element) => element.textContent?.trim() === ${JSON.stringify(label)})
    if (!trigger) throw new Error('Sezione non trovata: ' + ${JSON.stringify(label)})
    trigger.click()
    ${preparation}
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return true
  })()`
}

export function screenshotPreparationExpression(id) {
  if (id === 'ai') return navigationExpression('AI', `
    const host = await waitFor(() => document.querySelector('[data-xterm-host="ai"]'), 'terminale AI')
    await waitFor(() => host.querySelector('.xterm-rows')?.textContent?.includes('SESSIONE DEMO OFFLINE'), 'output AI demo')
  `)
  if (id === 'editor') return navigationExpression('Editor', `
    const editor = await waitFor(() => document.querySelector('[aria-label="Editor progetto"]'), 'Editor progetto')
    let file = editor.querySelector('[data-workspace-context-id="src/dashboard.ts"]')
    if (!file) {
      const sourceDirectory = await waitFor(() => editor.querySelector('[data-workspace-context-id="src"]'), 'cartella src')
      const expandSource = sourceDirectory.querySelector('[aria-label="src: espandi o comprimi"]')
        ?? editor.querySelector('[aria-label="src: espandi o comprimi"]')
      if (!expandSource) throw new Error('Controllo espansione src non trovato.')
      expandSource.click()
      file = await waitFor(() => editor.querySelector('[data-workspace-context-id="src/dashboard.ts"]'), 'file dashboard.ts; elementi: '
        + [...editor.querySelectorAll('[data-workspace-context-id]')].map((element) => element.getAttribute('data-workspace-context-id')).join(', '))
    }
    file.click()
    await waitFor(() => editor.querySelector('.cm-content')?.textContent?.includes('ServiceMetric'), 'contenuto dashboard.ts')
  `)
  if (id === 'terminal') return navigationExpression('Terminale', `
    const workspace = await waitFor(() => document.querySelector('[aria-label="Terminale e file remoti"]'), 'workspace Terminale')
    await waitFor(() => workspace.querySelector('.xterm-rows')?.textContent?.includes('vincodelab-demo'), 'prompt terminale demo')
    const snapshot = await waitFor(async () => {
      const value = await window.vincodeLab.shellSessions.list()
      return value?.sessions?.length ? value : null
    }, 'sessione shell')
    const session = snapshot.sessions.find((entry) => entry.sessionId === snapshot.activeSessionId) ?? snapshot.sessions[0]
    window.vincodeLab.shellSessions.write(session.sessionId, 'npm run check\\r')
    await waitFor(() => workspace.querySelector('.xterm-rows')?.textContent?.includes('TypeScript check passed'), 'output terminale demo')
  `)
  if (id === 'git') return navigationExpression('GitHub', `
    const changes = await waitFor(() => document.querySelector('[aria-label="Preparazione commit"]'), 'modifiche Git')
    const file = await waitFor(() => [...changes.querySelectorAll('button')].find((element) => element.textContent?.includes('src/dashboard.ts')), 'diff dashboard.ts')
    file.click()
    await waitFor(() => document.querySelector('pre')?.textContent?.includes('dashboardFilters'), 'contenuto diff')
  `)
  if (id === 'database') return navigationExpression('Database', `
    const workspace = await waitFor(() => document.querySelector('[aria-label="Database workspace"]'), 'workspace Database')
    await waitFor(() => workspace.getAttribute('aria-busy') === 'false' && workspace.querySelector('[aria-label="Editor SQL"] .cm-content'), 'connessione SQLite')
    workspace.querySelector('[aria-label="Editor SQL"] .cm-content').focus()
  `)
  if (id === 'settings') return navigationExpression('Impostazioni', `
    await waitFor(() => document.querySelector('[aria-label="Impostazioni"]'), 'pagina Impostazioni')
    await waitFor(() => [...document.querySelectorAll('[aria-label="Sezioni Impostazioni"] [role="tab"]')].some((element) => element.textContent?.trim() === 'Generali'), 'impostazioni generali')
  `)
  throw new Error(`Vista screenshot non riconosciuta: ${id}`)
}

async function prepareDatabaseResults(cdp) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 })
  await cdp.send('Input.insertText', {
    text: "SELECT name AS servizio, environment AS ambiente, availability AS disponibilita, latency_ms AS latenza_ms, status\nFROM services\nORDER BY availability DESC;",
  })
  await cdp.evaluate(`(async () => {
    const deadline = performance.now() + 15000
    const waitFor = async (read, label) => {
      while (performance.now() < deadline) {
        const value = read()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 40))
      }
      throw new Error('Timeout risultati Database: ' + label)
    }
    const workspace = document.querySelector('[aria-label="Database workspace"]')
    const execute = await waitFor(() => [...workspace.querySelectorAll('button')]
      .find((element) => element.textContent?.includes('Esegui') && !element.disabled), 'comando Esegui Database; pulsanti: '
        + [...workspace.querySelectorAll('button')].map((element) => (element.textContent?.trim() || element.getAttribute('aria-label') || '?') + ':' + element.disabled).join(', '))
    execute.click()
    await waitFor(() => workspace.querySelector('table')?.textContent?.includes('API Gateway'), 'righe SQLite')
    return true
  })()`)
}

export function assertCleanRendererText(text) {
  if (typeof text !== 'string') throw new Error('Testo renderer non disponibile per la verifica privacy.')
  const forbidden = [
    /\/Users\//u,
    /\b(?:access[_-]?token|api[_-]?key|password|secret)\s*[:=]/iu,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  ]
  const match = forbidden.find((pattern) => pattern.test(text))
  if (match) throw new Error(`La vista contiene dati non ammessi per la pubblicazione (${match}).`)
  const privateMachineMarkers = new Set([
    os.userInfo().username,
    os.hostname(),
    path.basename(os.homedir()),
  ].filter((value) => typeof value === 'string' && value.length >= 3).map((value) => value.toLocaleLowerCase('en-US')))
  const normalizedText = text.toLocaleLowerCase('en-US')
  const privateMarker = [...privateMachineMarkers].find((marker) => normalizedText.includes(marker))
  if (privateMarker) throw new Error('La vista contiene un identificatore dell’account o del computer locale.')
}

export function pngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Screenshot PNG non valido.')
  }
  return { height: buffer.readUInt32BE(20), width: buffer.readUInt32BE(16) }
}

export function shellGeometryExpression() {
  return `(() => {
    const viewport = {
      devicePixelRatio: window.devicePixelRatio,
      height: window.innerHeight,
      visualHeight: window.visualViewport?.height ?? window.innerHeight,
      visualWidth: window.visualViewport?.width ?? window.innerWidth,
      width: window.innerWidth,
    }
    const root = document.querySelector('main')
    const navigation = document.querySelector('[aria-label="Sezioni applicazione"]')
    if (!root || !navigation) throw new Error('Shell non disponibile per la verifica geometrica.')
    const serialize = (element) => {
      const rect = element.getBoundingClientRect()
      return { bottom: rect.bottom, height: rect.height, left: rect.left, right: rect.right, top: rect.top, width: rect.width }
    }
    const rootBounds = serialize(root)
    const navigationBounds = serialize(navigation)
    const sectionBounds = [...navigation.querySelectorAll('[role="tab"]')].map((element) => ({ label: element.textContent?.trim() ?? '', ...serialize(element) }))
    const inside = (rect) => rect.left >= -1 && rect.top >= -1 && rect.right <= viewport.width + 1 && rect.bottom <= viewport.height + 1
    return {
      document: { height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth },
      navigationBounds,
      rootBounds,
      sectionBounds,
      shellVisible: inside(rootBounds) && inside(navigationBounds) && sectionBounds.every(inside)
        && document.documentElement.scrollWidth <= viewport.width + 1
        && document.documentElement.scrollHeight <= viewport.height + 1,
      viewport,
    }
  })()`
}

export function cleanCaptureSurfaceExpression() {
  return `(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const alerts = [...document.querySelectorAll('[role="alert"]')]
      .filter(visible)
      .map((element) => element.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 240) ?? '')
    const errorToasts = [...document.querySelectorAll('[data-scope="toast"], [data-part="root"]')]
      .filter((element) => visible(element) && /Azione interrotta|Operazione asincrona non completata|Ricarica interfaccia|Riferimento ERR-/u.test(element.textContent ?? ''))
      .map((element) => element.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 240) ?? '')
    return {
      alerts: [...new Set(alerts)],
      invalidHiddenSelects: [...document.querySelectorAll('[id]')]
        .filter((element) => /(?::select|hidden-select)$/u.test(element.id) && (element.tagName !== 'SELECT' || typeof element.options?.[Symbol.iterator] !== 'function'))
        .map((element) => ({ id: element.id, optionsType: typeof element.options, tagName: element.tagName })),
      errorToasts: [...new Set(errorToasts)],
      rendererErrors: Array.isArray(globalThis.__vincodelabCaptureErrors) ? globalThis.__vincodelabCaptureErrors : [],
    }
  })()`
}

async function captureView(cdp, spec, outputPath) {
  await cdp.evaluate(screenshotPreparationExpression(spec.id))
  if (spec.id === 'database') await prepareDatabaseResults(cdp)
  const text = await cdp.evaluate(`document.body?.innerText ?? ''`)
  assertCleanRendererText(text)
  const surface = await cdp.evaluate(cleanCaptureSurfaceExpression())
  if (surface.rendererErrors.length > 0 || surface.alerts.length > 0 || surface.errorToasts.length > 0 || surface.invalidHiddenSelects.length > 0) {
    throw new Error(`Vista ${spec.id} non pulita: ${JSON.stringify(surface)}`)
  }
  const geometry = await cdp.evaluate(shellGeometryExpression())
  if (!geometry.shellVisible) throw new Error(`Shell tagliata nella vista ${spec.id}: ${JSON.stringify(geometry)}`)
  const response = await cdp.send('Page.captureScreenshot', { captureBeyondViewport: false, format: 'png', fromSurface: true })
  const buffer = Buffer.from(response.data, 'base64')
  const dimensions = pngDimensions(buffer)
  if (dimensions.width !== DEFAULT_VIEWPORT.width || dimensions.height !== DEFAULT_VIEWPORT.height) {
    throw new Error(`Dimensioni screenshot inattese per ${spec.id}: ${dimensions.width}x${dimensions.height}.`)
  }
  const filePath = path.join(outputPath, spec.fileName)
  await writeFile(filePath, buffer)
  return { ...dimensions, filePath, id: spec.id, shellVisible: true, size: buffer.length, title: spec.title }
}

async function shutdown({ cdp, child, exited }) {
  try { await cdp?.evaluate('window.vincodeLab?.benchmark?.shutdown()') } catch {}
  cdp?.close()
  await Promise.race([exited, delay(5_000)])
  if (child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, 'SIGTERM') } catch {}
    await Promise.race([exited, delay(2_000)])
  }
  if (child.exitCode === null && child.signalCode === null) {
    try { process.kill(-child.pid, 'SIGKILL') } catch {}
    await Promise.race([exited, delay(1_000)])
  }
}

async function cleanupWorkspace(workspacePath) {
  const marker = path.join(workspacePath, '.vincodelab-demo-workspace.json')
  const markerStats = await lstat(marker)
  if (!markerStats.isFile() || markerStats.isSymbolicLink()) throw new Error('Cleanup workspace demo rifiutato: marker non valido.')
  const parsed = JSON.parse(await readFile(marker, 'utf8'))
  if (parsed?.kind !== 'vincodelab-demo-workspace' || parsed?.version !== 1) throw new Error('Cleanup workspace demo rifiutato: marker non riconosciuto.')
  await rm(workspacePath, { recursive: true, force: false })
}

export async function captureAppScreenshots({
  appPath,
  keepWorkspace = false,
  outputPath = DEFAULT_OUTPUT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  workspacePath = DEFAULT_WORKSPACE,
} = {}) {
  if (process.platform !== 'darwin') throw new Error('La cattura dell’app Electron richiede macOS.')
  const bundle = await validatePackagedApp(await resolvePackagedApp({ appPath }))
  const demo = await createDemoWorkspace({ force: true, initializeGit: true, outputPath: workspacePath })
  const fixture = await createRuntimeFixture()
  await mkdir(outputPath, { recursive: true })
  const port = await reserveLoopbackPort()
  const child = spawn(bundle.executable, electronArguments({ port, profile: fixture.profile, workspacePath: demo.workspacePath }), {
    cwd: demo.workspacePath,
    detached: true,
    env: isolatedEnvironment(fixture),
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_384) })
  const childState = { code: null, exited: false, signal: null }
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => {
    childState.code = code
    childState.exited = true
    childState.signal = signal
    resolve()
  }))
  child.once('error', (error) => {
    stderr = `${stderr}\n${error.message}`
    childState.exited = true
  })

  let cdp
  let primaryError
  let layout
  const screenshots = []
  try {
    const target = await waitForDebugger(port, Date.now() + timeoutMs, childState)
    cdp = createCdpClient(target.webSocketDebuggerUrl)
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable')])
    const nativeViewport = await cdp.evaluate(`({
      devicePixelRatio: window.devicePixelRatio,
      height: window.innerHeight,
      outerHeight: window.outerHeight,
      outerWidth: window.outerWidth,
      screenX: window.screenX,
      screenY: window.screenY,
      visualHeight: window.visualViewport?.height ?? window.innerHeight,
      visualWidth: window.visualViewport?.width ?? window.innerWidth,
      width: window.innerWidth,
    })`)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 1,
      height: DEFAULT_VIEWPORT.height,
      mobile: false,
      screenHeight: DEFAULT_VIEWPORT.height,
      screenWidth: DEFAULT_VIEWPORT.width,
      width: DEFAULT_VIEWPORT.width,
    })
    await cdp.send('Emulation.setLocaleOverride', { locale: 'it-IT' })
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Rome' })
    const captureViewport = await cdp.evaluate(`({
      devicePixelRatio: window.devicePixelRatio,
      height: window.innerHeight,
      visualHeight: window.visualViewport?.height ?? window.innerHeight,
      visualWidth: window.visualViewport?.width ?? window.innerWidth,
      width: window.innerWidth,
    })`)
    layout = {
      captureViewport,
      nativeViewport,
    }
    if (captureViewport.width !== DEFAULT_VIEWPORT.width || captureViewport.height !== DEFAULT_VIEWPORT.height) {
      throw new Error(`Viewport di cattura non valido: ${JSON.stringify(layout)}`)
    }
    const bootstrap = await cdp.evaluate(rendererBootstrapExpression(demo.databasePath, demo.workspacePath))
    layout.window = bootstrap.captureWindow
    const captureBounds = bootstrap.captureWindow.bounds
    const contentBounds = bootstrap.captureWindow.contentBounds
    if (bootstrap.captureWindow.maximized || bootstrap.captureWindow.visible
      || captureBounds?.width !== DEFAULT_VIEWPORT.width || captureBounds?.height !== DEFAULT_VIEWPORT.height
      || contentBounds?.width !== DEFAULT_VIEWPORT.width || contentBounds?.height !== DEFAULT_VIEWPORT.height) {
      throw new Error(`Finestra di cattura non confinata: ${JSON.stringify(layout)}`)
    }
    for (const spec of SCREENSHOT_MANIFEST) screenshots.push(await captureView(cdp, spec, outputPath))
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error))
  } finally {
    try { await shutdown({ cdp, child, exited }) } catch (error) { primaryError ??= error }
    child.stderr.destroy()
    await rm(fixture.root, { recursive: true, force: true })
    if (!keepWorkspace) {
      try { await cleanupWorkspace(demo.workspacePath) } catch (error) { primaryError ??= error }
    }
  }
  if (primaryError) throw new Error(`${primaryError.message}${stderr.trim() ? `; stderr Electron: ${stderr.trim().slice(-2_000)}` : ''}`, { cause: primaryError })
  return {
    appPath: bundle.appPath,
    layout,
    network: 'offline',
    outputPath: await realpath(outputPath),
    screenshots,
    viewport: DEFAULT_VIEWPORT,
    workspaceKept: keepWorkspace,
  }
}

export async function main(argumentsList = process.argv.slice(2)) {
  const options = parseArguments(argumentsList)
  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }
  const result = await captureAppScreenshots(options)
  process.stdout.write(`${JSON.stringify(result, null, options.json ? 0 : 2)}\n`)
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`[capture-app-screenshots] ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
