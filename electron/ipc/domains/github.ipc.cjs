const { GITHUB_INVOKE_CHANNELS, IPC_CHANNELS } = require('../channels.cjs')

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
    [IPC_CHANNELS.GITHUB_CREATE_REPOSITORY, (event, repositoryName, visibility) => (
      runWorkspaceMutation(event, 'github:create-repository', (workspacePath) => (
        createGitHubRepository(workspacePath, repositoryName, visibility)
      ))
    )],
    [IPC_CHANNELS.GITHUB_DATA, (event, options) => {
      assertTrustedSender(event)
      const readOptions = assertCacheReadOptions(options)
      return runLatestGithubRead(event, 'data', (workspacePath, signal) => (
        getCachedGitHubData(workspacePath, { ...readOptions, signal })
      ))
    }],
    [IPC_CHANNELS.GITHUB_CREATE_ISSUE, (event, title, body) => (
      runWorkspaceMutation(event, 'github:create-issue', (workspacePath) => createIssue(workspacePath, title, body))
    )],
    [IPC_CHANNELS.GITHUB_UPDATE_ISSUE, (event, issueNumber, title, body, state) => (
      runWorkspaceMutation(event, 'github:update-issue', (workspacePath) => (
        updateIssue(workspacePath, issueNumber, title, body, state)
      ))
    )],
    [IPC_CHANNELS.GITHUB_PROJECT_BOARD, (event, projectNumber, options) => {
      assertTrustedSender(event)
      const readOptions = assertCacheReadOptions(options)
      return runLatestGithubRead(event, 'project-board', (workspacePath, signal) => (
        getCachedProjectBoard(workspacePath, projectNumber, { ...readOptions, signal })
      ))
    }],
    [IPC_CHANNELS.GITHUB_CREATE_PROJECT, (event, title) => (
      runWorkspaceMutation(event, 'github:create-project', (workspacePath) => createWorkspaceProject(workspacePath, title))
    )],
    [IPC_CHANNELS.GITHUB_EDIT_PROJECT, (event, projectNumber, title, description) => (
      runWorkspaceMutation(event, 'github:edit-project', (workspacePath) => (
        editWorkspaceProject(workspacePath, projectNumber, title, description)
      ))
    )],
    [IPC_CHANNELS.GITHUB_CLOSE_PROJECT, (event, projectNumber, undo) => (
      runWorkspaceMutation(event, 'github:close-project', (workspacePath) => (
        closeWorkspaceProject(workspacePath, projectNumber, undo)
      ))
    )],
    [IPC_CHANNELS.GITHUB_ADD_ISSUE_TO_PROJECT, (event, projectNumber, issueUrl) => (
      runWorkspaceMutation(event, 'github:add-issue-to-project', (workspacePath) => (
        addWorkspaceIssueToProject(workspacePath, projectNumber, issueUrl)
      ))
    )],
    [IPC_CHANNELS.GITHUB_UPDATE_PROJECT_ITEM, (event, projectNumber, itemId, fieldId, update) => (
      runWorkspaceMutation(event, 'github:update-project-item', (workspacePath) => (
        updateWorkspaceProjectItem(workspacePath, projectNumber, itemId, fieldId, update)
      ))
    )],
    [IPC_CHANNELS.GITHUB_PROJECT_ITEM_FIELDS, (event, projectNumber, itemId) => {
      assertTrustedSender(event)
      return runLatestGithubRead(event, 'project-fields', (workspacePath, signal) => (
        getWorkspaceProjectItemFields(workspacePath, projectNumber, itemId, { signal })
      ))
    }],
    [IPC_CHANNELS.GITHUB_CREATE_PROJECT_DRAFT, (event, projectNumber, title, body) => (
      runWorkspaceMutation(event, 'github:create-project-draft', (workspacePath) => (
        createWorkspaceProjectDraft(workspacePath, projectNumber, title, body)
      ))
    )],
    [IPC_CHANNELS.GITHUB_ARCHIVE_PROJECT_ITEM, (event, projectNumber, itemId, undo) => (
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
