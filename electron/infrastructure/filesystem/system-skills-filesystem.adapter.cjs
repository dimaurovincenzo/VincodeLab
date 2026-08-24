const fs = require('node:fs')
const path = require('node:path')
const { createSystemSkillsStoragePort } = require('../../domains/ai/system-skills-storage.port.cjs')
const { writeFileAtomic } = require('./project-file-io-filesystem.service.cjs')
const { assertRegularProjectFile } = require('./project-path-filesystem.service.cjs')

const MAX_ROOT_ENTRIES = 500
const SKILL_FILE = 'SKILL.md'

function assertRoot(root, create = false) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('Directory skill di sistema non valida.')
  }
  let stats
  try {
    stats = fs.lstatSync(root)
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error
    if (!create) return false
    fs.mkdirSync(root, { recursive: true, mode: 0o700 })
    stats = fs.lstatSync(root)
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('La directory skill di sistema non è sicura.')
  }
  return true
}

function resolveSkillFile(root, skillId) {
  if (!assertRoot(root)) throw new Error('Skill non trovata.')
  const directFilePath = path.join(root, `${skillId}.md`)
  if (fs.existsSync(directFilePath)) {
    assertRegularProjectFile(directFilePath, 'Skill non trovata.')
    return { filePath: directFilePath, legacyFile: true }
  }

  const directory = path.join(root, skillId)
  const stats = fs.lstatSync(directory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('La directory skill richiesta non è sicura.')
  }
  const filePath = path.join(directory, SKILL_FILE)
  assertRegularProjectFile(filePath, 'Skill non trovata.')
  return { filePath, legacyFile: false }
}

function readListedSkill(id, filePath) {
  try {
    const stats = fs.lstatSync(filePath)
    if (!stats.isFile() || stats.isSymbolicLink()) return null
    return { id, content: fs.readFileSync(filePath, 'utf8') }
  } catch (error) {
    // Una entry può sparire tra readdir/lstat/read; gli altri failure restano visibili.
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

function createSystemSkillsFilesystemAdapter() {
  const preparedUpdateTargets = new WeakMap()

  return createSystemSkillsStoragePort({
    assertRootPresent(root) {
      if (!assertRoot(root)) throw new Error('Skill non trovata.')
    },

    create(root, name, content) {
      assertRoot(root, true)
      const directory = path.join(root, name)
      const directFilePath = path.join(root, `${name}.md`)
      if (fs.existsSync(directory) || fs.existsSync(directFilePath)) {
        return { created: false, reason: 'conflict' }
      }

      try {
        fs.mkdirSync(directory, { mode: 0o700 })
      } catch (error) {
        if (error && error.code === 'EEXIST') return { created: false, reason: 'conflict' }
        throw error
      }

      try {
        fs.writeFileSync(path.join(directory, SKILL_FILE), content, { mode: 0o600, flag: 'wx' })
      } catch (error) {
        try {
          fs.rmdirSync(directory)
        } catch {
          // Rimuoviamo solo la directory appena creata quando è ancora vuota.
        }
        throw error
      }
      return { created: true }
    },

    list(root) {
      if (!assertRoot(root)) return []
      let entries
      try {
        entries = fs.readdirSync(root, { withFileTypes: true })
      } catch (error) {
        if (error && error.code === 'ENOENT') return []
        throw error
      }
      return entries.slice(0, MAX_ROOT_ENTRIES)
        .flatMap((entry) => {
          if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.md')) {
            return [{ id: path.basename(entry.name, '.md'), filePath: path.join(root, entry.name) }]
          }
          if (entry.isDirectory() && !entry.isSymbolicLink()) {
            return [{ id: entry.name, filePath: path.join(root, entry.name, SKILL_FILE) }]
          }
          return []
        })
        .map(({ id, filePath }) => readListedSkill(id, filePath))
        .filter(Boolean)
    },

    prepareUpdate(root, skillId) {
      const { filePath } = resolveSkillFile(root, skillId)
      const handle = Object.freeze({})
      preparedUpdateTargets.set(handle, filePath)
      return handle
    },

    read(root, skillId) {
      const { filePath } = resolveSkillFile(root, skillId)
      return { id: skillId, content: fs.readFileSync(filePath, 'utf8') }
    },

    remove(root, skillId) {
      const { filePath, legacyFile } = resolveSkillFile(root, skillId)
      if (legacyFile) fs.unlinkSync(filePath)
      else fs.rmSync(path.dirname(filePath), { recursive: true, force: false, maxRetries: 2 })
    },

    write(handle, content) {
      const filePath = preparedUpdateTargets.get(handle)
      if (!filePath) throw new TypeError('Handle aggiornamento skill di sistema non valido.')
      preparedUpdateTargets.delete(handle)
      writeFileAtomic(filePath, content)
    },
  })
}

module.exports = { createSystemSkillsFilesystemAdapter }
