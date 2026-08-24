const { validateSkill } = require('./skill-validation.cjs')
const { assertPiPackageSkillsSourcePort } = require('./pi-package-skills-source.port.cjs')

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

function toPackageSkill(record) {
  const validation = validateSkill(record.content, record.fallbackName)
  return {
    id: `${record.source}::${record.relativePath}`,
    name: validation.attributes?.name ?? record.fallbackName,
    description: validation.attributes?.description ?? '',
    valid: validation.valid,
    issues: validation.issues,
    source: record.source,
    packageName: record.packageName,
    relativePath: record.relativePath,
  }
}

function unreadablePackageSkill(record) {
  return {
    id: `${record.source}::${record.relativePath}`,
    name: record.fallbackName,
    description: '',
    valid: false,
    issues: [{ level: 'error', message: 'Impossibile leggere la skill dal pacchetto. Controlla o aggiorna il pacchetto di origine.' }],
    source: record.source,
    packageName: record.packageName,
    relativePath: record.relativePath,
  }
}

function hasPackageSkillMetadata(record) {
  return record
    && typeof record.source === 'string'
    && typeof record.packageName === 'string'
    && typeof record.relativePath === 'string'
    && typeof record.fallbackName === 'string'
}

function listPiPackageSkills(packages, source) {
  if (!Array.isArray(packages)) return []
  const records = assertPiPackageSkillsSourcePort(source).scan(packages)
  if (!Array.isArray(records)) throw new TypeError('La porta catalogo skill dei pacchetti Pi ha restituito un risultato non valido.')
  const result = new Map()
  for (const record of records) {
    if (!hasPackageSkillMetadata(record)) continue
    try {
      if (record.kind !== 'readable' && record.kind !== 'unreadable') continue
      if (record.kind === 'readable' && typeof record.content !== 'string') continue
      const skill = record.kind === 'readable'
        ? toPackageSkill(record)
        : unreadablePackageSkill(record)
      result.set(skill.id, skill)
    } catch {
      const skill = unreadablePackageSkill(record)
      result.set(skill.id, skill)
    }
  }
  return [...result.values()].sort((left, right) => left.name.localeCompare(right.name, 'it-IT'))
}

module.exports = { listPiPackageSkills, parsePiPackageList }
