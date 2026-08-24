import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { setImmediate as yieldImmediate } from 'node:timers/promises'

import { restoreEnvironment, temporaryRoot } from './scenario-fixture.mjs'

const require = createRequire(import.meta.url)
const { closeDatabase, getDatabase } = require('../../../electron/infrastructure/persistence/workspace.repository.cjs')
const {
  MAX_WORKSPACE_SESSION_BYTES,
  WORKSPACE_SESSION_VERSION,
  createDefaultWorkspaceSessionState,
  getWorkspaceSession,
  saveWorkspaceSession,
} = require('../../../electron/infrastructure/persistence/workspace-session.repository.cjs')

function sessionSnapshot(state) {
  return { version: WORKSPACE_SESSION_VERSION, state }
}

export async function runWorkspacePersistenceScenario(config) {
  const root = temporaryRoot('vincodelab-architecture-workspace-')
  const previousDirectory = process.env.VINCODELAB_DATA_DIR
  process.env.VINCODELAB_DATA_DIR = path.join(root, 'data')
  closeDatabase()
  const workspaceCount = Math.min(16, Math.max(2, Math.ceil(config.workspaceCycles / 10)))
  try {
    for (let cycle = 0; cycle < config.workspaceCycles; cycle += 1) {
      const workspace = path.join(root, `workspace-${cycle % workspaceCount}`)
      const state = createDefaultWorkspaceSessionState()
      state.navigation.section = ['ai', 'editor', 'terminal', 'github', 'database', 'settings'][cycle % 6]
      state.navigation.aiTab = ['terminal', 'skills', 'instructions'][cycle % 3]
      state.terminal.openSessionCount = cycle % 9 === 8 ? 8 : cycle % 8
      state.terminal.activeSessionOrdinal = state.terminal.openSessionCount === 0 ? null : cycle % state.terminal.openSessionCount
      state.github.scroll.changes = cycle * 3
      state.database.scroll.results = cycle * 7
      state.panels.editorExplorer = cycle % 2 === 0 ? 240 + cycle % 100 : null
      const saved = saveWorkspaceSession(workspace, sessionSnapshot(state))
      const loaded = getWorkspaceSession(workspace)
      assert.deepEqual(loaded.state, saved.state, 'Roundtrip sessione workspace non esatto.')
      assert.equal(loaded.version, WORKSPACE_SESSION_VERSION, 'Versione sessione workspace errata.')
      if (cycle % 100 === 99) await yieldImmediate()
    }

    const corruptCases = [
      '{not-json',
      JSON.stringify({ ...createDefaultWorkspaceSessionState(), unexpected: true }),
      'x'.repeat(MAX_WORKSPACE_SESSION_BYTES + 1),
    ]
    for (let index = 0; index < config.workspaceCorruptCases; index += 1) {
      const workspace = path.join(root, `corrupt-${index}`)
      saveWorkspaceSession(workspace, sessionSnapshot(createDefaultWorkspaceSessionState()))
      getDatabase().prepare('UPDATE workspace_ui_state SET payload_json = ? WHERE workspace_path = ?')
        .run(corruptCases[index % corruptCases.length], workspace)
      const recovered = getWorkspaceSession(workspace)
      assert.deepEqual(recovered.state, createDefaultWorkspaceSessionState(), 'Fallback stato corrotto errato.')
      assert.equal(recovered.updatedAt, null, 'Timestamp corrotto non azzerato.')
      assert.equal(getDatabase().prepare('SELECT COUNT(*) AS count FROM workspace_ui_state WHERE workspace_path = ?').get(workspace).count, 0, 'Stato corrotto non rimosso.')
    }

    const persistedRows = getDatabase().prepare('SELECT COUNT(*) AS count FROM workspace_ui_state').get().count
    assert.equal(persistedRows, workspaceCount, 'Numero workspace persistiti inatteso.')
    return {
      cycles: config.workspaceCycles,
      workspaceCount,
      corruptCases: config.workspaceCorruptCases,
      recoveredCorruptCases: config.workspaceCorruptCases,
      persistedRows,
      maxPayloadBytes: MAX_WORKSPACE_SESSION_BYTES,
    }
  } finally {
    closeDatabase()
    restoreEnvironment('VINCODELAB_DATA_DIR', previousDirectory)
    fs.rmSync(root, { recursive: true, force: true })
  }
}
