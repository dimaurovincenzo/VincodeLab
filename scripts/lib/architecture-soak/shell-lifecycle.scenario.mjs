import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { setImmediate as yieldImmediate } from 'node:timers/promises'

import { temporaryRoot, UNICODE_PATTERN } from './scenario-fixture.mjs'

const require = createRequire(import.meta.url)
const { createShellSessionManager } = require('../../../electron/domains/shell/shell-session-manager.cjs')

function createFakePtyFactory() {
  const processes = []
  let nextPid = 20_000
  function processFactory(_executable, _args, options) {
    const dataListeners = new Set()
    const exitListeners = new Set()
    const ptyProcess = {
      pid: nextPid++,
      options,
      killCalls: 0,
      pauseCalls: 0,
      resumeCalls: 0,
      paused: false,
      writes: 0,
      resizes: 0,
      write() { this.writes += 1 },
      resize() { this.resizes += 1 },
      kill(signal) {
        this.killCalls += 1
        this.emitExit({ exitCode: signal === 'SIGKILL' ? null : 0, signal: signal === 'SIGKILL' ? 9 : 0 })
      },
      pause() { this.paused = true; this.pauseCalls += 1 },
      resume() { this.paused = false; this.resumeCalls += 1 },
      onData(listener) {
        dataListeners.add(listener)
        return { dispose: () => dataListeners.delete(listener) }
      },
      onExit(listener) {
        exitListeners.add(listener)
        return { dispose: () => exitListeners.delete(listener) }
      },
      emitData(data) { for (const listener of [...dataListeners]) listener(data) },
      emitExit(event) { for (const listener of [...exitListeners]) listener(event) },
      resourceCount() { return dataListeners.size + exitListeners.size },
    }
    processes.push(ptyProcess)
    return ptyProcess
  }
  return { processFactory, processes }
}

export async function runShellLifecycleScenario(config) {
  const root = temporaryRoot('vincodelab-architecture-shell-')
  const workspaceA = path.join(root, 'workspace-a')
  const workspaceB = path.join(root, 'workspace-b')
  fs.mkdirSync(workspaceA)
  fs.mkdirSync(workspaceB)
  const fakePty = createFakePtyFactory()
  const dataEvents = []
  const ackResults = []
  let nextId = 0
  let manager
  manager = createShellSessionManager({
    canonicalizeWorkspace: (workspacePath) => fs.realpathSync(workspacePath),
    processFactory: fakePty.processFactory,
    createId: () => `soak-${String(++nextId).padStart(8, '0')}`,
    getExecutable: () => '/bin/fake-shell',
    getEnvironment: () => ({ LANG: 'C.UTF-8' }),
    isProcessAlive: () => false,
    onData: (event) => {
      dataEvents.push(event)
      ackResults.push(manager.ack(event.workspacePath, event.sessionId, {
        attachmentId: event.attachmentId,
        generation: event.generation,
        sequence: event.sequence,
      }))
    },
  })
  let expectedEvents = 0
  let expectedEventBytes = 0

  try {
    for (let cycle = 0; cycle < config.shellCycles; cycle += 1) {
      const workspace = cycle % 2 === 0 ? workspaceA : workspaceB
      const first = manager.create(workspace)
      const firstSnapshot = manager.resume(workspace, first.sessionId)
      assert.equal(manager.rendererReady(workspace, first.sessionId, {
        attachmentId: firstSnapshot.attachmentId,
        generation: firstSnapshot.generation,
        watermark: firstSnapshot.watermark,
      }), true, 'Handshake renderer del primo terminale rifiutato.')
      const firstProcess = fakePty.processes.at(-1)
      const firstOutput = `first-${cycle}:${UNICODE_PATTERN}`
      firstProcess.emitData(firstOutput)
      expectedEvents += 1
      expectedEventBytes += Buffer.byteLength(firstOutput)
      manager.write(workspace, first.sessionId, 'pwd\r')
      manager.resize(workspace, first.sessionId, { cols: 80 + cycle % 40, rows: 24 + cycle % 20 })

      const second = manager.create(workspace)
      const secondSnapshot = manager.resume(workspace, second.sessionId)
      assert.equal(manager.rendererReady(workspace, second.sessionId, {
        attachmentId: secondSnapshot.attachmentId,
        generation: secondSnapshot.generation,
        watermark: secondSnapshot.watermark,
      }), true, 'Handshake renderer del secondo terminale rifiutato.')
      const replacedProcess = fakePty.processes.at(-1)
      const beforeRestart = `before-restart-${cycle}:${UNICODE_PATTERN}`
      replacedProcess.emitData(beforeRestart)
      expectedEvents += 1
      expectedEventBytes += Buffer.byteLength(beforeRestart)
      manager.focus(workspace, first.sessionId)
      await manager.restart(workspace, second.sessionId)
      const restartSnapshot = manager.resume(workspace, second.sessionId)
      assert.equal(manager.rendererReady(workspace, second.sessionId, {
        attachmentId: restartSnapshot.attachmentId,
        generation: restartSnapshot.generation,
        watermark: restartSnapshot.watermark,
      }), true, 'Handshake renderer dopo restart rifiutato.')
      const replacement = fakePty.processes.at(-1)
      replacedProcess.emitData('stale-output-must-be-ignored')
      replacedProcess.emitExit({ exitCode: 1, signal: 9 })
      const afterRestart = `after-restart-${cycle}:${UNICODE_PATTERN}`
      replacement.emitData(afterRestart)
      expectedEvents += 1
      expectedEventBytes += Buffer.byteLength(afterRestart)

      const snapshot = manager.resume(workspace, second.sessionId)
      assert.equal(snapshot.blocks.map((item) => item.data).join(''), afterRestart, 'Snapshot restart contiene output stale.')
      assert.equal(snapshot.generation, 2, 'Generazione shell non avanzata.')
      assert.equal((await manager.close(workspace, first.sessionId)).activeSessionId, second.sessionId, 'Fallback sessione attiva errato.')
      assert.equal((await manager.close(workspace, second.sessionId)).closed, true, 'Chiusura sessione fallita.')
      assert.equal(manager.list(workspace).sessions.length, 0, 'Sessioni residue nel workspace.')
      if (cycle % 25 === 24) await yieldImmediate()
    }

    assert.equal((await manager.dispose()).closed, 0, 'Dispose ha trovato sessioni non chiuse.')
    const resourceCount = fakePty.processes.reduce((total, item) => total + item.resourceCount(), 0)
    const killCalls = fakePty.processes.reduce((total, item) => total + item.killCalls, 0)
    const eventBytes = dataEvents.reduce((total, event) => total + Buffer.byteLength(event.data), 0)
    assert.equal(dataEvents.length, expectedEvents, 'Eventi shell persi o stale.')
    assert.ok(ackResults.every(Boolean), 'ACK shell rifiutato durante il lifecycle.')
    assert.equal(eventBytes, expectedEventBytes, 'Byte shell persi.')
    assert.equal(resourceCount, 0, 'Listener PTY residui.')
    assert.equal(killCalls, fakePty.processes.length, 'Processi PTY non chiusi esattamente una volta.')
    return {
      cycles: config.shellCycles,
      processes: fakePty.processes.length,
      dataEvents: dataEvents.length,
      eventBytes,
      killCalls,
      residualListeners: resourceCount,
      residualSessions: 0,
    }
  } finally {
    await manager.dispose()
    fs.rmSync(root, { recursive: true, force: true })
  }
}
