const { IPC_CHANNELS } = require('../../ipc/channels.cjs')

function createGitHubRemoteBridge(ipcRenderer) {
  return {
    github: {
      gitStatus: (options) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_GIT_STATUS, options),
      initRepository: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_INIT_REPOSITORY),
      addRemote: (remoteUrl) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_ADD_REMOTE, remoteUrl),
      createRepository: (repositoryName, visibility) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_CREATE_REPOSITORY, repositoryName, visibility),
      stage: (filePaths) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_STAGE, filePaths),
      unstage: (filePaths) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_UNSTAGE, filePaths),
      commit: (message) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_COMMIT, message),
      push: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_PUSH),
      fetch: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_FETCH),
      pullRebase: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_PULL_REBASE),
      branches: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_BRANCHES),
      switchBranch: (branchName) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_SWITCH_BRANCH, branchName),
      createBranch: (branchName) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_CREATE_BRANCH, branchName),
      fileDiff: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_FILE_DIFF, filePath),
      revert: (sha) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_REVERT, sha),
      data: (options) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_DATA, options),
      createIssue: (title, body) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_CREATE_ISSUE, title, body),
      updateIssue: (issueNumber, title, body, state) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_UPDATE_ISSUE, issueNumber, title, body, state),
      projectBoard: (projectNumber, options) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_PROJECT_BOARD, projectNumber, options),
      createProject: (title) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_CREATE_PROJECT, title),
      editProject: (projectNumber, title, description) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_EDIT_PROJECT, projectNumber, title, description),
      closeProject: (projectNumber, undo) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_CLOSE_PROJECT, projectNumber, undo),
      addIssueToProject: (projectNumber, issueUrl) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_ADD_ISSUE_TO_PROJECT, projectNumber, issueUrl),
      updateProjectItem: (projectNumber, itemId, fieldId, update) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_UPDATE_PROJECT_ITEM, projectNumber, itemId, fieldId, update),
      projectItemFields: (projectNumber, itemId) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_PROJECT_ITEM_FIELDS, projectNumber, itemId),
      createProjectDraft: (projectNumber, title, body) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_CREATE_PROJECT_DRAFT, projectNumber, title, body),
      archiveProjectItem: (projectNumber, itemId, undo) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_ARCHIVE_PROJECT_ITEM, projectNumber, itemId, undo),
    },
    workspaceCommands: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_COMMANDS_LIST),
      createCategory: (name) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_COMMANDS_CREATE_CATEGORY, name),
      updateCategory: (categoryId, name) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_COMMANDS_UPDATE_CATEGORY, categoryId, name),
      deleteCategory: (categoryId) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_COMMANDS_DELETE_CATEGORY, categoryId),
      create: (input) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_COMMANDS_CREATE, input),
      update: (commandId, input) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_COMMANDS_UPDATE, commandId, input),
      move: (commandId, categoryId) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_COMMANDS_MOVE, commandId, categoryId),
      delete: (commandId) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_COMMANDS_DELETE, commandId),
      run: (commandId) => ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_COMMANDS_RUN, commandId),
    },
    managedSsh: {
      list: () => ipcRenderer.invoke(IPC_CHANNELS.MANAGED_SSH_LIST),
      check: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.MANAGED_SSH_CHECK, connectionId),
      disconnect: (connectionId) => ipcRenderer.invoke(IPC_CHANNELS.MANAGED_SSH_DISCONNECT, connectionId),
      onStatus: (listener) => {
        const handler = (_event, status) => listener(status)
        ipcRenderer.on(IPC_CHANNELS.MANAGED_SSH_STATUS, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.MANAGED_SSH_STATUS, handler)
      },
    },
    remoteFiles: {
      browse: (connectionId, directoryId) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_BROWSE, connectionId, directoryId),
      downloadAndTrack: (entryId) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_DOWNLOAD_AND_TRACK, entryId),
      downloadAs: (entryId) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_DOWNLOAD_AS, entryId),
      read: (fileId) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_READ, fileId),
      preview: (fileId) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_PREVIEW, fileId),
      saveLocal: (fileId, content) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_SAVE_LOCAL, fileId, content),
      compare: (fileId) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_COMPARE, fileId),
      upload: (fileId, options) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_UPLOAD, fileId, options),
      chooseAndUpload: (connectionId, directoryId) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_CHOOSE_AND_UPLOAD, connectionId, directoryId),
      cancelTransfer: (transferId) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_CANCEL_TRANSFER, transferId),
      createDirectory: (connectionId, parentId, name) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_CREATE_DIRECTORY, connectionId, parentId, name),
      rename: (entryId, name) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_RENAME, entryId, name),
      remove: (entryId) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_REMOVE, entryId),
      discard: (fileId, options) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_DISCARD, fileId, options),
      listTracked: () => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_LIST_TRACKED),
      revealLocal: (fileId) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_REVEAL_LOCAL, fileId),
      cleanup: (options) => ipcRenderer.invoke(IPC_CHANNELS.REMOTE_FILES_CLEANUP, options),
      onTransfer: (listener) => {
        const handler = (_event, transfer) => listener(transfer)
        ipcRenderer.on(IPC_CHANNELS.REMOTE_FILES_TRANSFER, handler)
        return () => ipcRenderer.removeListener(IPC_CHANNELS.REMOTE_FILES_TRANSFER, handler)
      },
    },
  }
}

module.exports = { createGitHubRemoteBridge }
