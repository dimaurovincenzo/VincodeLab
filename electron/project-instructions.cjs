const fs = require('node:fs')
const path = require('node:path')
const { assertDirectoryOrCreate, assertRegularFile, writeFileAtomic } = require('./file-utils.cjs')

const INSTRUCTIONS_FILE = path.join('.pi', 'APPEND_SYSTEM.md')
const MAX_CONTENT_LENGTH = 200_000

function getInstructionsPath(workspacePath) {
  return path.join(workspacePath, INSTRUCTIONS_FILE)
}

function getProjectInstructions(workspacePath) {
  const filePath = getInstructionsPath(workspacePath)
  if (!fs.existsSync(filePath)) return { exists: false, content: '' }
  assertRegularFile(filePath, 'Istruzioni progetto non trovate.')
  return { exists: true, content: fs.readFileSync(filePath, 'utf8') }
}

function saveProjectInstructions(workspacePath, content) {
  if (typeof content !== 'string' || content.length > MAX_CONTENT_LENGTH) {
    throw new Error('Le istruzioni progetto non sono valide o superano 200.000 caratteri.')
  }

  const filePath = getInstructionsPath(workspacePath)
  assertDirectoryOrCreate(path.dirname(filePath))
  if (fs.existsSync(filePath)) assertRegularFile(filePath, 'Istruzioni progetto non trovate.')
  writeFileAtomic(filePath, content)
  return { exists: true, content }
}

function clearProjectInstructions(workspacePath) {
  const filePath = getInstructionsPath(workspacePath)
  if (fs.existsSync(filePath)) {
    assertRegularFile(filePath, 'Istruzioni progetto non trovate.')
    fs.rmSync(filePath)
  }
  return { exists: false, content: '' }
}

module.exports = {
  clearProjectInstructions,
  getProjectInstructions,
  saveProjectInstructions,
}
