const { assertProjectSkillsStoragePort } = require('./project-skills-storage.port.cjs')
const { NAME_PATTERN, validateSkill } = require('./skill-validation.cjs')

const MAX_CONTENT_LENGTH = 200_000
const MAX_NAME_LENGTH = 64
const MAX_SKILL_ID_LENGTH = 4_096

function createSkillReference(skillId) {
  if (typeof skillId !== 'string' || skillId.length === 0 || skillId.length > MAX_SKILL_ID_LENGTH) {
    throw new Error('Percorso skill non valido.')
  }
  const segments = skillId.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Percorso skill non valido.')
  }
  if (segments.length === 1 && segments[0].endsWith('.md')) {
    return Object.freeze({ id: segments[0], kind: 'root-markdown', segments: Object.freeze(segments) })
  }
  if (segments.some((segment) => segment.endsWith('.md'))) throw new Error('Percorso skill non valido.')
  return Object.freeze({ id: segments.join('/'), kind: 'directory', segments: Object.freeze(segments) })
}

function fallbackNameForId(skillId) {
  const segments = skillId.split('/')
  const name = segments.at(-1)
  return segments.length === 1 && name.endsWith('.md') ? name.slice(0, -3) : name
}

function toProjectSkill(record, includeContent = false) {
  const fallbackName = fallbackNameForId(record.id)
  const validation = validateSkill(record.content, fallbackName)
  return {
    id: record.id,
    name: validation.attributes?.name ?? fallbackName,
    description: validation.attributes?.description ?? '',
    valid: validation.valid,
    issues: validation.issues,
    ...(includeContent ? { content: record.content } : {}),
  }
}

function createProjectSkillsUseCases({ storage } = {}) {
  const skillsStorage = assertProjectSkillsStoragePort(storage)

  function listProjectSkills(workspacePath) {
    return skillsStorage.list(workspacePath)
      .map((record) => toProjectSkill(record))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  function getProjectSkill(workspacePath, skillId) {
    skillsStorage.assertRootPresent(workspacePath)
    const reference = createSkillReference(skillId)
    return toProjectSkill(skillsStorage.read(workspacePath, reference), true)
  }

  function createProjectSkill(workspacePath, name) {
    if (typeof name !== 'string' || !NAME_PATTERN.test(name) || name.length > MAX_NAME_LENGTH) {
      throw new Error('Il nome skill deve usare lowercase, numeri e trattini (massimo 64 caratteri).')
    }

    const content = `---\nname: ${name}\ndescription: Descrivi in modo specifico cosa fa questa skill e quando Pi deve usarla.\n---\n\n# ${name}\n\n## Istruzioni\n\nDefinisci qui il workflow che Pi deve seguire.\n`
    skillsStorage.create(workspacePath, name, content)
    return getProjectSkill(workspacePath, name)
  }

  function updateProjectSkill(workspacePath, skillId, content) {
    if (typeof content !== 'string' || content.length > MAX_CONTENT_LENGTH) {
      throw new Error('Contenuto skill non valido.')
    }
    skillsStorage.assertRootPresent(workspacePath)
    const reference = createSkillReference(skillId)
    const updateHandle = skillsStorage.prepareUpdate(workspacePath, reference)
    const validationName = reference.kind === 'root-markdown'
      ? 'skills'
      : reference.segments.at(-1)
    const validation = validateSkill(content, validationName)
    if (!validation.valid) {
      throw new Error(validation.issues.find((entry) => entry.level === 'error')?.message ?? 'Skill non valida.')
    }
    skillsStorage.write(updateHandle, content)
    return getProjectSkill(workspacePath, reference.id)
  }

  function deleteProjectSkill(workspacePath, skillId) {
    skillsStorage.assertRootPresent(workspacePath)
    skillsStorage.remove(workspacePath, createSkillReference(skillId))
  }

  return Object.freeze({
    createProjectSkill,
    deleteProjectSkill,
    getProjectSkill,
    listProjectSkills,
    updateProjectSkill,
  })
}

module.exports = { createProjectSkillsUseCases }
