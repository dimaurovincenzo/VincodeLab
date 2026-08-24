function createRemoteRuntime({
  chooseDestination,
  chooseFiles,
  createManagedSshService,
  createRemoteFileIo,
  createRemoteFileService,
  createRemoteFileStore,
  createSftpService,
  getActiveWorkspacePath,
  getDataDirectory,
  getDatabase,
  getTempRoot,
  log,
  notifyTransfer,
  showItemInFolder,
  sendManagedSshStatus,
}) {
  let managedSsh
  let remoteFileService
  let remoteFileStore
  let sftpService

  function getManagedSsh() {
    if (!managedSsh) {
      managedSsh = createManagedSshService({
        tempRoot: getTempRoot(),
        sendStatus: sendManagedSshStatus,
        log,
      })
    }
    return managedSsh
  }

  function requireManagedConnection(connectionId) {
    const workspacePath = getActiveWorkspacePath()
    if (!workspacePath) throw new Error('Apri prima un workspace.')
    const connection = getManagedSsh().get(connectionId)
    if (!connection || connection.workspacePath !== workspacePath) {
      throw new Error('Connessione SSH non disponibile per questo workspace.')
    }
    return connection
  }

  function getRemoteFileService() {
    if (!remoteFileService) {
      sftpService ??= createSftpService({})
      remoteFileStore ??= createRemoteFileStore({ dataRoot: getDataDirectory(), database: getDatabase(), log })
      remoteFileService = createRemoteFileService({
        ssh: getManagedSsh(),
        sftp: sftpService,
        store: remoteFileStore,
        tempRoot: getTempRoot(),
        chooseFiles,
        chooseDestination,
        createFileIo: createRemoteFileIo,
        showItemInFolder,
        log,
        notify: notifyTransfer,
      })
    }
    return remoteFileService
  }

  function getSftpService() {
    return sftpService
  }

  function openWorkspace(workspacePath) {
    remoteFileService?.openWorkspace(workspacePath)
  }

  async function closeWorkspace(workspacePath, withDeadline) {
    if (remoteFileService) await withDeadline(remoteFileService.closeWorkspace(workspacePath), 7_000, 'remote-files')
    else if (sftpService) await withDeadline(sftpService.closeWorkspace(workspacePath), 6_000, 'sftp')
    // Il ControlMaster resta disponibile finché la coda SFTP non è stata drenata.
    if (managedSsh) await withDeadline(managedSsh.closeWorkspace(workspacePath), 6_000, 'managed-ssh')
  }

  async function closeAll(withDeadline) {
    if (remoteFileService) await withDeadline(remoteFileService.closeAll(), 8_000, 'remote-files')
    else if (sftpService) await withDeadline(sftpService.closeAll(), 7_000, 'sftp')
    if (managedSsh) await withDeadline(managedSsh.closeAll(), 7_000, 'managed-ssh')
  }

  return Object.freeze({
    closeAll,
    closeWorkspace,
    getManagedSsh,
    getRemoteFileService,
    getSftpService,
    openWorkspace,
    requireManagedConnection,
  })
}

module.exports = { createRemoteRuntime }
