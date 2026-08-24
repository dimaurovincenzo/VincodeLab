const { toPublicError } = require('../errors/public-error.cjs')

function createGitHubProjectUseCases({ cache, github, projects, runner }) {
  const { CACHE_TTL, getCachedResource, invalidateGitHubDataCache, invalidateProjectMutationCache, projectBoardCacheKey } = cache
  const { getRepository, runWithSignal } = github
  const {
    addIssueToProject,
    archiveProjectItem,
    closeLinkedProject,
    createLinkedProject,
    createProjectDraft,
    editLinkedProject,
    getProjectBoard,
    getProjectItemFields,
    updateProjectItem,
  } = projects
  const { run } = runner

  async function getLinkedProjectBoard(workspacePath, projectNumber, { signal } = {}) {
    try {
      return await getProjectBoard(runWithSignal(signal), workspacePath, await getRepository(workspacePath, { signal }), projectNumber)
    } catch (error) {
      throw toPublicError(error, { code: 'GITHUB_PROJECT_BOARD_FAILED', message: 'Lettura del Project GitHub non riuscita.' })
    }
  }

  function getCachedProjectBoard(workspacePath, projectNumber, options) {
    return getCachedResource(workspacePath, projectBoardCacheKey(projectNumber), CACHE_TTL.projectBoard, (signal) => getLinkedProjectBoard(workspacePath, projectNumber, { signal }), options)
  }

  async function addWorkspaceIssueToProject(workspacePath, projectNumber, issueUrl) {
    try {
      const result = await addIssueToProject(run, workspacePath, await getRepository(workspacePath), projectNumber, issueUrl)
      invalidateProjectMutationCache(workspacePath, projectNumber)
      return result
    } catch (error) {
      throw toPublicError(error, { code: 'GITHUB_PROJECT_UPDATE_FAILED', message: 'Aggiornamento del Project GitHub non riuscito.' })
    }
  }

  async function updateWorkspaceProjectItem(workspacePath, projectNumber, itemId, fieldId, update) {
    try {
      const result = await updateProjectItem(run, workspacePath, await getRepository(workspacePath), projectNumber, itemId, fieldId, update)
      invalidateProjectMutationCache(workspacePath, projectNumber)
      return result
    } catch (error) {
      throw toPublicError(error, { code: 'GITHUB_PROJECT_UPDATE_FAILED', message: 'Aggiornamento del Project GitHub non riuscito.' })
    }
  }

  async function getWorkspaceProjectItemFields(workspacePath, projectNumber, itemId, { signal } = {}) {
    try {
      return await getProjectItemFields(runWithSignal(signal), workspacePath, await getRepository(workspacePath, { signal }), projectNumber, itemId)
    } catch (error) {
      throw toPublicError(error, { code: 'GITHUB_PROJECT_FIELDS_FAILED', message: 'Lettura dei campi Project non riuscita.' })
    }
  }

  async function createWorkspaceProject(workspacePath, title) {
    try {
      const result = await createLinkedProject(run, workspacePath, await getRepository(workspacePath), title)
      invalidateGitHubDataCache(workspacePath)
      return result
    } catch (error) {
      throw toPublicError(error, { code: 'GITHUB_PROJECT_CREATE_FAILED', message: 'Creazione del Project GitHub non riuscita.' })
    }
  }

  async function editWorkspaceProject(workspacePath, projectNumber, title, description) {
    try {
      const result = await editLinkedProject(run, workspacePath, await getRepository(workspacePath), projectNumber, title, description)
      invalidateProjectMutationCache(workspacePath, projectNumber)
      return result
    } catch (error) {
      throw toPublicError(error, { code: 'GITHUB_PROJECT_UPDATE_FAILED', message: 'Aggiornamento del Project GitHub non riuscito.' })
    }
  }

  async function closeWorkspaceProject(workspacePath, projectNumber, undo) {
    try {
      const result = await closeLinkedProject(run, workspacePath, await getRepository(workspacePath), projectNumber, undo)
      invalidateProjectMutationCache(workspacePath, projectNumber)
      return result
    } catch (error) {
      throw toPublicError(error, { code: 'GITHUB_PROJECT_UPDATE_FAILED', message: 'Aggiornamento del Project GitHub non riuscito.' })
    }
  }

  async function createWorkspaceProjectDraft(workspacePath, projectNumber, title, body) {
    try {
      const result = await createProjectDraft(run, workspacePath, await getRepository(workspacePath), projectNumber, title, body)
      invalidateProjectMutationCache(workspacePath, projectNumber)
      return result
    } catch (error) {
      throw toPublicError(error, { code: 'GITHUB_PROJECT_UPDATE_FAILED', message: 'Aggiornamento del Project GitHub non riuscito.' })
    }
  }

  async function archiveWorkspaceProjectItem(workspacePath, projectNumber, itemId, undo) {
    try {
      const result = await archiveProjectItem(run, workspacePath, await getRepository(workspacePath), projectNumber, itemId, undo)
      invalidateProjectMutationCache(workspacePath, projectNumber)
      return result
    } catch (error) {
      throw toPublicError(error, { code: 'GITHUB_PROJECT_UPDATE_FAILED', message: 'Aggiornamento del Project GitHub non riuscito.' })
    }
  }

  return {
    addWorkspaceIssueToProject,
    archiveWorkspaceProjectItem,
    closeWorkspaceProject,
    createWorkspaceProject,
    createWorkspaceProjectDraft,
    editWorkspaceProject,
    getCachedProjectBoard,
    getLinkedProjectBoard,
    getWorkspaceProjectItemFields,
    updateWorkspaceProjectItem,
  }
}

module.exports = { createGitHubProjectUseCases }
