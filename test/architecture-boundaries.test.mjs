import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { inspectArchitecture } from '../scripts/lib/architecture-check.mjs'

function withFixture(files, assertion) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vincodelab-architecture-'))
  try {
    for (const [file, source] of Object.entries(files)) {
      const target = path.join(root, file)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, source)
    }
    assertion(inspectArchitecture({ root }))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('accetta feature isolate che dipendono da bridge e shared', () => {
  withFixture({
    'src/bridge/index.ts': 'export const bridge = {}\n',
    'src/shared/utils/id.ts': 'export const id = (value) => value\n',
    'src/features/editor/index.ts': "export { open } from './model/open'\n",
    'src/features/editor/model/open.ts': "import { bridge } from '@/bridge'\nimport { id } from '@/shared/utils/id'\nexport const open = () => id(bridge)\n",
  }, (problems) => assert.deepEqual(problems, []))
})

test('blocca import profondi tra feature', () => {
  withFixture({
    'src/features/editor/model/open.ts': "import { query } from '@/features/database/model/query'\nexport const open = query\n",
    'src/features/database/model/query.ts': 'export const query = {}\n',
  }, (problems) => assert.ok(problems.some((problem) => problem.includes('import profondo'))))
})

test('obbliga ogni consumer esterno a usare gli ingressi pubblici di feature, UI e bridge', () => {
  withFixture({
    'src/app/shell.ts': [
      "import { query } from '@/features/database/model/query'",
      "import { Button } from '@/components/ui/button'",
      "import { getBridge } from '@/bridge/electron/get-bridge'",
      'export { Button, getBridge, query }',
    ].join('\n'),
    'src/features/database/model/query.ts': 'export const query = {}\n',
    'src/components/ui/button.tsx': 'export const Button = {}\n',
    'src/bridge/electron/get-bridge.ts': 'export const getBridge = () => ({})\n',
  }, (problems) => {
    assert.ok(problems.some((problem) => problem.includes('verso feature "database"')))
    assert.ok(problems.some((problem) => problem.includes('import profondo nel design system')))
    assert.ok(problems.some((problem) => problem.includes('import profondo nel bridge renderer')))
  })
})

test('mantiene feature, componenti condivisi e tema indipendenti dalla composition root', () => {
  withFixture({
    'src/app/index.ts': 'export const app = {}\n',
    'src/features/database/index.ts': 'export const database = {}\n',
    'src/features/editor/model/open.ts': "import { app } from '@/app'\nexport const open = app\n",
    'src/components/shared-panel.tsx': "import { database } from '@/features/database'\nexport const panel = database\n",
    'src/theme/tokens.ts': "import { database } from '@/features/database'\nexport const tokens = database\n",
  }, (problems) => {
    assert.ok(problems.some((problem) => problem.includes('composition root renderer')))
    assert.ok(problems.some((problem) => problem.includes('componente condiviso dipende')))
    assert.ok(problems.some((problem) => problem.includes('tema dipende')))
  })
})

test('blocca dipendenze applicative in shared e accessi diretti al preload', () => {
  withFixture({
    'src/features/editor/index.ts': 'export const editor = {}\n',
    'src/shared/utils/editor.ts': "import { editor } from '@/features/editor'\nexport { editor }\n",
    'src/features/database/api/database.ts': 'export const load = () => window.vincodeLab.database.listConnections()\n',
  }, (problems) => {
    assert.ok(problems.some((problem) => problem.includes('shared dipende')))
    assert.ok(problems.some((problem) => problem.includes('window.vincodeLab')))
  })
})

test('riconosce accessi al preload anche dietro cast e bracket notation', () => {
  withFixture({
    'src/features/database/api/database.ts': `
      const cast = (window as unknown as { vincodeLab: unknown }).vincodeLab
      const bracket = window['vincodeLab']
      export { bracket, cast }
    `,
  }, (problems) => assert.ok(problems.some((problem) => problem.includes('2 accessi diretti'))))
})

test('blocca dipendenze renderer verso Electron e adapter backend verso livelli interni errati', () => {
  withFixture({
    'src/features/editor/model/open.ts': "import { native } from '../../../../electron/main'\nexport const open = native\n",
    'electron/main.cjs': 'exports.native = {}\n',
    'electron/domains/files/read.cjs': "require('../../infrastructure/filesystem/read.cjs')\n",
    'electron/infrastructure/filesystem/read.cjs': 'module.exports = {}\n',
    'electron/preload/domains/files.cjs': "require('../../domains/files/read.cjs')\n",
  }, (problems) => {
    assert.ok(problems.some((problem) => problem.includes('renderer dipende direttamente')))
    assert.ok(problems.some((problem) => problem.includes('dominio Electron dipende')))
    assert.ok(problems.some((problem) => problem.includes('preload esce dal proprio confine')))
  })
})

test('isola application, infrastructure, IPC e preload nel backend', () => {
  withFixture({
    'electron/app/runtime.cjs': "require('../infrastructure/filesystem/read.cjs')\n",
    'electron/infrastructure/filesystem/read.cjs': "require('../../ipc/domains/filesystem.ipc.cjs')\n",
    'electron/ipc/domains/filesystem.ipc.cjs': 'module.exports = {}\n',
    'electron/preload/index.cjs': "require('../domains/errors/public-error.cjs')\n",
    'electron/domains/errors/public-error.cjs': 'module.exports = {}\n',
    'electron/domains/files/read.cjs': "require('../../main.cjs')\n",
    'electron/main.cjs': 'module.exports = {}\n',
  }, (problems) => {
    assert.ok(problems.some((problem) => problem.includes('application layer Electron dipende')))
    assert.ok(problems.some((problem) => problem.includes('infrastruttura Electron dipende')))
    assert.ok(problems.some((problem) => problem.includes('preload esce dal proprio confine')))
    assert.ok(problems.some((problem) => problem.includes('composition root Electron')))
  })
})

