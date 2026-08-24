#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { chmod, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON = path.join(ROOT, 'node_modules', '.bin', 'electron')
const DEFAULT_RUNS = 10
const RUN_TIMEOUT_MS = 30_000

function unrefDelay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds)
    timer.unref?.()
  })
}

function parseArguments(args) {
  const options = { runs: DEFAULT_RUNS, mode: 'both', output: null }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--runs') options.runs = Number(args[++index])
    else if (argument === '--mode') options.mode = args[++index]
    else if (argument === '--output') options.output = path.resolve(args[++index])
    else throw new Error(`Argomento non riconosciuto: ${argument}`)
  }
  if (!Number.isInteger(options.runs) || options.runs < 1 || options.runs > 50) throw new Error('Numero run non valido.')
  if (!['cold', 'warm', 'both'].includes(options.mode)) throw new Error('Modalità benchmark non valida.')
  return options
}

async function reservePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function waitForDebugger(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const target = targets.find((candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl)
      if (target) return target.webSocketDebuggerUrl
    } catch {}
    await delay(40)
  }
  throw new Error('Renderer Electron non disponibile entro il timeout.')
}

function createCdpClient(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let sequence = 0
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
  })
  const send = async (method, params = {}) => {
    await opened
    const id = ++sequence
    const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    socket.send(JSON.stringify({ id, method, params }))
    return response
  }
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Valutazione renderer fallita.')
    return result.result.value
  }
  return { evaluate, send, close: () => socket.close() }
}

function rendererScenario() {
  return String.raw`(async () => {
    const waitFor = async (predicate, label, timeoutMs = 15000) => {
      const deadline = performance.now() + timeoutMs
      while (performance.now() < deadline) {
        const value = predicate()
        if (value) return value
        await new Promise((resolve) => setTimeout(resolve, 16))
      }
      const dialog = document.querySelector('[data-scope="dialog"][data-part="content"][role="dialog"][data-state="open"]')
      const visibleText = document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 800) ?? ''
      throw new Error('Timeout benchmark: ' + label + (dialog ? '; dialog=' + dialog.outerHTML.slice(0, 500) : '') + '; text=' + visibleText)
    }
    const clickTab = async (label, ready) => {
      const started = performance.now()
      const tab = await waitFor(() => [...document.querySelectorAll('[role="tab"]')].find((item) => item.textContent?.trim() === label), 'tab ' + label)
      tab.click()
      await waitFor(ready, label)
      return performance.now() - started
    }
    const shortcut = async (shiftKey) => {
      const started = performance.now()
      const benchmarkBridge = window.vincodeLab?.benchmark
      if (!benchmarkBridge) throw new Error('Bridge benchmark non disponibile.')
      await benchmarkBridge.dispatchCommand(shiftKey ? 'workbench.commandPalette' : 'workbench.quickOpen')
      const openPalette = () => document.querySelector('[data-scope="dialog"][data-part="content"][role="dialog"][data-state="open"]')
      await waitFor(openPalette, shiftKey ? 'Command Palette' : 'Quick Open')
      const elapsed = performance.now() - started
      const escape = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
      Object.defineProperties(escape, {
        keyCode: { get: () => 27 },
        which: { get: () => 27 },
      })
      ;(document.activeElement ?? document).dispatchEvent(escape)
      // Ark aggiorna lo stato del dialog in modo asincrono. Lascia prima che
      // Escape completi la chiusura; il fallback deve riprodurre una sequenza
      // pointer completa per non lasciare listener once in attesa.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const backdrop = document.querySelector('[data-scope="dialog"][data-part="backdrop"]')
      if (backdrop && openPalette()) {
        backdrop.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
        backdrop.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }
      await waitFor(() => !openPalette(), 'chiusura palette')
      return elapsed
    }
    const navigation = await waitFor(() => document.querySelector('[aria-label="Sezioni applicazione"]'), 'workbench')
    const startupReadyAt = performance.timeOrigin + performance.now()
    const commandPaletteMs = await shortcut(true)
    const quickOpenMs = await shortcut(false)
    const editorMs = await clickTab('Editor', () => document.querySelector('[aria-label="Editor progetto"]'))
    const terminalMs = await clickTab('Terminale', () => document.querySelector('[aria-label="Terminale e file remoti"]'))
    const githubMs = await clickTab('GitHub', () => document.querySelector('[aria-label="Sezioni GitHub"]')
      || [...document.querySelectorAll('h2')].find((item) => item.textContent?.trim() === 'Nessun repository Git'))
    const databaseMs = await clickTab('Database', () => {
      const root = document.querySelector('[aria-label="Database workspace"]')
      const connect = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Connetti' && !item.disabled)
      return root && root.getAttribute('aria-busy') !== 'true' && connect ? connect : null
    })
    const connectionStarted = performance.now()
    const connect = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Connetti' && !item.disabled)
    connect.click()
    await waitFor(() => [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Esegui' && !item.disabled), 'connessione Database')
    const databaseConnectMs = performance.now() - connectionStarted
    const queryStarted = performance.now()
    const execute = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Esegui' && !item.disabled)
    execute.click()
    await waitFor(() => [...document.querySelectorAll('td')].some((cell) => cell.textContent === '1'), 'query SQLite')
    const sqliteQueryMs = performance.now() - queryStarted
    return { startupReadyAt, commandPaletteMs, quickOpenMs, editorMs, terminalMs, githubMs, databaseMs, databaseConnectMs, sqliteQueryMs, navigationConnected: navigation.isConnected }
  })()`
}

