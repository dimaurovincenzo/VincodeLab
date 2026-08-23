import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUNNER_PATH = path.join(PROJECT_ROOT, 'scripts', 'architecture-soak.mjs')

function runTestProfile() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RUNNER_PATH, '--profile', 'test'], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => child.kill('SIGKILL'), 60_000)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(`Runner stress terminato con ${code ?? signal}: ${stderr || stdout}`))
        return
      }
      try {
        resolve({ report: JSON.parse(stdout), serialized: stdout })
      } catch (error) {
        reject(error)
      }
    })
  })
}

test('il runner architetturale produce metriche privacy-safe e verifica tutti gli scenari', async () => {
  const { report, serialized } = await runTestProfile()

  assert.equal(report.schemaVersion, 1)
  assert.equal(report.suite, 'architecture-stress')
  assert.equal(report.profile, 'test')
  assert.equal(report.ok, true)
  assert.deepEqual(report.scenarios.map((scenario) => scenario.scenario), [
    'terminal_stream',
    'shell_lifecycle',
    'sqlite_worker',
    'update_concurrency',
    'workspace_persistence',
  ])
  assert.equal(report.scenarios.every((scenario) => scenario.ok && scenario.eventLoop.maxDelayMs <= scenario.eventLoop.thresholdMs), true)
  assert.equal(report.scenarios.find((scenario) => scenario.scenario === 'terminal_stream').metrics.checksumMatch, true)
  assert.equal(report.scenarios.find((scenario) => scenario.scenario === 'sqlite_worker').metrics.activeWorkers, 0)
  assert.equal(report.scenarios.find((scenario) => scenario.scenario === 'shell_lifecycle').metrics.residualListeners, 0)
  assert.equal(report.scenarios.find((scenario) => scenario.scenario === 'update_concurrency').metrics.residualTemporaryEntries, 0)
  assert.doesNotMatch(serialized, new RegExp(PROJECT_ROOT.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
  assert.doesNotMatch(serialized, new RegExp(os.tmpdir().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'))
})
