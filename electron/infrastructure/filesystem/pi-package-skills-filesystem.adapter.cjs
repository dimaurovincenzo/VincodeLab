const fs = require('node:fs')
const path = require('node:path')
const { createPiPackageSkillsSourcePort } = require('../../domains/ai/pi-package-skills-source.port.cjs')

const MAX_SKILLS_PER_PACKAGE = 500
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_SKILL_DIRECTORY_DEPTH = 8

function isSafeDirectory(directory) {
  try {
    const stats = fs.lstatSync(directory)
    return stats.isDirectory() && !stats.isSymbolicLink()
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false
    throw error
  }
}

function safePackagePath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0') || /[*?![\]{}]/.test(relativePath)) return null
  const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/')).replace(/^\.\//, '')
  if (!normalized || normalized === '..' || normalized.startsWith('../')) return null
  const candidate = path.resolve(root, normalized)
  return candidate.startsWith(`${root}${path.sep}`) || candidate === root ? candidate : null
}

function readPackageManifest(root) {
  const manifestPath = path.join(root, 'package.json')
  try {
    const stats = fs.lstatSync(manifestPath)
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_MANIFEST_BYTES) return null
    const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

function skillRoots(root, manifest) {
  const declared = manifest?.pi && typeof manifest.pi === 'object' && !Array.isArray(manifest.pi) ? manifest.pi.skills : undefined
  const candidates = Array.isArray(declared) ? declared : declared === undefined ? ['skills'] : []
  return candidates.map((candidate) => safePackagePath(root, candidate)).filter((candidate) => candidate && isSafeDirectory(candidate))
}

function collectSkillFiles(directory, files, depth = 0) {
  if (depth > MAX_SKILL_DIRECTORY_DEPTH || files.length >= MAX_SKILLS_PER_PACKAGE) return files
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (files.length >= MAX_SKILLS_PER_PACKAGE) break
    if (entry.isSymbolicLink()) continue
    const entryPath = path.join(directory, entry.name)
    if (depth === 0 && entry.isFile() && entry.name.endsWith('.md')) {
      files.push(entryPath)
      continue
    }
    if (!entry.isDirectory()) continue
    const skillPath = path.join(entryPath, 'SKILL.md')
    try {
      const stats = fs.lstatSync(skillPath)
      if (stats.isFile() && !stats.isSymbolicLink()) {
        files.push(skillPath)
        continue
      }
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
    }
    collectSkillFiles(entryPath, files, depth + 1)
  }
  return files
}

function skillMetadata(root, source, packageName, skillPath) {
  const relativePath = path.relative(root, skillPath).split(path.sep).join('/')
  const fallbackName = path.basename(skillPath) === 'SKILL.md' ? path.basename(path.dirname(skillPath)) : path.basename(skillPath, '.md')
  return { fallbackName, packageName, relativePath, source }
}

function readSkillRecord(root, source, packageName, skillPath) {
  const metadata = skillMetadata(root, source, packageName, skillPath)
  try {
    return { kind: 'readable', ...metadata, content: fs.readFileSync(skillPath, 'utf8') }
  } catch {
    return { kind: 'unreadable', ...metadata }
  }
}

function scanPackageSkills(packages) {
  if (!Array.isArray(packages)) return []
  const records = []
  for (const item of packages) {
    if (!item || typeof item.source !== 'string' || typeof item.root !== 'string' || !path.isAbsolute(item.root)) continue
    const root = path.resolve(item.root)
    if (!isSafeDirectory(root)) continue
    const manifest = readPackageManifest(root)
    const packageName = typeof manifest?.name === 'string' && manifest.name ? manifest.name : item.source
    const skillFiles = []
    for (const skillsDirectory of skillRoots(root, manifest)) {
      collectSkillFiles(skillsDirectory, skillFiles)
      if (skillFiles.length >= MAX_SKILLS_PER_PACKAGE) break
    }
    for (const skillPath of skillFiles) records.push(readSkillRecord(root, item.source, packageName, skillPath))
  }
  return records
}

function createPiPackageSkillsFilesystemAdapter() {
  return createPiPackageSkillsSourcePort({ scan: scanPackageSkills })
}

module.exports = { createPiPackageSkillsFilesystemAdapter }
