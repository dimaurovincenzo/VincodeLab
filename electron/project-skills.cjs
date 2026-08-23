const fs = require('node:fs')
const path = require('node:path')
const { assertRegularFile, writeFileAtomic } = require('./file-utils.cjs')
const { NAME_PATTERN, validateSkill } = require('./skill-validation.cjs')

// Pi carica le skill locali del progetto dalla propria radice nativa.
const SKILLS_DIRECTORY = path.join('.pi', 'skills')
const SKILL_FILE = 'SKILL.md'

function skillsRoot(workspacePath) {
  return path.join(workspacePath, SKILLS_DIRECTORY)
}

function getSafeSkillsRoot(workspacePath, create = false) {
  const piDirectory = path.join(workspacePath, '.pi')
  for (const directory of [piDirectory, skillsRoot(workspacePath)]) {
    if (fs.existsSync(directory)) {
      const stats = fs.lstatSync(directory)
      if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('La directory skill del progetto non è sicura.')
    } else if (create) {
      fs.mkdirSync(directory, { mode: 0o700 })
    } else {
      return null
    }
  }
  return skillsRoot(workspacePath)
}

function collectSkillFiles(directory, files = [], depth = 0) {
  if (depth > 8 || files.length >= 500) return files
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const entryPath = path.join(directory, entry.name)
    if (depth === 0 && entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entryPath)
      continue
    }
    if (entry.isDirectory()) {
      const skillFilePath = path.join(entryPath, SKILL_FILE)
      if (fs.existsSync(skillFilePath)) {
        const skillFileStats = fs.lstatSync(skillFilePath)
        if (skillFileStats.isFile() && !skillFileStats.isSymbolicLink()) files.push(skillFilePath)
      } else collectSkillFiles(entryPath, files, depth + 1)
    }
  }
  return files
}

function getSkillPath(workspacePath, relativePath) {
  const root = getSafeSkillsRoot(workspacePath)
  if (!root) throw new Error('Skill non trovata.')
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.length > 4096) throw new Error('Percorso skill non valido.')
  const segments = relativePath.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..' || segment.includes(path.sep))) throw new Error('Percorso skill non valido.')
  if (segments.length === 1 && segments[0].endsWith('.md')) {
    const candidate = path.join(root, segments[0])
    assertRegularFile(candidate, 'Skill non trovata.')
    return candidate
  }
  if (segments.some((segment) => segment.endsWith('.md'))) throw new Error('Percorso skill non valido.')
  let directory = root
  for (const segment of segments) {
    directory = path.join(directory, segment)
    let stats
    try {
      stats = fs.lstatSync(directory)
    } catch (error) {
      if (error && error.code === 'ENOENT') throw new Error('Skill non trovata.')
      throw error
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('La directory skill richiesta non è sicura.')
  }
  const candidate = path.join(directory, SKILL_FILE)
  assertRegularFile(candidate, 'Skill non trovata.')
  return candidate
}

function toSkill(workspacePath, skillFilePath, includeContent = false) {
  const content = fs.readFileSync(skillFilePath, 'utf8')
  const root = skillsRoot(workspacePath)
  const relativeFilePath = path.relative(root, skillFilePath)
  const isRootMarkdown = path.dirname(relativeFilePath) === '.' && relativeFilePath.endsWith('.md')
  const relativePath = isRootMarkdown ? relativeFilePath : path.dirname(relativeFilePath)
  const fallbackName = isRootMarkdown ? path.basename(skillFilePath, '.md') : path.basename(path.dirname(skillFilePath))
  const validation = validateSkill(content, fallbackName)
  return {
    id: relativePath,
    name: validation.attributes?.name ?? fallbackName,
    description: validation.attributes?.description ?? '',
    valid: validation.valid,
    issues: validation.issues,
    ...(includeContent ? { content } : {}),
  }
}

function listProjectSkills(workspacePath) {
  const root = getSafeSkillsRoot(workspacePath)
  if (!root) return []
  return collectSkillFiles(root).map((skillFilePath) => toSkill(workspacePath, skillFilePath))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function getProjectSkill(workspacePath, skillId) {
  return toSkill(workspacePath, getSkillPath(workspacePath, skillId), true)
}

function createProjectSkill(workspacePath, name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name) || name.length > 64) {
    throw new Error('Il nome skill deve usare lowercase, numeri e trattini (massimo 64 caratteri).')
  }

  const root = getSafeSkillsRoot(workspacePath, true)
  const directory = path.join(root, name)
  if (fs.existsSync(directory)) throw new Error('Esiste già una skill con questo nome.')

  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const content = `---\nname: ${name}\ndescription: Descrivi in modo specifico cosa fa questa skill e quando Pi deve usarla.\n---\n\n# ${name}\n\n## Istruzioni\n\nDefinisci qui il workflow che Pi deve seguire.\n`
  fs.writeFileSync(path.join(directory, SKILL_FILE), content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return getProjectSkill(workspacePath, name)
}

function updateProjectSkill(workspacePath, skillId, content) {
  if (typeof content !== 'string' || content.length > 200_000) throw new Error('Contenuto skill non valido.')
  const skillFilePath = getSkillPath(workspacePath, skillId)
  const validation = validateSkill(content, path.basename(path.dirname(skillFilePath)))
  if (!validation.valid) throw new Error(validation.issues.find((entry) => entry.level === 'error')?.message ?? 'Skill non valida.')
  writeFileAtomic(skillFilePath, content)
  return getProjectSkill(workspacePath, skillId)
}

function deleteProjectSkill(workspacePath, skillId) {
  const skillFilePath = getSkillPath(workspacePath, skillId)
  const target = path.dirname(skillFilePath) === skillsRoot(workspacePath) ? skillFilePath : path.dirname(skillFilePath)
  fs.rmSync(target, { recursive: target !== skillFilePath, force: false, maxRetries: 2 })
}

module.exports = {
  createProjectSkill,
  deleteProjectSkill,
  getProjectSkill,
  listProjectSkills,
  updateProjectSkill,
}
