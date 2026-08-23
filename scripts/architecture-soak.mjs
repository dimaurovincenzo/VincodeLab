#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setImmediate as yieldImmediate, setTimeout as delay } from 'node:timers/promises'

import { ARCHITECTURE_SCENARIOS, runArchitectureScenario } from './architecture-soak-scenarios.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..')
const REPORT_VERSION = 1
const OUTPUT_LIMIT_BYTES = 512 * 1024

export const ARCHITECTURE_STRESS_PROFILES = Object.freeze({
  test: Object.freeze({
    terminalBytes: 512 * 1024,
    shellCycles: 8,
    sqliteRows: 128,
    sqliteRecursiveRows: 50_000,
    sqliteTimeoutMs: 10_000,
    updateRounds: 1,
    updateContenders: 2,
    workspaceCycles: 12,
    workspaceCorruptCases: 3,
    eventLoopMaxDelayMs: 2_500,
    scenarioTimeoutMs: 20_000,
  }),
  smoke: Object.freeze({
    terminalBytes: 8 * 1024 * 1024,
    shellCycles: 100,
    sqliteRows: 1_200,
    sqliteRecursiveRows: 750_000,
    sqliteTimeoutMs: 20_000,
    updateRounds: 2,
    updateContenders: 4,
    workspaceCycles: 250,
    workspaceCorruptCases: 12,
    eventLoopMaxDelayMs: 2_500,
    scenarioTimeoutMs: 60_000,
  }),
  full: Object.freeze({
    terminalBytes: 100 * 1024 * 1024,
    shellCycles: 1_000,
    sqliteRows: 5_000,
    sqliteRecursiveRows: 5_000_000,
    sqliteTimeoutMs: 60_000,
    updateRounds: 5,
    updateContenders: 8,
    workspaceCycles: 2_000,
    workspaceCorruptCases: 60,
    eventLoopMaxDelayMs: 5_000,
    scenarioTimeoutMs: 300_000,
  }),
})

export function parseArchitectureStressArguments(argumentsList) {
  let profile = 'full'
  let scenario = null
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--profile') {
      profile = argumentsList[++index]
      continue
    }
    if (argument === '--scenario') {
      scenario = argumentsList[++index]
      continue
    }
    throw new Error(`Argomento non riconosciuto: ${argument}`)
  }
  if (!Object.hasOwn(ARCHITECTURE_STRESS_PROFILES, profile)) throw new Error('Profilo stress non valido.')
  if (scenario !== null && !Object.hasOwn(ARCHITECTURE_SCENARIOS, scenario)) throw new Error('Scenario stress non valido.')
  return { profile, scenario }
}

function privacySafeError(error) {
  const workspacePattern = PROJECT_ROOT.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const message = String(error?.message ?? error ?? 'Errore sconosciuto')
    .replace(new RegExp(workspacePattern, 'gu'), '<workspace>')
    .replace(/\/(?:private\/)?(?:var|tmp)\/[\w./-]+/gu, '<temporary>')
    .slice(0, 512)
  return { name: typeof error?.name === 'string' ? error.name : 'Error', message }
}

function safeChildEnvironment() {
  const environment = { VINCODELAB_ARCHITECTURE_STRESS: '1' }
  for (const name of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'DYLD_LIBRARY_PATH']) {
    if (process.env[name] !== undefined) environment[name] = process.env[name]
  }
  return environment
}

