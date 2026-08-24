const { assertProjectInstructionsStoragePort } = require('./project-instructions-storage.port.cjs')

const MAX_CONTENT_LENGTH = 200_000

function createProjectInstructionsUseCases({ storage } = {}) {
  const instructionsStorage = assertProjectInstructionsStoragePort(storage)

  function getProjectInstructions(workspacePath) {
    const content = instructionsStorage.read(workspacePath)
    return content === null
      ? { exists: false, content: '' }
      : { exists: true, content }
  }

  function saveProjectInstructions(workspacePath, content) {
    if (typeof content !== 'string' || content.length > MAX_CONTENT_LENGTH) {
      throw new Error('Le istruzioni progetto non sono valide o superano 200.000 caratteri.')
    }

    instructionsStorage.write(workspacePath, content)
    return { exists: true, content }
  }

  function clearProjectInstructions(workspacePath) {
    instructionsStorage.remove(workspacePath)
    return { exists: false, content: '' }
  }

  return Object.freeze({
    clearProjectInstructions,
    getProjectInstructions,
    saveProjectInstructions,
  })
}

module.exports = { createProjectInstructionsUseCases }
