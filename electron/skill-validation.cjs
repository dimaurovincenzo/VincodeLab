const YAML = require('yaml')

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return { attributes: null, body: content, issue: 'Frontmatter YAML mancante o non chiuso.' }

  try {
    return { attributes: YAML.parse(match[1]) ?? {}, body: content.slice(match[0].length), issue: null }
  } catch {
    return { attributes: null, body: content, issue: 'Frontmatter YAML non valido.' }
  }
}

function validateSkill(content, directoryName) {
  const { attributes, issue } = extractFrontmatter(content)
  const issues = []
  if (issue) return { valid: false, issues: [{ level: 'error', message: issue }], attributes: null }

  const name = attributes?.name
  const description = attributes?.description
  if (typeof name !== 'string' || !NAME_PATTERN.test(name) || name.length > 64) {
    issues.push({ level: 'error', message: 'name deve contenere 1-64 caratteri lowercase, numeri o trattini.' })
  }
  if (typeof description !== 'string' || description.trim().length === 0 || description.length > 1024) {
    issues.push({ level: 'error', message: 'description è obbligatoria e non può superare 1024 caratteri.' })
  }
  if (name && name !== directoryName) {
    issues.push({ level: 'warning', message: 'Il nome non coincide con la directory; Pi lo accetta, altri harness potrebbero no.' })
  }

  return { valid: !issues.some((entry) => entry.level === 'error'), issues, attributes }
}

module.exports = { NAME_PATTERN, extractFrontmatter, validateSkill }