async function runMeasuredScenario(name, profile) {
  const config = ARCHITECTURE_STRESS_PROFILES[profile]
  const eventLoop = monitorEventLoopDelay({ resolution: 10 })
  eventLoop.enable()
  await yieldImmediate()
  const started = performance.now()
  try {
    const metrics = await runArchitectureScenario(name, config)
    await delay(20)
    eventLoop.disable()
    const eventLoopMetrics = {
      maxDelayMs: eventLoop.max / 1_000_000,
      p99DelayMs: eventLoop.percentile(99) / 1_000_000,
      meanDelayMs: Number.isFinite(eventLoop.mean) ? eventLoop.mean / 1_000_000 : 0,
      thresholdMs: config.eventLoopMaxDelayMs,
    }
    if (eventLoopMetrics.maxDelayMs > config.eventLoopMaxDelayMs) {
      throw new Error(`Event loop starvation: ${eventLoopMetrics.maxDelayMs.toFixed(1)} ms oltre ${config.eventLoopMaxDelayMs} ms.`)
    }
    return {
      schemaVersion: REPORT_VERSION,
      scenario: name,
      profile,
      ok: true,
      durationMs: performance.now() - started,
      eventLoop: eventLoopMetrics,
      metrics,
    }
  } catch (error) {
    eventLoop.disable()
    return {
      schemaVersion: REPORT_VERSION,
      scenario: name,
      profile,
      ok: false,
      durationMs: performance.now() - started,
      error: privacySafeError(error),
    }
  }
}

function runScenarioChild(name, profile) {
  const config = ARCHITECTURE_STRESS_PROFILES[profile]
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, '--profile', profile, '--scenario', name], {
      cwd: PROJECT_ROOT,
      env: safeChildEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let exceededOutputLimit = false
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      const forceTimer = setTimeout(() => child.kill('SIGKILL'), 1_000)
      forceTimer.unref?.()
    }, config.scenarioTimeoutMs)
    timeout.unref?.()

    const append = (target, chunk) => {
      const next = target + chunk
      if (Buffer.byteLength(next, 'utf8') <= OUTPUT_LIMIT_BYTES) return next
      exceededOutputLimit = true
      child.kill('SIGKILL')
      return target
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk) })
    child.once('error', (error) => {
      clearTimeout(timeout)
      resolve({ schemaVersion: REPORT_VERSION, scenario: name, profile, ok: false, error: privacySafeError(error) })
    })
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      if (timedOut) {
        resolve({ schemaVersion: REPORT_VERSION, scenario: name, profile, ok: false, error: { name: 'ScenarioTimeoutError', message: `Scenario oltre il limite di ${config.scenarioTimeoutMs} ms.` } })
        return
      }
      if (exceededOutputLimit) {
        resolve({ schemaVersion: REPORT_VERSION, scenario: name, profile, ok: false, error: { name: 'ScenarioOutputError', message: 'Output scenario oltre il limite sicuro.' } })
        return
      }
      try {
        const report = JSON.parse(stdout.trim())
        if (!report || report.scenario !== name || report.profile !== profile || typeof report.ok !== 'boolean') throw new Error('Report scenario non valido.')
        if (code !== 0 && report.ok) throw new Error(`Scenario terminato con codice ${code ?? signal ?? 'unknown'}.`)
        resolve(report)
      } catch (error) {
        const detail = stderr.trim() ? `${error.message}; stderr disponibile ma omesso dal report.` : error.message
        resolve({ schemaVersion: REPORT_VERSION, scenario: name, profile, ok: false, error: privacySafeError(new Error(detail)) })
      }
    })
  })
}

export async function runArchitectureStress(profile = 'full') {
  if (!Object.hasOwn(ARCHITECTURE_STRESS_PROFILES, profile)) throw new Error('Profilo stress non valido.')
  const started = performance.now()
  const scenarios = []
  for (const name of Object.keys(ARCHITECTURE_SCENARIOS)) scenarios.push(await runScenarioChild(name, profile))
  return {
    schemaVersion: REPORT_VERSION,
    suite: 'architecture-stress',
    profile,
    ok: scenarios.every((scenario) => scenario.ok),
    durationMs: performance.now() - started,
    scenarios,
  }
}

async function main() {
  let parsed
  try {
    parsed = parseArchitectureStressArguments(process.argv.slice(2))
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ schemaVersion: REPORT_VERSION, suite: 'architecture-stress', ok: false, error: privacySafeError(error) })}\n`)
    process.exitCode = 1
    return
  }

  const report = parsed.scenario
    ? await runMeasuredScenario(parsed.scenario, parsed.profile)
    : await runArchitectureStress(parsed.profile)
  process.stdout.write(`${JSON.stringify(report)}\n`)
  if (!report.ok) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main()
