const fs = require('node:fs')
const path = require('node:path')
const { validateSkill } = require('./skill-validation.cjs')

const MAX_SKILLS_PER_PACKAGE = 500
const MAX_MANIFEST_BYTES = 1024 * 1024

function parsePiPackageList(output) {
  if (typeof output !== 'string') return []
  const packages = []
  let source = null
  for (const line of output.split(/\r?\n/)) {
    if (/^  \S/.test(line) && !/^    /.test(line)) {
      source = line.trim()
      continue
    }
    if (source && /^    \//.test(line)) {
      packages.push({ source, root: line.trim() })
      source = null
    }
  }
  return packages
}

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
    // Un manifest assente rende opzionali i metadati. Permessi, I/O o JSON
    // corrotto devono invece raggiungere la superficie Settings con il retry.
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

function skillRoots(root, manifest) {
  const declared = manifest?.pi && typeof manifest.pi === 'object' && !Array.isArray(manifest.pi) ? manifest.pi.skills : undefined
  const candidates = Array.isArray(declared) ? declared : declared === undefined ? ['skills'] : []
  return candidates.map((candidate) => safePackagePath(root, candidate)).filter((candidate) => candidate && isSafeDirectory(candidate))
}

function collectSkillFiles(directory, files = [], depth = 0) {
  if (depth > 8 || files.length >= MAX_SKILLS_PER_PACKAGE) return files
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    const entryPath = path.join(directory, entry.name)
    if (depth === 0 && entry.isFile() && entry.name.endsWith('.md')) files.push(entryPath)
    if (!entry.isDirectory()) continue
    const skillPath = path.join(entryPath, 'SKILL.md')
    try {
      const stats = fs.lstatSync(skillPath)
      if (stats.isFile() && !stats.isSymbolicLink()) { files.push(skillPath); continue }
    } catch (error) {
      // SKILL.md è opzionale soltanto quando non esiste. Un problema di accesso
      // interrompe la scansione e viene mostrato nella superficie Settings.
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
    }
    collectSkillFiles(entryPath, files, depth + 1)
  }
  return files
}

function toPackageSkill(root, source, packageName, skillPath) {
  const content = fs.readFileSync(skillPath, 'utf8')
  const relativePath = path.relative(root, skillPath).split(path.sep).join('/')
  const fallbackName = path.basename(skillPath) === 'SKILL.md' ? path.basename(path.dirname(skillPath)) : path.basename(skillPath, '.md')
  const validation = validateSkill(content, fallbackName)
  return {
    id: `${source}::${relativePath}`,
    name: validation.attributes?.name ?? fallbackName,
    description: validation.attributes?.description ?? '',
    valid: validation.valid,
    issues: validation.issues,
    source,
    packageName,
    relativePath,
  }
}

function unreadablePackageSkill(root, source, packageName, skillPath) {
  const relativePath = path.relative(root, skillPath).split(path.sep).join('/')
  const fallbackName = path.basename(skillPath) === 'SKILL.md' ? path.basename(path.dirname(skillPath)) : path.basename(skillPath, '.md')
  return {
    id: `${source}::${relativePath}`,
    name: fallbackName,
    description: '',
    valid: false,
    issues: [{ level: 'error', message: 'Impossibile leggere la skill dal pacchetto. Controlla o aggiorna il pacchetto di origine.' }],
    source,
    packageName,
    relativePath,
  }
}

function listPiPackageSkills(packages) {
  if (!Array.isArray(packages)) return []
  const result = new Map()
  for (const item of packages) {
    if (!item || typeof item.source !== 'string' || typeof item.root !== 'string' || !path.isAbsolute(item.root)) continue
    const root = path.resolve(item.root)
    if (!isSafeDirectory(root)) continue
    const manifest = readPackageManifest(root)
    const packageName = typeof manifest?.name === 'string' && manifest.name ? manifest.name : item.source
    for (const skillsDirectory of skillRoots(root, manifest)) {
      for (const skillPath of collectSkillFiles(skillsDirectory)) {
        try {
          const skill = toPackageSkill(root, item.source, packageName, skillPath)
          result.set(skill.id, skill)
        } catch {
          // Mantiene visibile il failure nel catalogo senza esporre la causa filesystem.
          // Le altre skill del pacchetto restano disponibili e validate singolarmente.
          const skill = unreadablePackageSkill(root, item.source, packageName, skillPath)
          result.set(skill.id, skill)
        }
      }
    }
  }
  return [...result.values()].sort((left, right) => left.name.localeCompare(right.name, 'it-IT'))
}

module.exports = { listPiPackageSkills, parsePiPackageList }
