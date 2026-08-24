#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createDemoWorkspace } from './create-demo-workspace.mjs'
import {
  assertCleanRendererText,
  cleanCaptureSurfaceExpression,
  pngDimensions,
  shellGeometryExpression,
} from './lib/app-screenshots/capture-validation.mjs'
import {
  prepareDatabaseResults,
  rendererBootstrapExpression,
  SCREENSHOT_MANIFEST,
  screenshotPreparationExpression,
} from './lib/app-screenshots/renderer-scenarios.mjs'
import { cleanupWorkspace, createRuntimeFixture, isolatedEnvironment } from './lib/app-screenshots/runtime-fixture.mjs'
import { OFFLINE_CHROMIUM_FLAGS, resolvePackagedApp, validatePackagedApp } from './lib/packaged-electron.mjs'

export {
  assertCleanRendererText,
  cleanCaptureSurfaceExpression,
  pngDimensions,
  SCREENSHOT_MANIFEST,
  shellGeometryExpression,
  screenshotPreparationExpression,
}

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, 'docs', 'assets', 'screenshots')
const DEFAULT_WORKSPACE = '/tmp/VincodeLab-Demo'
const DEFAULT_TIMEOUT_MS = 25_000
const MIN_TIMEOUT_MS = 5_000
const MAX_TIMEOUT_MS = 60_000
const DEFAULT_VIEWPORT = Object.freeze({ width: 1440, height: 900 })

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