test('consente al preload di leggere il registro IPC ma vieta stringhe canale locali', () => {
  withFixture({
    'electron/ipc/channels.cjs': "module.exports = { IPC_CHANNELS: { FILES_READ: 'files:read' } }\n",
    'electron/preload/bridge.cjs': "const { IPC_CHANNELS } = require('../ipc/channels.cjs')\nmodule.exports = IPC_CHANNELS.FILES_READ\n",
  }, (problems) => assert.deepEqual(problems, []))

  withFixture({
    'electron/ipc/domains/filesystem.ipc.cjs': "const handlers = new Map([['files:read', () => null]])\nmodule.exports = handlers\n",
    'electron/preload/bridge.cjs': "module.exports = (ipcRenderer) => ipcRenderer.invoke('files:read')\n",
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('stringa canale IPC')).length, 2)
  })
})

test('tratta il registro IPC come contratto puro e vieta duplicati in ogni layer Electron', () => {
  withFixture({
    'electron/ipc/channels.cjs': "module.exports = { IPC_CHANNELS: { TERMINAL_OUTPUT: 'terminal:output' } }\n",
    'electron/app/runtime.cjs': "const { IPC_CHANNELS } = require('../ipc/channels.cjs')\nmodule.exports = IPC_CHANNELS.TERMINAL_OUTPUT\n",
    'electron/domains/terminal/runtime.cjs': "const { IPC_CHANNELS } = require('../../ipc/channels.cjs')\nmodule.exports = IPC_CHANNELS.TERMINAL_OUTPUT\n",
    'electron/infrastructure/ipc/sender.cjs': "const { IPC_CHANNELS } = require('../../ipc/channels.cjs')\nmodule.exports = IPC_CHANNELS.TERMINAL_OUTPUT\n",
  }, (problems) => assert.deepEqual(problems, []))

  withFixture({
    'electron/domains/errors/map.cjs': "module.exports = { 'terminal:output': 'duplicate' }\n",
  }, (problems) => assert.ok(problems.some((problem) => problem.includes('stringa canale IPC'))))
})

test('impedisce import e ricreazione dei path legacy rimossi', () => {
  withFixture({
    'src/main.tsx': "import App from './App'\nexport { App }\n",
    'src/components/project-editor.tsx': 'export const ProjectEditor = {}\n',
    'electron/domains/github/service.cjs': "module.exports = require('../../github-service.cjs')\n",
    'electron/managed-ssh-service.cjs': 'module.exports = {}\n',
    'electron/remote-file-store.cjs': 'module.exports = {}\n',
    'electron/runtime.cjs': "module.exports = require('./shell-session-manager.cjs')\n",
    'electron/sftp-service.cjs': 'module.exports = {}\n',
  }, (problems) => {
    assert.ok(problems.some((problem) => problem.includes('path legacy "src/App" rimosso; usa "src/app"')))
    assert.ok(problems.some((problem) => problem.includes('path legacy "electron/github-service" rimosso')))
    assert.ok(problems.some((problem) => problem.includes('path legacy "electron/shell-session-manager" rimosso')))
    assert.ok(problems.some((problem) => problem.includes('electron/managed-ssh-service.cjs: path legacy rimosso ricreato')))
    assert.ok(problems.some((problem) => problem.includes('electron/remote-file-store.cjs: path legacy rimosso ricreato')))
    assert.ok(problems.some((problem) => problem.includes('electron/sftp-service.cjs: path legacy rimosso ricreato')))
    assert.ok(problems.some((problem) => problem.includes('src/components/project-editor.tsx: path legacy rimosso ricreato')))
  })
})

test('impedisce al runtime AI di tornare nella composition root renderer', () => {
  withFixture({
    'src/app/components/ai-workbench.tsx': 'export const AiWorkbench = {}\n',
    'src/app/hooks/use-ai-failure.ts': 'export const useAiFailure = () => ({})\n',
    'src/app/hooks/use-ai-terminal-runtime.ts': 'export const useAiTerminalRuntime = () => ({})\n',
  }, (problems) => {
    assert.ok(problems.some((problem) => problem.includes('src/app/components/ai-workbench.tsx: path legacy rimosso ricreato; usa "src/features/ai"')))
    assert.ok(problems.some((problem) => problem.includes('src/app/hooks/use-ai-failure.ts: path legacy rimosso ricreato; usa "src/features/ai"')))
    assert.ok(problems.some((problem) => problem.includes('src/app/hooks/use-ai-terminal-runtime.ts: path legacy rimosso ricreato; usa "src/features/ai"')))
  })
})

test('rileva cicli tra moduli interni', () => {
  withFixture({
    'src/shared/a.ts': "import { b } from './b'\nexport const a = b\n",
    'src/shared/b.ts': "import { a } from './a'\nexport const b = a\n",
  }, (problems) => assert.ok(problems.some((problem) => problem.includes('ciclo di dipendenze'))))
})