async function processMetrics(rootPid) {
  const result = await new Promise((resolve) => {
    const child = spawn('/bin/ps', ['-axo', 'pid=,ppid=,%cpu=,rss='], { stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { output += chunk })
    child.once('close', () => resolve(output))
  })
  const rows = String(result).trim().split('\n').map((line) => line.trim().split(/\s+/u).map(Number)).filter((row) => row.length === 4)
  const descendants = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const [pid, ppid] of rows) if (descendants.has(ppid) && !descendants.has(pid)) { descendants.add(pid); changed = true }
  }
  const owned = rows.filter(([pid]) => descendants.has(pid))
  return {
    processCount: owned.length,
    cpuPercent: owned.reduce((total, row) => total + row[2], 0),
    rssBytes: owned.reduce((total, row) => total + row[3] * 1024, 0),
  }
}

async function prepareFixture(root, dataDirectory) {
  const workspaceDirectory = path.join(root, 'workspace')
  const sqlitePath = path.join(root, 'fixture.sqlite')
  const fakePi = path.join(root, 'pi-fixture')
  await mkdir(workspaceDirectory, { recursive: true })
  // Il main canonicalizza i workspace (su macOS /var diventa /private/var):
  // anche la fixture Database deve usare la stessa identità.
  const workspace = await realpath(workspaceDirectory)
  await writeFile(path.join(workspace, 'README.md'), '# Benchmark fixture\n')
  await writeFile(fakePi, '#!/bin/sh\nexit 0\n')
  await chmod(fakePi, 0o700)
  const previousDataDirectory = process.env.VINCODELAB_DATA_DIR
  process.env.VINCODELAB_DATA_DIR = dataDirectory
  const { createConnection, listConnections } = require('../electron/infrastructure/persistence/database.repository.cjs')
  const { closeDatabase } = require('../electron/infrastructure/persistence/workspace.repository.cjs')
  if (!listConnections(workspace).length) createConnection(workspace, { name: 'Benchmark SQLite', driver: 'sqlite', sqlitePath })
  closeDatabase()
  if (previousDataDirectory === undefined) delete process.env.VINCODELAB_DATA_DIR
  else process.env.VINCODELAB_DATA_DIR = previousDataDirectory
  return { workspace, fakePi }
}

