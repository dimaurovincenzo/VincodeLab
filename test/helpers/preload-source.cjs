const fs = require('node:fs')
const path = require('node:path')

const CANONICAL_PRELOAD_MODULES = Object.freeze([
  'index.cjs',
  'public-error-restorer.cjs',
  'ipc-renderer.cjs',
  'bridges/benchmark.bridge.cjs',
  'bridges/core.bridge.cjs',
  'bridges/developer-tools.bridge.cjs',
  'bridges/github-remote.bridge.cjs',
  'bridges/data.bridge.cjs',
  'bridges/terminal.bridge.cjs',
])

function readCanonicalPreloadSource() {
  const preloadRoot = path.join(__dirname, '../../electron/preload')
  return CANONICAL_PRELOAD_MODULES
    .map((moduleId) => fs.readFileSync(path.join(preloadRoot, ...moduleId.split('/')), 'utf8'))
    .join('\n')
}

module.exports = { CANONICAL_PRELOAD_MODULES, readCanonicalPreloadSource }
