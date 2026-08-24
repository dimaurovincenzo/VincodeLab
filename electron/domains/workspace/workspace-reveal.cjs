async function revealWorkspace(workspacePath, { openPath }) {
  const failure = await openPath(workspacePath)
  if (!failure) return { revealed: true }

  const error = new Error(String(failure))
  error.code = 'WORKSPACE_REVEAL_FAILED'
  throw error
}

module.exports = { revealWorkspace }