async function runOnce({ dataDirectory, profileDirectory, fixture }) {
  const port = await reservePort()
  const startedAt = Date.now()
  const child = spawn(ELECTRON, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    '--reliability-benchmark',
    ROOT,
    '--workspace', fixture.workspace,
  ], {
    cwd: ROOT,
    detached: true,
    env: { ...process.env, VINCODELAB_DATA_DIR: dataDirectory, VINCODELAB_PI_PATH: fixture.fakePi },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  const childExited = new Promise((resolve) => child.once('exit', resolve))
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { if (stderr.length < 32_768) stderr += chunk })
  const deadline = Date.now() + RUN_TIMEOUT_MS
  let cdp
  let sample
  let failure
  try {
    cdp = createCdpClient(await waitForDebugger(port, deadline))
    await cdp.send('Runtime.enable')
    const timings = await cdp.evaluate(rendererScenario())
    await delay(2_000)
    await cdp.send('HeapProfiler.enable')
    await cdp.send('HeapProfiler.collectGarbage')
    const rendererHeap = await cdp.send('Runtime.getHeapUsage')
    const idle = await processMetrics(child.pid)
    sample = { ...timings, startupMs: timings.startupReadyAt - startedAt, rendererHeapBytes: rendererHeap.usedSize, idle }
  } catch (error) {
    failure = new Error(`${error.message}; Electron stderr: ${stderr.trim().slice(0, 512) || '<vuoto>'}`)
  } finally {
    const shutdownStarted = performance.now()
    try { await Promise.race([cdp?.evaluate('window.vincodeLab?.benchmark?.shutdown()'), unrefDelay(1_000)]) } catch {}
    cdp?.close()
    let gracefulExit = false
    await Promise.race([
      childExited.then(() => { gracefulExit = true }),
      unrefDelay(8_000),
    ])
    if (!gracefulExit) {
      try { process.kill(-child.pid, 'SIGTERM') } catch { try { child.kill('SIGTERM') } catch {} }
      await Promise.race([childExited, unrefDelay(1_000)])
      if (child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch {} }
      }
      child.stderr.destroy()
      const cleanupFailure = `Electron non ha completato il cleanup benchmark; stderr: ${stderr.trim().slice(0, 1_024) || '<vuoto>'}`
      failure = new Error(failure ? `${failure.message}; ${cleanupFailure}` : cleanupFailure)
    }
    child.stderr.destroy()
    if (sample) sample.shutdownMs = performance.now() - shutdownStarted
  }
  if (failure) throw failure
  return sample
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]
}

function summarizeValues(values) {
  return {
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    min: percentile(values, 0),
    max: percentile(values, 1),
  }
}

function summarize(samples) {
  const keys = ['startupMs', 'commandPaletteMs', 'quickOpenMs', 'editorMs', 'terminalMs', 'githubMs', 'databaseMs', 'databaseConnectMs', 'sqliteQueryMs', 'shutdownMs', 'rendererHeapBytes']
  return {
    ...Object.fromEntries(keys.map((key) => [key, summarizeValues(samples.map((sample) => sample[key]))])),
    idle: {
      processCount: summarizeValues(samples.map((sample) => sample.idle.processCount)),
      cpuPercent: summarizeValues(samples.map((sample) => sample.idle.cpuPercent)),
      rssBytes: summarizeValues(samples.map((sample) => sample.idle.rssBytes)),
    },
  }
}

async function runSeries(mode, runs) {
  const sharedRoot = mode === 'warm' ? await mkdtemp(path.join(os.tmpdir(), 'vincodelab-benchmark-warm-')) : null
  const samples = []
  try {
    for (let index = 0; index < runs; index += 1) {
      const root = sharedRoot ?? await mkdtemp(path.join(os.tmpdir(), 'vincodelab-benchmark-cold-'))
      try {
        const dataDirectory = path.join(root, 'data')
        const profileDirectory = path.join(root, 'profile')
        await mkdir(dataDirectory, { recursive: true })
        await mkdir(profileDirectory, { recursive: true })
        const fixture = await prepareFixture(root, dataDirectory)
        samples.push(await runOnce({ dataDirectory, profileDirectory, fixture }))
      } finally {
        if (!sharedRoot) await rm(root, { recursive: true, force: true })
      }
    }
    return { runs, samples, summary: summarize(samples) }
  } finally {
    if (sharedRoot) await rm(sharedRoot, { recursive: true, force: true })
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), suite: 'reliability-benchmark', cold: null, warm: null }
  if (options.mode !== 'warm') report.cold = await runSeries('cold', options.runs)
  if (options.mode !== 'cold') report.warm = await runSeries('warm', options.runs)
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  if (options.output) await writeFile(options.output, serialized)
  process.stdout.write(serialized)
}

await main()
