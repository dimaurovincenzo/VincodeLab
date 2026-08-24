const GIT_INVOKE_CHANNELS = Object.freeze([
  'github:gitStatus',
  'github:initRepository',
  'github:addRemote',
  'github:stage',
  'github:unstage',
  'github:commit',
  'github:push',
  'github:fetch',
  'github:pullRebase',
  'github:branches',
  'github:switchBranch',
  'github:createBranch',
  'github:fileDiff',
  'github:revert',
])

function createGitHandlers({
  addGitHubRemote,
  assertCacheReadOptions,
  assertTrustedSender,
  commit,
  createBranch,
  fetchRemote,
  getCachedGitStatus,
  getFileDiff,
  initializeGitRepository,
  listBranches,
  pullRebase,
  push,
  revertCommit,
  runLatestGithubRead,
  runWorkspaceMutation,
  stageFiles,
  switchBranch,
  unstageFiles,
}) {
  return new Map([
    ['github:gitStatus', (event, options) => {
      assertTrustedSender(event)
      const readOptions = assertCacheReadOptions(options)
      return runLatestGithubRead(
        event,
        'git-status',
        (workspacePath, signal) => getCachedGitStatus(workspacePath, { ...readOptions, signal }),
      )
    }],
    ['github:initRepository', (event) => runWorkspaceMutation(
      event,
      'github:init-repository',
      initializeGitRepository,
    )],
    ['github:addRemote', (event, remoteUrl) => runWorkspaceMutation(
      event,
      'github:add-remote',
      (workspacePath) => addGitHubRemote(workspacePath, remoteUrl),
    )],
    ['github:stage', (event, filePaths) => runWorkspaceMutation(
      event,
      'github:stage',
      (workspacePath) => stageFiles(workspacePath, filePaths),
    )],
    ['github:unstage', (event, filePaths) => runWorkspaceMutation(
      event,
      'github:unstage',
      (workspacePath) => unstageFiles(workspacePath, filePaths),
    )],
    ['github:commit', (event, message) => runWorkspaceMutation(
      event,
      'github:commit',
      (workspacePath) => commit(workspacePath, message),
    )],
    ['github:push', (event) => runWorkspaceMutation(event, 'github:push', push)],
    ['github:fetch', (event) => runWorkspaceMutation(event, 'github:fetch', fetchRemote)],
    ['github:pullRebase', (event) => runWorkspaceMutation(event, 'github:pull-rebase', pullRebase)],
    ['github:branches', (event) => {
      assertTrustedSender(event)
      return runLatestGithubRead(
        event,
        'branches',
        (workspacePath, signal) => listBranches(workspacePath, { signal }),
      )
    }],
    ['github:switchBranch', (event, branchName) => runWorkspaceMutation(
      event,
      'github:switch-branch',
      (workspacePath) => switchBranch(workspacePath, branchName),
    )],
    ['github:createBranch', (event, branchName) => runWorkspaceMutation(
      event,
      'github:create-branch',
      (workspacePath) => createBranch(workspacePath, branchName),
    )],
    ['github:fileDiff', (event, filePath) => {
      assertTrustedSender(event)
      return runLatestGithubRead(
        event,
        'file-diff',
        (workspacePath, signal) => getFileDiff(workspacePath, filePath, { signal }),
      )
    }],
    ['github:revert', (event, sha) => runWorkspaceMutation(
      event,
      'github:revert',
      (workspacePath) => revertCommit(workspacePath, sha),
    )],
  ])
}

function registerGitIpc({ ipcMain, ...dependencies }) {
  const handlers = createGitHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: GIT_INVOKE_CHANNELS })
}

module.exports = { GIT_INVOKE_CHANNELS, createGitHandlers, registerGitIpc }
