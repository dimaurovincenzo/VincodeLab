const fs = require('node:fs')
const path = require('node:path')

const { expandIpcChannelConstants } = require('./ipc-source.cjs')

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
  '../ipc/channels.cjs',
])

function readCanonicalPreloadSource() {
  const preloadRoot = path.join(__dirname, '../../electron/preload')
  const source = CANONICAL_PRELOAD_MODULES
    .map((moduleId) => fs.readFileSync(path.join(preloadRoot, ...moduleId.split('/')), 'utf8'))
    .join('\n')
  return expandIpcChannelConstants(source)
    .replace(/^const \{ IPC_CHANNELS \} = require\(['"]\.\.\/\.\.\/ipc\/channels\.cjs['"]\)\n\n/gmu, '')
}

module.exports = { CANONICAL_PRELOAD_MODULES, readCanonicalPreloadSource }
