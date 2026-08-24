const fs = require('node:fs')
const path = require('node:path')
const { assertRegularFile, writeFileAtomic } = require('../filesystem/file-utils.cjs')
const { createPublicError } = require('../errors/public-error.cjs')
const { NAME_PATTERN, validateSkill } = require('./skill-validation.cjs')

const SKILL_FILE = 'SKILL.md'

function assertRoot(root, create = false) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Directory skill di sistema non valida.')
  let stats
  try {
    stats = fs.lstatSync(root)
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
    if (!create) return false
    fs.mkdirSync(root, { recursive: true, mode: 0o700 })
    stats = fs.lstatSync(root)
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('La directory skill di sistema non è sicura.')
  return true
}

function skillPath(root, skillId) {
  if (!assertRoot(root)) throw new Error('Skill non trovata.')
  if (typeof skillId !== 'string' || !skillId || skillId.length > 4096 || !NAME_PATTERN.test(skillId)) throw new Error('Percorso skill non valido.')
  const directFilePath = path.join(root, `${skillId}.md`)
  if (fs.existsSync(directFilePath)) {
    assertRegularFile(directFilePath, 'Skill non trovata.')
    return directFilePath
  }
  const directory = path.join(root, skillId)
  const stats = fs.lstatSync(directory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('La directory skill richiesta non è sicura.')
  const filePath = path.join(directory, SKILL_FILE)
  assertRegularFile(filePath, 'Skill non trovata.')
  return filePath
}

function toSkill(root, filePath, includeContent = false) {
  const content = fs.readFileSync(filePath, 'utf8')
  const id = path.basename(filePath) === SKILL_FILE ? path.basename(path.dirname(filePath)) : path.basename(filePath, '.md')
  const validation = validateSkill(content, id)
  return { id, name: validation.attributes?.name ?? id, description: validation.attributes?.description ?? '', valid: validation.valid, issues: validation.issues, ...(includeContent ? { content } : {}) }
}

function readListedSkill(root, filePath) {
  try {
    const stats = fs.lstatSync(filePath)
    if (!stats.isFile() || stats.isSymbolicLink()) return null
    return toSkill(root, filePath)
  } catch (error) {
    // Una entry può sparire tra readdir/lstat/read; permessi e I/O failures,
    // invece, devono raggiungere la boundary IPC e diventare recuperabili in UI.
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

function listSystemSkills(root) {
  if (!assertRoot(root)) return []
  let entries
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  return entries.slice(0, 500)
    .flatMap((entry) => {
      if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.md')) return [path.join(root, entry.name)]
      if (entry.isDirectory() && !entry.isSymbolicLink()) return [path.join(root, entry.name, SKILL_FILE)]
      return []
    })
    .map((filePath) => readListedSkill(root, filePath))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name))
}

function getSystemSkill(root, id) { return toSkill(root, skillPath(root, id), true) }
function createSystemSkill(root, name) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name) || name.length > 64) {
    throw createPublicError(
      'SYSTEM_SKILL_NAME_INVALID',
      'Usa un nome di 1-64 caratteri con lettere minuscole e numeri separati da trattini.',
    )
  }

  assertRoot(root, true)
  const directory = path.join(root, name)
  const directFilePath = path.join(root, `${name}.md`)
  if (fs.existsSync(directory) || fs.existsSync(directFilePath)) {
    throw createPublicError(
      'SYSTEM_SKILL_ALREADY_EXISTS',
      'Esiste già una skill Pi con questo nome. Scegli un nome diverso.',
    )
  }

  try {
    fs.mkdirSync(directory, { mode: 0o700 })
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      throw createPublicError(
        'SYSTEM_SKILL_ALREADY_EXISTS',
        'Esiste già una skill Pi con questo nome. Scegli un nome diverso.',
      )
    }
    throw error
  }

  try {
    fs.writeFileSync(path.join(directory, SKILL_FILE), `---\nname: ${name}\ndescription: Descrivi cosa fa questa skill di sistema e quando Pi deve usarla.\n---\n\n# ${name}\n\n## Istruzioni\n\n`, { mode: 0o600, flag: 'wx' })
  } catch (error) {
    try {
      fs.rmdirSync(directory)
    } catch {
      // Rimuoviamo solo la directory appena creata quando è ancora vuota.
    }
    throw error
  }

  return getSystemSkill(root, name)
}
function updateSystemSkill(root, id, content) { if (typeof content !== 'string' || content.length > 200000) throw new Error('Contenuto skill non valido.'); const filePath = skillPath(root, id); const validation = validateSkill(content, id); if (!validation.valid) throw new Error(validation.issues.find((item) => item.level === 'error')?.message ?? 'Skill non valida.'); writeFileAtomic(filePath, content); return getSystemSkill(root, id) }
function deleteSystemSkill(root, id) {
  const filePath = skillPath(root, id)
  if (path.basename(filePath) === SKILL_FILE) fs.rmSync(path.dirname(filePath), { recursive: true, force: false, maxRetries: 2 })
  else fs.unlinkSync(filePath)
}

module.exports = { createSystemSkill, deleteSystemSkill, getSystemSkill, listSystemSkills, updateSystemSkill }
