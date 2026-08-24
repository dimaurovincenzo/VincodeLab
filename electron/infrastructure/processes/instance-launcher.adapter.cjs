const childProcess = require('node:child_process')
const path = require('node:path')

function readWorkspaceArgument(argv) {
  const positions = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--workspace') positions.push(index)
  }
  if (positions.length !== 1) return null

  const value = argv[positions[0] + 1]
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096 || !path.isAbsolute(value)) return null
  return value
}

function launchWorkspaceInstance({
  executable,
  appPath,
  packaged,
  workspacePath,
  spawn = childProcess.spawn,
  onPostLaunchError = (error) => process.emitWarning(error, { code: 'VINCODELAB_INSTANCE_PROCESS_ERROR' }),
}) {
  const args = packaged
    ? ['--workspace', workspacePath]
    : [appPath, '--workspace', workspacePath]
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { detached: true, stdio: 'ignore' })
    let launchConfirmed = false

    const handleError = (error) => {
      if (!launchConfirmed) {
        child.removeListener('spawn', handleSpawn)
        reject(error)
        return
      }

      // Dopo la conferma di spawn il chiamante può avere già ricevuto successo.
      // Conservare un observer esplicito evita sia un evento `error` non gestito
      // sia un failure silenzioso che l'interfaccia non potrebbe diagnosticare.
      try {
        onPostLaunchError(error)
      } catch (reportingError) {
        process.emitWarning(reportingError, { code: 'VINCODELAB_INSTANCE_ERROR_REPORT_FAILED' })
      }
    }

    const handleSpawn = () => {
      try {
        child.unref()
      } catch (error) {
        reject(error)
        return
      }
      launchConfirmed = true
      resolve({ launched: true })
    }

    child.on('error', handleError)
    child.once('spawn', handleSpawn)
  })
}

module.exports = { launchWorkspaceInstance, readWorkspaceArgument }
