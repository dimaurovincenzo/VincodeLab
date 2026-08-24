const GITHUB_INVOKE_CHANNELS = Object.freeze([
  'github:createRepository',
  'github:data',
  'github:createIssue',
  'github:updateIssue',
  'github:projectBoard',
  'github:createProject',
  'github:editProject',
  'github:closeProject',
  'github:addIssueToProject',
  'github:updateProjectItem',
  'github:projectItemFields',
  'github:createProjectDraft',
  'github:archiveProjectItem',
])

function createGithubHandlers({
  addWorkspaceIssueToProject,
  archiveWorkspaceProjectItem,
  assertCacheReadOptions,
  assertTrustedSender,
  closeWorkspaceProject,
  createGitHubRepository,
  createIssue,
  createWorkspaceProject,
  createWorkspaceProjectDraft,
  editWorkspaceProject,
  getCachedGitHubData,
  getCachedProjectBoard,
  getWorkspaceProjectItemFields,
  runLatestGithubRead,
  runWorkspaceMutation,
  updateIssue,
  updateWorkspaceProjectItem,
}) {
  return new Map([
    ['github:createRepository', (event, repositoryName, visibility) => (
      runWorkspaceMutation(event, 'github:create-repository', (workspacePath) => (
        createGitHubRepository(workspacePath, repositoryName, visibility)
      ))
    )],
    ['github:data', (event, options) => {
      assertTrustedSender(event)
      const readOptions = assertCacheReadOptions(options)
      return runLatestGithubRead(event, 'data', (workspacePath, signal) => (
        getCachedGitHubData(workspacePath, { ...readOptions, signal })
      ))
    }],
    ['github:createIssue', (event, title, body) => (
      runWorkspaceMutation(event, 'github:create-issue', (workspacePath) => createIssue(workspacePath, title, body))
    )],
    ['github:updateIssue', (event, issueNumber, title, body, state) => (
      runWorkspaceMutation(event, 'github:update-issue', (workspacePath) => (
        updateIssue(workspacePath, issueNumber, title, body, state)
      ))
    )],
    ['github:projectBoard', (event, projectNumber, options) => {
      assertTrustedSender(event)
      const readOptions = assertCacheReadOptions(options)
      return runLatestGithubRead(event, 'project-board', (workspacePath, signal) => (
        getCachedProjectBoard(workspacePath, projectNumber, { ...readOptions, signal })
      ))
    }],
    ['github:createProject', (event, title) => (
      runWorkspaceMutation(event, 'github:create-project', (workspacePath) => createWorkspaceProject(workspacePath, title))
    )],
    ['github:editProject', (event, projectNumber, title, description) => (
      runWorkspaceMutation(event, 'github:edit-project', (workspacePath) => (
        editWorkspaceProject(workspacePath, projectNumber, title, description)
      ))
    )],
    ['github:closeProject', (event, projectNumber, undo) => (
      runWorkspaceMutation(event, 'github:close-project', (workspacePath) => (
        closeWorkspaceProject(workspacePath, projectNumber, undo)
      ))
    )],
    ['github:addIssueToProject', (event, projectNumber, issueUrl) => (
      runWorkspaceMutation(event, 'github:add-issue-to-project', (workspacePath) => (
        addWorkspaceIssueToProject(workspacePath, projectNumber, issueUrl)
      ))
    )],
    ['github:updateProjectItem', (event, projectNumber, itemId, fieldId, update) => (
      runWorkspaceMutation(event, 'github:update-project-item', (workspacePath) => (
        updateWorkspaceProjectItem(workspacePath, projectNumber, itemId, fieldId, update)
      ))
    )],
    ['github:projectItemFields', (event, projectNumber, itemId) => {
      assertTrustedSender(event)
      return runLatestGithubRead(event, 'project-fields', (workspacePath, signal) => (
        getWorkspaceProjectItemFields(workspacePath, projectNumber, itemId, { signal })
      ))
    }],
    ['github:createProjectDraft', (event, projectNumber, title, body) => (
      runWorkspaceMutation(event, 'github:create-project-draft', (workspacePath) => (
        createWorkspaceProjectDraft(workspacePath, projectNumber, title, body)
      ))
    )],
    ['github:archiveProjectItem', (event, projectNumber, itemId, undo) => (
      runWorkspaceMutation(event, 'github:archive-project-item', (workspacePath) => (
        archiveWorkspaceProjectItem(workspacePath, projectNumber, itemId, undo)
      ))
    )],
  ])
}

function registerGithubIpc({ ipcMain, ...dependencies }) {
  const handlers = createGithubHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: GITHUB_INVOKE_CHANNELS })
}

module.exports = { GITHUB_INVOKE_CHANNELS, createGithubHandlers, registerGithubIpc }
