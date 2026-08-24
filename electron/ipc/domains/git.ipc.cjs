const { GIT_INVOKE_CHANNELS, IPC_CHANNELS } = require('../channels.cjs')

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
    [IPC_CHANNELS.GITHUB_GIT_STATUS, (event, options) => {
      assertTrustedSender(event)
      const readOptions = assertCacheReadOptions(options)
      return runLatestGithubRead(
        event,
        'git-status',
        (workspacePath, signal) => getCachedGitStatus(workspacePath, { ...readOptions, signal }),
      )
    }],
    [IPC_CHANNELS.GITHUB_INIT_REPOSITORY, (event) => runWorkspaceMutation(
      event,
      'github:init-repository',
      initializeGitRepository,
    )],
    [IPC_CHANNELS.GITHUB_ADD_REMOTE, (event, remoteUrl) => runWorkspaceMutation(
      event,
      'github:add-remote',
      (workspacePath) => addGitHubRemote(workspacePath, remoteUrl),
    )],
    [IPC_CHANNELS.GITHUB_STAGE, (event, filePaths) => runWorkspaceMutation(
      event,
      IPC_CHANNELS.GITHUB_STAGE,
      (workspacePath) => stageFiles(workspacePath, filePaths),
    )],
    [IPC_CHANNELS.GITHUB_UNSTAGE, (event, filePaths) => runWorkspaceMutation(
      event,
      IPC_CHANNELS.GITHUB_UNSTAGE,
      (workspacePath) => unstageFiles(workspacePath, filePaths),
    )],
    [IPC_CHANNELS.GITHUB_COMMIT, (event, message) => runWorkspaceMutation(
      event,
      IPC_CHANNELS.GITHUB_COMMIT,
      (workspacePath) => commit(workspacePath, message),
    )],
    [IPC_CHANNELS.GITHUB_PUSH, (event) => runWorkspaceMutation(event, IPC_CHANNELS.GITHUB_PUSH, push)],
    [IPC_CHANNELS.GITHUB_FETCH, (event) => runWorkspaceMutation(event, IPC_CHANNELS.GITHUB_FETCH, fetchRemote)],
    [IPC_CHANNELS.GITHUB_PULL_REBASE, (event) => runWorkspaceMutation(event, 'github:pull-rebase', pullRebase)],
    [IPC_CHANNELS.GITHUB_BRANCHES, (event) => {
      assertTrustedSender(event)
      return runLatestGithubRead(
        event,
        'branches',
        (workspacePath, signal) => listBranches(workspacePath, { signal }),
      )
    }],
    [IPC_CHANNELS.GITHUB_SWITCH_BRANCH, (event, branchName) => runWorkspaceMutation(
      event,
      'github:switch-branch',
      (workspacePath) => switchBranch(workspacePath, branchName),
    )],
    [IPC_CHANNELS.GITHUB_CREATE_BRANCH, (event, branchName) => runWorkspaceMutation(
      event,
      'github:create-branch',
      (workspacePath) => createBranch(workspacePath, branchName),
    )],
    [IPC_CHANNELS.GITHUB_FILE_DIFF, (event, filePath) => {
      assertTrustedSender(event)
      return runLatestGithubRead(
        event,
        'file-diff',
        (workspacePath, signal) => getFileDiff(workspacePath, filePath, { signal }),
      )
    }],
    [IPC_CHANNELS.GITHUB_REVERT, (event, sha) => runWorkspaceMutation(
      event,
      IPC_CHANNELS.GITHUB_REVERT,
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
