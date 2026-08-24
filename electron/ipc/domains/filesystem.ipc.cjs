const FILESYSTEM_INVOKE_CHANNELS = Object.freeze([
  'files:list',
  'files:listDirectory',
  'files:index',
  'files:indexStatus',
  'files:read',
  'files:preview',
  'files:prepareAttachment',
  'files:create',
  'files:createDirectory',
  'files:rename',
  'files:duplicate',
  'files:trash',
  'files:save',
])

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
  renameProjectEntry,
  requireActiveWorkspace,
  resolveProjectDirectory,
  resolveProjectFile,
  saveProjectFile,
  trashItem,
}) {
  return new Map([
    ['files:list', (event) => {
      assertTrustedSender(event)
      return listProjectFiles(requireActiveWorkspace())
    }],
    ['files:listDirectory', (event, directoryId) => {
      assertTrustedSender(event)
      return listDirectoryEntries(requireActiveWorkspace(), directoryId)
    }],
    ['files:index', (event, options) => {
      assertTrustedSender(event)
      const force = options?.force === true
      if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some((key) => key !== 'force') || (options.force !== undefined && typeof options.force !== 'boolean'))) {
        throw new Error('Opzioni indice file non valide.')
      }
      return projectFileIndex.build(requireActiveWorkspace(), { force })
    }],
    ['files:indexStatus', (event) => {
      assertTrustedSender(event)
      return projectFileIndex.getStatus(requireActiveWorkspace())
    }],
    ['files:read', (event, fileId) => {
      assertTrustedSender(event)
      return readProjectFile(requireActiveWorkspace(), fileId)
    }],
    ['files:preview', (event, fileId) => {
      assertTrustedSender(event)
      return readProjectPreview(requireActiveWorkspace(), fileId)
    }],
    ['files:prepareAttachment', (event, fileId) => {
      assertTrustedSender(event)
      return prepareProjectFileAttachment(requireActiveWorkspace(), fileId)
    }],
    ['files:create', (event, directoryId, fileName) => {
      assertTrustedSender(event)
      const result = createProjectFile(requireActiveWorkspace(), directoryId, fileName)
      log('info', 'project_file_created')
      projectFileIndex.invalidate(requireActiveWorkspace())
      return result
    }],
    ['files:createDirectory', (event, parentId, directoryName) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      const result = createProjectDirectory(workspacePath, parentId, directoryName)
      log('info', 'project_directory_created')
      projectFileIndex.invalidate(workspacePath)
      return result
    }],
    ['files:rename', (event, entryId, entryName, expectedKind) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      const result = renameProjectEntry(workspacePath, entryId, entryName, expectedKind)
      if (result.renamed) {
        log('info', 'project_entry_renamed', { kind: expectedKind })
        projectFileIndex.invalidate(workspacePath)
      }
      return result
    }],
    ['files:duplicate', async (event, entryId, expectedKind) => {
      assertTrustedSender(event)
      const workspacePath = requireActiveWorkspace()
      const result = await duplicateProjectEntry(workspacePath, entryId, expectedKind)
      log('info', 'project_entry_duplicated', { kind: expectedKind })
      projectFileIndex.invalidate(workspacePath)
      return result
    }],
    ['files:trash', async (event, entryId, expectedKind) => {
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
    ['files:save', (event, fileId, content, options) => {
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
