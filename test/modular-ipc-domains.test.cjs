const assert = require('node:assert/strict')
const test = require('node:test')

const appearance = require('../electron/ipc/domains/appearance.ipc.cjs')
const projectResources = require('../electron/ipc/domains/project-resources.ipc.cjs')
const systemSkills = require('../electron/ipc/domains/system-skills.ipc.cjs')
const workspaceState = require('../electron/ipc/domains/workspace-state.ipc.cjs')

function registrationFixture() {
  const registrations = new Map()
  return {
    ipcMain: { handle(channel, handler) {
      assert.equal(registrations.has(channel), false, `registrazione duplicata: ${channel}`)
      registrations.set(channel, handler)
    } },
    registrations,
  }
}

test('i nuovi domini registrano manifesti completi e senza ownership duplicate', () => {
  const all = []
  for (const [registrar, channels, dependencies] of [
    [appearance.registerAppearanceIpc, appearance.APPEARANCE_INVOKE_CHANNELS, { assertTrustedSender() {}, applyAppearance() {}, getAppearance() {}, setAppearance() {} }],
    [projectResources.registerProjectResourcesIpc, projectResources.PROJECT_RESOURCES_INVOKE_CHANNELS, {
      assertTrustedSender() {}, clearProjectInstructions() {}, createProjectSkill() {}, deleteProjectSkill() {}, getProjectInstructions() {}, getProjectSkill() {}, listProjectSkills() {}, log() {}, reloadPi() {}, requireActiveWorkspace() {}, saveProjectInstructions() {}, updateProjectSkill() {},
    }],
    [systemSkills.registerSystemSkillsIpc, systemSkills.SYSTEM_SKILLS_INVOKE_CHANNELS, { assertTrustedSender() {}, createSystemSkill() {}, deleteSystemSkill() {}, getSystemSkill() {}, listSystemSkills() {}, systemSkillsRoot: '/skills', updateSystemSkill() {} }],
    [workspaceState.registerWorkspaceStateIpc, workspaceState.WORKSPACE_STATE_INVOKE_CHANNELS, { assertTrustedSender() {}, getWorkspaceSession() { return {} }, requireActiveWorkspace() {}, saveWorkspaceSession() {}, volatileDrafts: { list() {}, write() {}, discard() {} } }],
  ]) {
    const fixture = registrationFixture()
    const result = registrar({ ipcMain: fixture.ipcMain, ...dependencies })
    assert.deepEqual(result.channels, channels)
    assert.deepEqual([...fixture.registrations.keys()], channels)
    all.push(...channels)
  }
  assert.equal(new Set(all).size, all.length)
})

test('workspace state preserva guardia, workspace attivo, recovery e registry volatile', () => {
  const calls = []
  const snapshot = { recovery: { correlationId: 'ERR-ABC123' } }
  const handlers = workspaceState.createWorkspaceStateHandlers({
    assertTrustedSender: (event) => calls.push(['guard', event]),
    beforeWorkspaceSessionRead: () => calls.push(['fault']),
    getWorkspaceSession: (workspace) => { calls.push(['get', workspace]); return snapshot },
    logWorkspaceSessionRecovery: (recovery) => calls.push(['recovery', recovery]),
    requireActiveWorkspace: () => '/workspace',
    saveWorkspaceSession: (workspace, value) => ({ workspace, value }),
    volatileDrafts: {
      list: () => ['draft'],
      write: (draft) => ({ stored: draft }),
      discard: (identity) => ({ discarded: identity }),
    },
  })
  const event = { sender: { id: 1 } }
  assert.equal(handlers.get('workspaceSession:get')(event), snapshot)
  assert.deepEqual(handlers.get('workspaceSession:save')(event, { version: 2 }), { workspace: '/workspace', value: { version: 2 } })
  assert.deepEqual(handlers.get('volatileDrafts:list')(event), ['draft'])
  assert.deepEqual(handlers.get('volatileDrafts:write')(event, 'draft'), { stored: 'draft' })
  assert.deepEqual(handlers.get('volatileDrafts:discard')(event, 'id'), { discarded: 'id' })
  assert.deepEqual(calls.slice(0, 4), [['guard', event], ['fault'], ['get', '/workspace'], ['recovery', snapshot.recovery]])
  assert.equal(calls.filter(([kind]) => kind === 'guard').length, 5)
})

test('appearance applica il tema soltanto dopo la persistenza', () => {
  const calls = []
  const handlers = appearance.createAppearanceHandlers({
    assertTrustedSender: () => calls.push('guard'),
    getAppearance: () => 'system',
    setAppearance: (value) => { calls.push(`set:${value}`); return value },
    applyAppearance: (value) => calls.push(`apply:${value}`),
  })
  assert.equal(handlers.get('appearance:get')({}), 'system')
  assert.equal(handlers.get('appearance:set')({}, 'dark'), 'dark')
  assert.deepEqual(calls, ['guard', 'guard', 'set:dark', 'apply:dark'])
})

test('project resources e system skills conservano argomenti, workspace e risultati', () => {
  const calls = []
  const resources = projectResources.createProjectResourcesHandlers({
    assertTrustedSender: () => calls.push(['guard']),
    clearProjectInstructions: (workspace) => ({ workspace, cleared: true }),
    createProjectSkill: (workspace, name) => ({ workspace, name }),
    deleteProjectSkill: (workspace, id) => calls.push(['delete', workspace, id]),
    getProjectInstructions: (workspace) => ({ workspace }),
    getProjectSkill: (workspace, id) => ({ workspace, id }),
    listProjectSkills: (workspace) => [workspace],
    log: (...args) => calls.push(['log', ...args]),
    reloadPi: () => ({ reloaded: true }),
    requireActiveWorkspace: () => '/workspace',
    saveProjectInstructions: (workspace, content) => ({ workspace, content }),
    updateProjectSkill: (workspace, id, content) => ({ workspace, id, content }),
  })
  assert.deepEqual(resources.get('instructions:save')({}, 'copy'), { workspace: '/workspace', content: 'copy' })
  assert.deepEqual(resources.get('skills:create')({}, 'review'), { workspace: '/workspace', name: 'review' })
  assert.deepEqual(resources.get('skills:delete')({}, 'skill-1'), { deleted: true })
  assert.deepEqual(resources.get('skills:reload')({}), { reloaded: true })

  const skills = systemSkills.createSystemSkillsHandlers({
    assertTrustedSender: () => calls.push(['guard-system']),
    createSystemSkill: (root, name) => ({ root, name }),
    deleteSystemSkill: (root, id) => calls.push(['delete-system', root, id]),
    getSystemSkill: (root, id) => ({ root, id }),
    listSystemSkills: (root) => [root],
    systemSkillsRoot: '/system-skills',
    updateSystemSkill: (root, id, content) => ({ root, id, content }),
  })
  assert.deepEqual(skills.get('systemSkills:list')({}), ['/system-skills'])
  assert.deepEqual(skills.get('systemSkills:update')({}, 'id', 'content'), { root: '/system-skills', id: 'id', content: 'content' })
  assert.deepEqual(skills.get('systemSkills:delete')({}, 'id'), { deleted: true })
})

test('gli errori dei servizi attraversano invariati la boundary globale', () => {
  const expected = new Error('store failure')
  const handlers = appearance.createAppearanceHandlers({
    assertTrustedSender() {},
    applyAppearance() {},
    getAppearance() {},
    setAppearance() { throw expected },
  })
  assert.throws(() => handlers.get('appearance:set')({}, 'dark'), (error) => error === expected)
})
