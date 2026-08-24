const PROJECT_RESOURCES_INVOKE_CHANNELS = Object.freeze([
  'instructions:get',
  'instructions:save',
  'instructions:clear',
  'skills:list',
  'skills:get',
  'skills:create',
  'skills:update',
  'skills:delete',
  'skills:reload',
])

function createProjectResourcesHandlers({
  assertTrustedSender,
  clearProjectInstructions,
  createProjectSkill,
  deleteProjectSkill,
  getProjectInstructions,
  getProjectSkill,
  listProjectSkills,
  log,
  reloadPi,
  requireActiveWorkspace,
  saveProjectInstructions,
  updateProjectSkill,
}) {
  return new Map([
    ['instructions:get', (event) => {
      assertTrustedSender(event)
      return getProjectInstructions(requireActiveWorkspace())
    }],
    ['instructions:save', (event, content) => {
      assertTrustedSender(event)
      const result = saveProjectInstructions(requireActiveWorkspace(), content)
      log('info', 'project_instructions_saved')
      return result
    }],
    ['instructions:clear', (event) => {
      assertTrustedSender(event)
      const result = clearProjectInstructions(requireActiveWorkspace())
      log('info', 'project_instructions_cleared')
      return result
    }],
    ['skills:list', (event) => {
      assertTrustedSender(event)
      return listProjectSkills(requireActiveWorkspace())
    }],
    ['skills:get', (event, skillId) => {
      assertTrustedSender(event)
      return getProjectSkill(requireActiveWorkspace(), skillId)
    }],
    ['skills:create', (event, name) => {
      assertTrustedSender(event)
      return createProjectSkill(requireActiveWorkspace(), name)
    }],
    ['skills:update', (event, skillId, content) => {
      assertTrustedSender(event)
      return updateProjectSkill(requireActiveWorkspace(), skillId, content)
    }],
    ['skills:delete', (event, skillId) => {
      assertTrustedSender(event)
      deleteProjectSkill(requireActiveWorkspace(), skillId)
      return { deleted: true }
    }],
    ['skills:reload', (event) => {
      assertTrustedSender(event)
      return reloadPi()
    }],
  ])
}

function registerProjectResourcesIpc({ ipcMain, ...dependencies }) {
  const handlers = createProjectResourcesHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: PROJECT_RESOURCES_INVOKE_CHANNELS })
}

module.exports = {
  PROJECT_RESOURCES_INVOKE_CHANNELS,
  createProjectResourcesHandlers,
  registerProjectResourcesIpc,
}
