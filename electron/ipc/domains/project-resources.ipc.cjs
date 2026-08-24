const { IPC_CHANNELS, PROJECT_RESOURCES_INVOKE_CHANNELS } = require('../channels.cjs')

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
    [IPC_CHANNELS.INSTRUCTIONS_GET, (event) => {
      assertTrustedSender(event)
      return getProjectInstructions(requireActiveWorkspace())
    }],
    [IPC_CHANNELS.INSTRUCTIONS_SAVE, (event, content) => {
      assertTrustedSender(event)
      const result = saveProjectInstructions(requireActiveWorkspace(), content)
      log('info', 'project_instructions_saved')
      return result
    }],
    [IPC_CHANNELS.INSTRUCTIONS_CLEAR, (event) => {
      assertTrustedSender(event)
      const result = clearProjectInstructions(requireActiveWorkspace())
      log('info', 'project_instructions_cleared')
      return result
    }],
    [IPC_CHANNELS.SKILLS_LIST, (event) => {
      assertTrustedSender(event)
      return listProjectSkills(requireActiveWorkspace())
    }],
    [IPC_CHANNELS.SKILLS_GET, (event, skillId) => {
      assertTrustedSender(event)
      return getProjectSkill(requireActiveWorkspace(), skillId)
    }],
    [IPC_CHANNELS.SKILLS_CREATE, (event, name) => {
      assertTrustedSender(event)
      return createProjectSkill(requireActiveWorkspace(), name)
    }],
    [IPC_CHANNELS.SKILLS_UPDATE, (event, skillId, content) => {
      assertTrustedSender(event)
      return updateProjectSkill(requireActiveWorkspace(), skillId, content)
    }],
    [IPC_CHANNELS.SKILLS_DELETE, (event, skillId) => {
      assertTrustedSender(event)
      deleteProjectSkill(requireActiveWorkspace(), skillId)
      return { deleted: true }
    }],
    [IPC_CHANNELS.SKILLS_RELOAD, (event) => {
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
