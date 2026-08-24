const { createPublicError } = require('../errors/public-error.cjs')
const { assertSystemSkillsStoragePort } = require('./system-skills-storage.port.cjs')
const { NAME_PATTERN, validateSkill } = require('./skill-validation.cjs')

const MAX_CONTENT_LENGTH = 200_000
const MAX_NAME_LENGTH = 64
const MAX_SKILL_ID_LENGTH = 4_096

function assertSystemSkillId(skillId) {
  if (typeof skillId !== 'string' || !skillId || skillId.length > MAX_SKILL_ID_LENGTH || !NAME_PATTERN.test(skillId)) {
    throw new Error('Percorso skill non valido.')
  }
  return skillId
}

function toSystemSkill(record, includeContent = false) {
  const validation = validateSkill(record.content, record.id)
  return {
    id: record.id,
    name: validation.attributes?.name ?? record.id,
    description: validation.attributes?.description ?? '',
    valid: validation.valid,
    issues: validation.issues,
    ...(includeContent ? { content: record.content } : {}),
  }
}

function createNameInvalidError() {
  return createPublicError(
    'SYSTEM_SKILL_NAME_INVALID',
    'Usa un nome di 1-64 caratteri con lettere minuscole e numeri separati da trattini.',
  )
}

function createAlreadyExistsError() {
  return createPublicError(
    'SYSTEM_SKILL_ALREADY_EXISTS',
    'Esiste già una skill Pi con questo nome. Scegli un nome diverso.',
  )
}

function createSystemSkillsUseCases({ storage } = {}) {
  const skillsStorage = assertSystemSkillsStoragePort(storage)

  function listSystemSkills(root) {
    return skillsStorage.list(root)
      .map((record) => toSystemSkill(record))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  function getSystemSkill(root, skillId) {
    skillsStorage.assertRootPresent(root)
    const id = assertSystemSkillId(skillId)
    return toSystemSkill(skillsStorage.read(root, id), true)
  }

  function createSystemSkill(root, name) {
    if (typeof name !== 'string' || !NAME_PATTERN.test(name) || name.length > MAX_NAME_LENGTH) {
      throw createNameInvalidError()
    }

    const content = `---\nname: ${name}\ndescription: Descrivi cosa fa questa skill di sistema e quando Pi deve usarla.\n---\n\n# ${name}\n\n## Istruzioni\n\n`
    const result = skillsStorage.create(root, name, content)
    if (!result?.created) throw createAlreadyExistsError()
    return getSystemSkill(root, name)
  }

  function updateSystemSkill(root, skillId, content) {
    if (typeof content !== 'string' || content.length > MAX_CONTENT_LENGTH) {
      throw new Error('Contenuto skill non valido.')
    }
    skillsStorage.assertRootPresent(root)
    const id = assertSystemSkillId(skillId)
    const updateHandle = skillsStorage.prepareUpdate(root, id)
    const validation = validateSkill(content, id)
    if (!validation.valid) {
      throw new Error(validation.issues.find((item) => item.level === 'error')?.message ?? 'Skill non valida.')
    }
    skillsStorage.write(updateHandle, content)
    return getSystemSkill(root, id)
  }

  function deleteSystemSkill(root, skillId) {
    skillsStorage.assertRootPresent(root)
    skillsStorage.remove(root, assertSystemSkillId(skillId))
  }

  return Object.freeze({
    createSystemSkill,
    deleteSystemSkill,
    getSystemSkill,
    listSystemSkills,
    updateSystemSkill,
  })
}

module.exports = { createSystemSkillsUseCases }
