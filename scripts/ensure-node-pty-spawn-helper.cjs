const fs = require('node:fs')
const path = require('node:path')

const DARWIN_HELPER_RELATIVE_PATHS = Object.freeze([
  path.join('node_modules', 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper'),
  path.join('node_modules', 'node-pty', 'prebuilds', 'darwin-x64', 'spawn-helper'),
])
const NODE_PTY_HELPER_RELATIVE_PATHS = Object.freeze([
  path.join('node_modules', 'node-pty', 'build', 'Release', 'spawn-helper'),
  path.join('node_modules', 'node-pty', 'build', 'Debug', 'spawn-helper'),
  ...DARWIN_HELPER_RELATIVE_PATHS,
])

function octalMode(mode) {
  return (mode & 0o777).toString(8).padStart(3, '0')
}

function helperError(helperPath, action, error) {
  const detail = error instanceof Error ? error.message : String(error)
  const code = error && typeof error === 'object' && 'code' in error ? ` (${error.code})` : ''
  return new Error(`Impossibile ${action} node-pty spawn-helper "${helperPath}"${code}: ${detail}`, { cause: error })
}

function ensureNodePtySpawnHelpers(projectRoot = path.resolve(__dirname, '..'), { strict = false } = {}) {
  const helpers = []

  for (const relativePath of NODE_PTY_HELPER_RELATIVE_PATHS) {
    const helperPath = path.join(projectRoot, relativePath)
    let stats
    try {
      stats = fs.lstatSync(helperPath)
    } catch (error) {
      if (error && typeof error === 'object' && error.code === 'ENOENT') continue
      throw helperError(helperPath, 'ispezionare', error)
    }

    if (!stats.isFile()) {
      throw new Error(`Impossibile correggere node-pty spawn-helper "${helperPath}": il percorso non è un file regolare.`)
    }

    const modeBefore = stats.mode & 0o777
    const expectedMode = modeBefore | 0o111
    const changed = expectedMode !== modeBefore

    if (changed) {
      try {
        fs.chmodSync(helperPath, expectedMode)
      } catch (error) {
        throw helperError(helperPath, `impostare i permessi eseguibili da ${octalMode(modeBefore)} a ${octalMode(expectedMode)} per`, error)
      }
    }

    let modeAfter
    try {
      modeAfter = fs.lstatSync(helperPath).mode & 0o777
    } catch (error) {
      throw helperError(helperPath, 'verificare', error)
    }
    if ((modeAfter & 0o111) !== 0o111) {
      throw new Error(`Permessi node-pty spawn-helper non validi per "${helperPath}": atteso un file eseguibile, trovato ${octalMode(modeAfter)}.`)
    }
    try {
      fs.accessSync(helperPath, fs.constants.X_OK)
    } catch (error) {
      throw helperError(helperPath, 'verificare l’eseguibilità di', error)
    }

    helpers.push({ changed, modeAfter, modeBefore, path: helperPath })
  }

  if (strict && helpers.length === 0) {
    throw new Error(`Nessun node-pty spawn-helper trovato sotto "${projectRoot}"; il bundle Darwin non potrebbe avviare PTY.`)
  }

  return {
    changed: helpers.filter((helper) => helper.changed).length,
    found: helpers.length,
    helpers,
  }
}

function reportResult(result, context = '') {
  const prefix = context ? `[node-pty:${context}]` : '[node-pty]'
  if (result.found === 0) {
    console.log(`${prefix} Nessun Darwin spawn-helper presente; controllo ignorato.`)
    return
  }
  if (result.changed === 0) {
    console.log(`${prefix} ${result.found} Darwin spawn-helper già eseguibili.`)
    return
  }
  console.log(`${prefix} Corretti i permessi di ${result.changed}/${result.found} Darwin spawn-helper.`)
}

function afterPack(context) {
  if (context?.electronPlatformName !== 'darwin') return
  const productFilename = context.packager?.appInfo?.productFilename
  if (!context.appOutDir || !productFilename) throw new Error('Contesto afterPack non valido per la verifica node-pty Darwin.')

  const appBundle = context.appOutDir.endsWith('.app')
    ? context.appOutDir
    : path.join(context.appOutDir, `${productFilename}.app`)
  const unpackedRoot = path.join(appBundle, 'Contents', 'Resources', 'app.asar.unpacked')
  reportResult(ensureNodePtySpawnHelpers(unpackedRoot, { strict: true }), 'afterPack')
}

function run() {
  reportResult(ensureNodePtySpawnHelpers())
}

if (require.main === module) {
  try {
    run()
  } catch (error) {
    console.error(`[node-pty] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

module.exports = {
  DARWIN_HELPER_RELATIVE_PATHS,
  NODE_PTY_HELPER_RELATIVE_PATHS,
  default: afterPack,
  ensureNodePtySpawnHelpers,
}
