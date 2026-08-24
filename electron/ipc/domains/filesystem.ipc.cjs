const { FILESYSTEM_INVOKE_CHANNELS, IPC_CHANNELS } = require('../channels.cjs')

function createFilesystemHandlers({
  assertTrustedSender,
  createProjectDirectory,
  createProjectFile,
  duplicateProjectEntry,
  listDirectoryEntries,
  listProjectFiles,
  log,
  prepareProjectFileAttachment,
  projectFileIndex,
  readProjectFile,
  readProjectPreview,
  searchProjectFileContents,
  renameProjectEntry,
  requireActiveWorkspace,
  resolveProjectDirectory,
  resolveProjectFile,
  saveProjectFile,
  trashItem,
}) {
  return new Map([
    [IPC_CHANNELS.FILES_LIST, (event) => {
      assertTrustedSender(event)
      return listProjectFiles(requireActiveWorkspace())
    }],
    [IPC_CHANNELS.FILES_LIST_DIRECTORY, (event, directoryId) => {
      assertTrustedSender(event)
      return listDirectoryEntries(requireActiveWorkspace(), directoryId)
    }],
    [IPC_CHANNELS.FILES_INDEX, (event, options) => {
      assertTrustedSender(event)
      const force = options?.force === true
      if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key) => key !== 'force') || (options.force !== undefined && typeof options.force !== 'boolean'))) {
        throw new Error('Opzioni indice file non valide.')
      }
      return projectFileIndex.build(requireActiveWorkspace(), { force })
    }],
    [IPC_CHANNELS.FILES_INDEX_STATUS, (event) => {
      assertTrustedSender(event)
      return projectFileIndex.getStatus(requireActiveWorkspace())
    }],
    [IPC_CHANNELS.FILES_READ, (event, fileId) => {
      assertTrustedSender(event)
      return readProjectFile(requireActiveWorkspace(), fileId)
    }],
    [IPC_CHANNELS.FILES_SEARCH_CONTENT, (event, query, options) => {
      assertTrustedSender(event)
      return searchProjectFileContents(requireActiveWorkspace(), query, options)
    }],
    [IPC_CHANNELS.FILES_PREVIEW, (event, fileId) => {
      assertTrustedSender(event)
      return readProjectPreview(requireActiveWorkspace(), fileId)
    }],
    [IPC_CHANNELS.FILES_PREPARE_ATTACHMENT, (event, fileId) => {
      assertTrustedSender(event)
      return prepareProjectFileAttachment(requireActiveWorkspace(), fileId)
    }],
    [IPC_CHANNELS.FILES_CREATE, (event, directoryId, fileName) => {
      assertTrustedSender(event)
      const result = createProjectFile(requireActiveWorkspace(), directoryId, fileName)
      log('info', 'project_file_created')
      projectFileIndex.invalidate(requireActiveWorkspace())
      return result
    }],
    [IPC_CHANNELS.FILES_CREATE_DIRECTORY, (event, parentId, directoryName) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      const result = createProjectDirectory(workspacePath, parentId, directoryName)
      log('info', 'project_directory_created')
      projectFileIndex.invalidate(workspacePath)
      return result
    }],
    [IPC_CHANNELS.FILES_RENAME, (event, entryId, entryName, expectedKind) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      const result = renameProjectEntry(workspacePath, entryId, entryName, expectedKind)
      if (result.renamed) {
        log('info', 'project_entry_renamed', { kind: expectedKind })
        projectFileIndex.invalidate(workspacePath)
      }
      return result
    }],
    [IPC_CHANNELS.FILES_DUPLICATE, async (event, entryId, expectedKind) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      const result = await duplicateProjectEntry(workspacePath, entryId, expectedKind)
      log('info', 'project_entry_duplicated', { kind: expectedKind })
      projectFileIndex.invalidate(workspacePath)
      return result
    }],
    [IPC_CHANNELS.FILES_TRASH, async (event, entryId, expectedKind) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      if (!entryId || (expectedKind !== 'file' && expectedKind !== 'directory')) throw new Error('Elemento del workspace non valido.')
      const entryPath = expectedKind === 'file'
        ? resolveProjectFile(workspacePath, entryId)
        : resolveProjectDirectory(workspacePath, entryId)
      await trashItem(entryPath)
      log('info', 'project_entry_moved_to_trash', { kind: expectedKind })
      projectFileIndex.invalidate(workspacePath)
      return { id: entryId, kind: expectedKind, trashed: true }
    }],
    [IPC_CHANNELS.FILES_SAVE, (event, fileId, content, options) => {
      assertTrustedSender(event)
      if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key) => key !== 'force' && key !== 'revision')) {
        throw new Error('Opzioni salvataggio file non valide.')
      }
      return saveProjectFile(requireActiveWorkspace(), fileId, content, options).then((result) => {
        log('info', 'project_file_saved', { size: result.size })
        return result
      })
    }],
  ])
}

function registerFilesystemIpc({ ipcMain, ...dependencies }) {
  const handlers = createFilesystemHandlers(dependencies)
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return Object.freeze({ channels: FILESYSTEM_INVOKE_CHANNELS })
}

module.exports = {
  FILESYSTEM_INVOKE_CHANNELS,
  createFilesystemHandlers,
  registerFilesystemIpc,
}
