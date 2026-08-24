function createGitHubRemoteBridge(ipcRenderer) {
  return {
    github: {
      gitStatus: (options) => ipcRenderer.invoke('github:gitStatus', options),
      initRepository: () => ipcRenderer.invoke('github:initRepository'),
      addRemote: (remoteUrl) => ipcRenderer.invoke('github:addRemote', remoteUrl),
      createRepository: (repositoryName, visibility) => ipcRenderer.invoke('github:createRepository', repositoryName, visibility),
      stage: (filePaths) => ipcRenderer.invoke('github:stage', filePaths),
      unstage: (filePaths) => ipcRenderer.invoke('github:unstage', filePaths),
      commit: (message) => ipcRenderer.invoke('github:commit', message),
      push: () => ipcRenderer.invoke('github:push'),
      fetch: () => ipcRenderer.invoke('github:fetch'),
      pullRebase: () => ipcRenderer.invoke('github:pullRebase'),
      branches: () => ipcRenderer.invoke('github:branches'),
      switchBranch: (branchName) => ipcRenderer.invoke('github:switchBranch', branchName),
      createBranch: (branchName) => ipcRenderer.invoke('github:createBranch', branchName),
      fileDiff: (filePath) => ipcRenderer.invoke('github:fileDiff', filePath),
      revert: (sha) => ipcRenderer.invoke('github:revert', sha),
      data: (options) => ipcRenderer.invoke('github:data', options),
      createIssue: (title, body) => ipcRenderer.invoke('github:createIssue', title, body),
      updateIssue: (issueNumber, title, body, state) => ipcRenderer.invoke('github:updateIssue', issueNumber, title, body, state),
      projectBoard: (projectNumber, options) => ipcRenderer.invoke('github:projectBoard', projectNumber, options),
      createProject: (title) => ipcRenderer.invoke('github:createProject', title),
      editProject: (projectNumber, title, description) => ipcRenderer.invoke('github:editProject', projectNumber, title, description),
      closeProject: (projectNumber, undo) => ipcRenderer.invoke('github:closeProject', projectNumber, undo),
      addIssueToProject: (projectNumber, issueUrl) => ipcRenderer.invoke('github:addIssueToProject', projectNumber, issueUrl),
      updateProjectItem: (projectNumber, itemId, fieldId, update) => ipcRenderer.invoke('github:updateProjectItem', projectNumber, itemId, fieldId, update),
      projectItemFields: (projectNumber, itemId) => ipcRenderer.invoke('github:projectItemFields', projectNumber, itemId),
      createProjectDraft: (projectNumber, title, body) => ipcRenderer.invoke('github:createProjectDraft', projectNumber, title, body),
      archiveProjectItem: (projectNumber, itemId, undo) => ipcRenderer.invoke('github:archiveProjectItem', projectNumber, itemId, undo),
    },
    workspaceCommands: {
      list: () => ipcRenderer.invoke('workspaceCommands:list'),
      createCategory: (name) => ipcRenderer.invoke('workspaceCommands:createCategory', name),
      updateCategory: (categoryId, name) => ipcRenderer.invoke('workspaceCommands:updateCategory', categoryId, name),
      deleteCategory: (categoryId) => ipcRenderer.invoke('workspaceCommands:deleteCategory', categoryId),
      create: (input) => ipcRenderer.invoke('workspaceCommands:create', input),
      update: (commandId, input) => ipcRenderer.invoke('workspaceCommands:update', commandId, input),
      move: (commandId, categoryId) => ipcRenderer.invoke('workspaceCommands:move', commandId, categoryId),
      delete: (commandId) => ipcRenderer.invoke('workspaceCommands:delete', commandId),
      run: (commandId) => ipcRenderer.invoke('workspaceCommands:run', commandId),
    },
    managedSsh: {
      list: () => ipcRenderer.invoke('managedSsh:list'),
      check: (connectionId) => ipcRenderer.invoke('managedSsh:check', connectionId),
      disconnect: (connectionId) => ipcRenderer.invoke('managedSsh:disconnect', connectionId),
      onStatus: (listener) => {
        const handler = (_event, status) => listener(status)
        ipcRenderer.on('managedSsh:status', handler)
        return () => ipcRenderer.removeListener('managedSsh:status', handler)
      },
    },
    remoteFiles: {
      browse: (connectionId, directoryId) => ipcRenderer.invoke('remoteFiles:browse', connectionId, directoryId),
      downloadAndTrack: (entryId) => ipcRenderer.invoke('remoteFiles:downloadAndTrack', entryId),
      downloadAs: (entryId) => ipcRenderer.invoke('remoteFiles:downloadAs', entryId),
      read: (fileId) => ipcRenderer.invoke('remoteFiles:read', fileId),
      preview: (fileId) => ipcRenderer.invoke('remoteFiles:preview', fileId),
      saveLocal: (fileId, content) => ipcRenderer.invoke('remoteFiles:saveLocal', fileId, content),
      compare: (fileId) => ipcRenderer.invoke('remoteFiles:compare', fileId),
      upload: (fileId, options) => ipcRenderer.invoke('remoteFiles:upload', fileId, options),
      chooseAndUpload: (connectionId, directoryId) => ipcRenderer.invoke('remoteFiles:chooseAndUpload', connectionId, directoryId),
      cancelTransfer: (transferId) => ipcRenderer.invoke('remoteFiles:cancelTransfer', transferId),
      createDirectory: (connectionId, parentId, name) => ipcRenderer.invoke('remoteFiles:createDirectory', connectionId, parentId, name),
      rename: (entryId, name) => ipcRenderer.invoke('remoteFiles:rename', entryId, name),
      remove: (entryId) => ipcRenderer.invoke('remoteFiles:remove', entryId),
      discard: (fileId, options) => ipcRenderer.invoke('remoteFiles:discard', fileId, options),
      listTracked: () => ipcRenderer.invoke('remoteFiles:listTracked'),
      revealLocal: (fileId) => ipcRenderer.invoke('remoteFiles:revealLocal', fileId),
      cleanup: (options) => ipcRenderer.invoke('remoteFiles:cleanup', options),
      onTransfer: (listener) => {
        const handler = (_event, transfer) => listener(transfer)
        ipcRenderer.on('remoteFiles:transfer', handler)
        return () => ipcRenderer.removeListener('remoteFiles:transfer', handler)
      },
    },
  }
}

module.exports = { createGitHubRemoteBridge }
