function createWorkspaceOperationBoundary({
  assertTrustedSender,
  externalMutations,
  getActiveWorkspacePath,
  githubOperations,
}) {
  function requireActiveWorkspace() {
    const workspacePath = getActiveWorkspacePath()
    if (!workspacePath) throw new Error('Apri prima un workspace.')
    return workspacePath
  }

  function runExternalMutation(event, type, workspacePath, operation) {
    assertTrustedSender(event)
    return externalMutations.run({ ownerId: event.sender.id, workspacePath, type }, operation)
  }

  function runWorkspaceMutation(event, type, operation) {
    assertTrustedSender(event)
    const workspacePath = requireActiveWorkspace()
    return externalMutations.run(
      { ownerId: event.sender.id, workspacePath, type },
      () => operation(workspacePath),
    )
  }

  function assertCacheReadOptions(options) {
    if (options === undefined) return { force: false }
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || (options.force !== undefined && typeof options.force !== 'boolean')) {
      throw new Error('Opzioni cache non valide.')
    }
    return { force: options.force === true }
  }

  async function runLatestGithubRead(event, type, load) {
    const workspacePath = requireActiveWorkspace()
    const operation = githubOperations.startLatest({ senderId: event.sender.id, workspacePath, type })
    try {
      // Serializzare il ricambio evita che il nuovo comando parta mentre il
      // processo superseded sta ancora completando TERM -> KILL.
      await operation.ready
      return await load(workspacePath, operation.signal)
    } finally {
      operation.finish()
    }
  }

  return Object.freeze({
    assertCacheReadOptions,
    requireActiveWorkspace,
    runExternalMutation,
    runLatestGithubRead,
    runWorkspaceMutation,
  })
}

module.exports = { createWorkspaceOperationBoundary }
