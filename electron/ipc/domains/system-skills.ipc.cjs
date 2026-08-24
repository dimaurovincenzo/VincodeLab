const SYSTEM_SKILLS_INVOKE_CHANNELS = Object.freeze([
  'systemSkills:list',
  'systemSkills:get',
  'systemSkills:create',
  'systemSkills:update',
  'systemSkills:delete',
])

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
    ['systemSkills:list', (event) => { assertTrustedSender(event); return listSystemSkills(systemSkillsRoot) }],
    ['systemSkills:get', (event, id) => { assertTrustedSender(event); return getSystemSkill(systemSkillsRoot, id) }],
    ['systemSkills:create', (event, name) => { assertTrustedSender(event); return createSystemSkill(systemSkillsRoot, name) }],
    ['systemSkills:update', (event, id, content) => { assertTrustedSender(event); return updateSystemSkill(systemSkillsRoot, id, content) }],
    ['systemSkills:delete', (event, id) => {
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
