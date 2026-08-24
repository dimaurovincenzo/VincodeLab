const fs = require('node:fs')
const path = require('node:path')
const { createProjectSkillsStoragePort } = require('../../domains/ai/project-skills-storage.port.cjs')
const { assertRegularFile, writeFileAtomic } = require('../../domains/filesystem/file-utils.cjs')

const MAX_SKILL_FILES = 500
const MAX_TRAVERSAL_DEPTH = 8
const SKILL_FILE = 'SKILL.md'
const SKILLS_DIRECTORY = path.join('.pi', 'skills')

function skillsRoot(workspacePath) {
  return path.join(workspacePath, SKILLS_DIRECTORY)
}

function getSafeSkillsRoot(workspacePath, create = false) {
  const piDirectory = path.join(workspacePath, '.pi')
  for (const directory of [piDirectory, skillsRoot(workspacePath)]) {
    if (fs.existsSync(directory)) {
      const stats = fs.lstatSync(directory)
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error('La directory skill del progetto non è sicura.')
      }
    } else if (create) {
      fs.mkdirSync(directory, { mode: 0o700 })
    } else {
      return null
    }
  }
  return skillsRoot(workspacePath)
}

function collectSkillRecords(root, directory = root, records = [], depth = 0, segments = []) {
  if (depth > MAX_TRAVERSAL_DEPTH || records.length >= MAX_SKILL_FILES) return records
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (records.length >= MAX_SKILL_FILES) break
    if (entry.isSymbolicLink()) continue
    const entryPath = path.join(directory, entry.name)
    if (depth === 0 && entry.isFile() && entry.name.endsWith('.md')) {
      records.push({ id: entry.name, content: fs.readFileSync(entryPath, 'utf8') })
      continue
    }
    if (!entry.isDirectory()) continue

    const skillFilePath = path.join(entryPath, SKILL_FILE)
    if (fs.existsSync(skillFilePath)) {
      const skillFileStats = fs.lstatSync(skillFilePath)
      if (skillFileStats.isFile() && !skillFileStats.isSymbolicLink()) {
        records.push({ id: [...segments, entry.name].join('/'), content: fs.readFileSync(skillFilePath, 'utf8') })
      }
    } else {
      collectSkillRecords(root, entryPath, records, depth + 1, [...segments, entry.name])
    }
  }
  return records
}

function resolveSkillFile(workspacePath, reference) {
  const root = getSafeSkillsRoot(workspacePath)
  if (!root) throw new Error('Skill non trovata.')

  if (reference.kind === 'root-markdown') {
    const candidate = path.join(root, reference.segments[0])
    assertRegularFile(candidate, 'Skill non trovata.')
    return { filePath: candidate, rootMarkdown: true }
  }

  let directory = root
  for (const segment of reference.segments) {
    directory = path.join(directory, segment)
    let stats
    try {
      stats = fs.lstatSync(directory)
    } catch (error) {
      if (error && error.code === 'ENOENT') throw new Error('Skill non trovata.')
      throw error
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('La directory skill richiesta non è sicura.')
    }
  }
  const candidate = path.join(directory, SKILL_FILE)
  assertRegularFile(candidate, 'Skill non trovata.')
  return { filePath: candidate, rootMarkdown: false }
}

function createProjectSkillsFilesystemAdapter() {
  const preparedUpdateTargets = new WeakMap()

  return createProjectSkillsStoragePort({
    assertRootPresent(workspacePath) {
      if (!getSafeSkillsRoot(workspacePath)) throw new Error('Skill non trovata.')
    },

    create(workspacePath, name, content) {
      const root = getSafeSkillsRoot(workspacePath, true)
      const directory = path.join(root, name)
      if (fs.existsSync(directory)) throw new Error('Esiste già una skill con questo nome.')

      fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
      fs.writeFileSync(path.join(directory, SKILL_FILE), content, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
    },

    list(workspacePath) {
      const root = getSafeSkillsRoot(workspacePath)
      return root ? collectSkillRecords(root) : []
    },

    prepareUpdate(workspacePath, reference) {
      const { filePath } = resolveSkillFile(workspacePath, reference)
      const handle = Object.freeze({})
      preparedUpdateTargets.set(handle, filePath)
      return handle
    },

    read(workspacePath, reference) {
      const { filePath } = resolveSkillFile(workspacePath, reference)
      return { id: reference.id, content: fs.readFileSync(filePath, 'utf8') }
    },

    remove(workspacePath, reference) {
      const { filePath, rootMarkdown } = resolveSkillFile(workspacePath, reference)
      const target = rootMarkdown ? filePath : path.dirname(filePath)
      fs.rmSync(target, { recursive: !rootMarkdown, force: false, maxRetries: 2 })
    },

    write(handle, content) {
      const filePath = preparedUpdateTargets.get(handle)
      if (!filePath) throw new TypeError('Handle aggiornamento skill progetto non valido.')
      preparedUpdateTargets.delete(handle)
      writeFileAtomic(filePath, content)
    },
  })
}

module.exports = { createProjectSkillsFilesystemAdapter }
