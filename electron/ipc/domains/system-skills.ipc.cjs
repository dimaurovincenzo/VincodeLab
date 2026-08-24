const { IPC_CHANNELS, SYSTEM_SKILLS_INVOKE_CHANNELS } = require('../channels.cjs')

function createSystemSkillsHandlers({
  assertTrustedSender,
  createSystemSkill,
  deleteSystemSkill,
  getSystemSkill,
  listSystemSkills,
  systemSkillsRoot,
  updateSystemSkill,
}) {
  return new Map([
    [IPC_CHANNELS.SYSTEM_SKILLS_LIST, (event) => { assertTrustedSender(event); return listSystemSkills(systemSkillsRoot) }],
    [IPC_CHANNELS.SYSTEM_SKILLS_GET, (event, id) => { assertTrustedSender(event); return getSystemSkill(systemSkillsRoot, id) }],
    [IPC_CHANNELS.SYSTEM_SKILLS_CREATE, (event, name) => { assertTrustedSender(event); return createSystemSkill(systemSkillsRoot, name) }],
    [IPC_CHANNELS.SYSTEM_SKILLS_UPDATE, (event, id, content) => { assertTrustedSender(event); return updateSystemSkill(systemSkillsRoot, id, content) }],
    [IPC_CHANNELS.SYSTEM_SKILLS_DELETE, (event, id) => {
      assertTrustedSender(event)
      deleteSystemSkill(systemSkillsRoot, id)
      return { deleted: true }
    }],
  ])
}

function registerSystemSkillsIpc({ ipcMain, ...dependencies }) {
  const handlers = createSystemSkillsHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: SYSTEM_SKILLS_INVOKE_CHANNELS })
}

module.exports = { SYSTEM_SKILLS_INVOKE_CHANNELS, createSystemSkillsHandlers, registerSystemSkillsIpc }
