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

test('richiede index.ts per ogni directory feature immediata', () => {
  withFixture({
    'src/features/editor/model/open.ts': 'export const open = () => undefined\n',
  }, (problems) => {
    assert.ok(problems.some((problem) => problem.includes("src/features/editor: manca l'ingresso pubblico index.ts")))
  })
})

test('rifiuta un index.ts feature privo di export pubblici', () => {
  withFixture({
    'src/features/editor/index.ts': 'const internalOnly = true\nexport {}\n',
  }, (problems) => {
    assert.ok(problems.some((problem) => problem.includes('src/features/editor/index.ts: l\'ingresso pubblico non espone alcun export')))
  })
})

test('accetta un index.ts feature con soli export type', () => {
  withFixture({
    'src/features/editor/index.ts': "export type { EditorContext } from './model/editor-context'\n",
    'src/features/editor/model/editor-context.ts': 'export type EditorContext = { path: string }\n',
  }, (problems) => assert.deepEqual(problems, []))
})

test('blocca import profondi tra feature', () => {
  withFixture({
    'src/features/editor/model/open.ts': "import { query } from '@/features/database/model/query'\nexport const open = query\n",
    'src/features/database/model/query.ts': 'export const query = {}\n',
  }, (problems) => assert.ok(problems.some((problem) => problem.includes('import profondo'))))
})

test('analizza anche le dipendenze espresse con ImportTypeNode TypeScript', () => {
  withFixture({
    'src/app/query.types.ts': "export type Query = import('../features/database/model/query').Query\n",
    'src/features/database/model/query.ts': 'export type Query = { sql: string }\n',
    'src/bridge/contracts/redis-leak.types.ts': "export type RedisApi = import('../../features/redis/model/redis-types').RedisApi\n",
    'src/features/redis/model/redis-types.ts': 'export type RedisApi = { scan(): void }\n',
  }, (problems) => {
    assert.ok(problems.some((problem) => problem.includes('src/app/query.types.ts: import profondo da modulo')))
    assert.ok(problems.some((problem) => problem.includes('src/bridge/contracts/redis-leak.types.ts: bridge dipende da UI o feature')))
  })
})

test('impedisce ai consumer di ricavare il contratto bridge da Window o da globali ambienti', () => {
  withFixture({
    'src/bridge/contracts/vincode-lab-bridge.ts': "export type VincodeLabBridge = Window['vincodeLab']\n",
    'src/vincode-lab.d.ts': [
      "type AppMenuCommand = 'workspace.open'",
      'interface Window { vincodeLab: unknown }',
    ].join('\n'),
    'test/components/bridge-consumer.types.ts': "export type Bridge = Window['vincodeLab']\n",
  }, (problems) => {
    assert.ok(problems.some((problem) => problem.includes("src/bridge/contracts/vincode-lab-bridge.ts: 1 riferimenti type-level a Window['vincodeLab']")))
    assert.ok(problems.some((problem) => problem.includes('src/vincode-lab.d.ts: contratto bridge globale "AppMenuCommand"')))
    assert.ok(problems.some((problem) => problem.includes("test/components/bridge-consumer.types.ts: 1 riferimenti type-level a Window['vincodeLab']")))
  })
})

test('obbliga l augmentazione Window a importare VincodeLabBridge dal public entry', () => {
  withFixture({
    'src/bridge/index.ts': "export type { VincodeLabBridge } from './contracts/vincode-lab-bridge'\n",
    'src/bridge/contracts/vincode-lab-bridge.ts': 'export type VincodeLabBridge = { terminal: unknown }\n',
    'src/vincode-lab.d.ts': [
      "import type { VincodeLabBridge } from './bridge/contracts/vincode-lab-bridge'",
      'declare global { interface Window { vincodeLab: VincodeLabBridge } }',
      'export {}',
    ].join('\n'),
  }, (problems) => {
    assert.ok(problems.some((problem) => problem.includes('src/vincode-lab.d.ts: import profondo nel bridge renderer')))
  })
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

test('obbliga il dominio Database a usare porte invece di driver e adapter operativi', () => {
  withFixture({
    'electron/domains/database/runtime.cjs': [
      "require('pg')",
      "require('mysql2/promise')",
      "require('tedious')",
      "require('better-sqlite3')",
      "require('../../infrastructure/database/node-database-driver.adapter.cjs')",
    ].join('\n'),
    'electron/infrastructure/database/node-database-driver.adapter.cjs': 'module.exports = {}\n',
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('driver esterno')).length, 4)
    assert.ok(problems.some((problem) => problem.includes('dominio Electron dipende da un adapter esterno')))
  })
})

test('impedisce alle factory streaming dei vendor di rientrare nel dominio Database', () => {
  withFixture({
    'electron/domains/database/runtime.cjs': [
      'driverPort.createPostgresQuery()',
      'driverPort.createMssqlRequest()',
      "driverPort['addMssqlParameter']()",
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('factory driver')).length, 3)
    for (const factory of ['createPostgresQuery', 'createMssqlRequest', 'addMssqlParameter']) {
      assert.ok(problems.some((problem) => problem.includes(`factory driver "${factory}"`)))
    }
  })
})

test('impedisce alle factory di apertura vendor di rientrare nel dominio Database', () => {
  withFixture({
    'electron/domains/database/runtime.cjs': [
      'driverPort.createPostgresClient(config)',
      'driverPort.createMysqlClient(config)',
      'driverPort.createMssqlConnection(config)',
      'openMssqlConnection(config)',
      'openMssqlConnectionFromFactory(config, factory)',
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('factory apertura driver')).length, 5)
    for (const factory of ['createPostgresClient', 'createMysqlClient', 'createMssqlConnection', 'openMssqlConnection', 'openMssqlConnectionFromFactory']) {
      assert.ok(problems.some((problem) => problem.includes(`factory apertura driver "${factory}"`)))
    }
  })
})

test('impedisce ai callback transazionali dei vendor di rientrare nel dominio Database', () => {
  withFixture({
    'electron/domains/database/runtime.cjs': [
      'session.client.beginTransaction(callback)',
      'session.client.commitTransaction(callback)',
      "session.client['rollbackTransaction'](callback)",
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('metodo transazionale vendor')).length, 3)
    for (const method of ['beginTransaction', 'commitTransaction', 'rollbackTransaction']) {
      assert.ok(problems.some((problem) => problem.includes(`metodo transazionale vendor "${method}"`)))
    }
  })
})

test('impedisce al lifecycle remoto vendor di attraversare l handle opaco Database', () => {
  withFixture({
    'electron/domains/database/runtime.cjs': [
      'session.client',
      'session.connection',
      'session.stream',
      'session.socket',
      'session.end()',
      'session.close()',
      "session['destroy']()",
      // Questi close appartengono al protocollo neutrale già posseduto dal dominio.
      'session.sqlite.close()',
      'remoteSessions.close(key)',
    ].join('\n'),
  }, (problems) => {
    const lifecycleProblems = problems.filter((problem) => problem.includes('proprietà lifecycle vendor'))
    assert.equal(lifecycleProblems.length, 7)
    for (const property of ['client', 'connection', 'stream', 'socket', 'end', 'close', 'destroy']) {
      assert.ok(lifecycleProblems.some((problem) => problem.includes(`proprietà lifecycle vendor "${property}"`)))
    }
  })
})

test('obbliga il dominio Shell a usare collaboratori invece di filesystem e PTY operativi', () => {
  withFixture({
    'electron/domains/shell/runtime.cjs': [
      "require('node:fs')",
      "require('node-pty')",
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('dominio Shell dipende direttamente')).length, 2)
  })
})

test('obbliga il dominio AI a usare adapter iniettati per i processi host', () => {
  withFixture({
    'electron/domains/ai/pi-runtime.cjs': [
      "require('node:child_process')",
      "require('child_process')",
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('dominio AI dipende direttamente')).length, 2)
  })
})

test('mantiene filesystem e risoluzione path fuori dal caso d’uso Istruzioni progetto', () => {
  withFixture({
    'electron/domains/ai/project-instructions.cjs': [
      "require('node:fs')",
      "require('node:path')",
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('dominio Istruzioni progetto')).length, 2)
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:fs"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:path"')))
  })
})

test('mantiene filesystem e risoluzione path fuori dal dominio Skill progetto e dalla sua porta', () => {
  withFixture({
    'electron/domains/ai/project-skills.cjs': [
      "require('node:fs')",
      "require('node:path')",
      "require('../filesystem/file-utils.cjs')",
    ].join('\n'),
    'electron/domains/ai/project-skills-storage.port.cjs': "require('node:fs/promises')\n",
    'electron/domains/filesystem/file-utils.cjs': 'module.exports = {}\n',
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('dominio Skill progetto dipende direttamente dal filesystem host')).length, 2)
    assert.equal(problems.filter((problem) => problem.includes('dominio Porta Skill progetto')).length, 1)
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:fs"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:path"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:fs/promises"')))
    assert.ok(problems.some((problem) => problem.includes('path legacy "electron/domains/filesystem/file-utils" rimosso')))
  })
})

test('mantiene filesystem e helper concreti fuori dal dominio Skill di sistema', () => {
  withFixture({
    'electron/domains/ai/system-skills.cjs': [
      "require('node:fs')",
      "require('node:path')",
      "require('../filesystem/file-utils.cjs')",
    ].join('\n'),
    'electron/domains/ai/system-skills-storage.port.cjs': "require('fs/promises')\n",
    'electron/domains/filesystem/file-utils.cjs': 'module.exports = {}\n',
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('dominio Skill di sistema dipende direttamente dal filesystem host')).length, 2)
    assert.equal(problems.filter((problem) => problem.includes('dominio Porta Skill di sistema')).length, 1)
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:fs"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:path"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "fs/promises"')))
    assert.ok(problems.some((problem) => problem.includes('path legacy "electron/domains/filesystem/file-utils" rimosso')))
  })
})

test('mantiene filesystem e risoluzione path fuori dal catalogo skill dei pacchetti Pi e dalla sua porta', () => {
  withFixture({
    'electron/domains/ai/pi-package-skills.cjs': [
      "require('node:fs')",
      "require('node:path')",
    ].join('\n'),
    'electron/domains/ai/pi-package-skills-source.port.cjs': [
      "require('fs/promises')",
      "require('path')",
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('dominio Catalogo skill pacchetti Pi')).length, 2)
    assert.equal(problems.filter((problem) => problem.includes('dominio Porta catalogo skill pacchetti Pi')).length, 2)
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:fs"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:path"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "fs/promises"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "path"')))
  })
})

test('mantiene filesystem e risoluzione path fuori dall Indice file progetto e dalla sua porta', () => {
  withFixture({
    'electron/domains/filesystem/project-file-index.cjs': [
      "require('node:fs')",
      "require('node:path')",
    ].join('\n'),
    'electron/domains/filesystem/project-file-index-host.port.cjs': [
      "require('fs/promises')",
      "require('path')",
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('dominio Indice file progetto')).length, 2)
    assert.equal(problems.filter((problem) => problem.includes('dominio Porta host Indice file progetto')).length, 2)
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:fs"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:path"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "fs/promises"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "path"')))
  })
})

test('mantiene filesystem e risoluzione path fuori dal listing, dalla porta e dalla policy progetto', () => {
  withFixture({
    'electron/domains/filesystem/project-directory-listing.cjs': [
      "require('node:fs')",
      "require('node:path')",
    ].join('\n'),
    'electron/domains/filesystem/project-directory-listing-host.port.cjs': [
      "require('fs/promises')",
      "require('path')",
    ].join('\n'),
    'electron/domains/filesystem/project-access-policy.cjs': [
      "require('node:fs/promises')",
      "require('node:path')",
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('dominio Elenco directory progetto')).length, 2)
    assert.equal(problems.filter((problem) => problem.includes('dominio Porta host elenco directory progetto')).length, 2)
    assert.equal(problems.filter((problem) => problem.includes('dominio Policy accesso progetto')).length, 2)
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:fs"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "fs/promises"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:fs/promises"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "path"')))
  })
})

test('mantiene filesystem host fuori dalle azioni file progetto e dalla loro porta', () => {
  withFixture({
    'electron/domains/filesystem/project-file-actions.cjs': [
      "require('node:fs')",
      "require('node:path')",
    ].join('\n'),
    'electron/domains/filesystem/project-file-actions-host.port.cjs': [
      "require('fs/promises')",
      "require('path')",
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('dominio Azioni file progetto dipende direttamente')).length, 2)
    assert.equal(problems.filter((problem) => problem.includes('dominio Porta host azioni file progetto')).length, 2)
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:fs"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "path"')))
  })
})

test('mantiene filesystem host fuori dalle mutazioni progetto e dalla loro porta', () => {
  withFixture({
    'electron/domains/filesystem/project-entry-mutations.cjs': [
      "require('node:fs')",
      "require('node:path')",
    ].join('\n'),
    'electron/domains/filesystem/project-entry-mutations-host.port.cjs': [
      "require('fs/promises')",
      "require('path')",
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('dominio Mutazioni elementi progetto dipende direttamente')).length, 2)
    assert.equal(problems.filter((problem) => problem.includes('dominio Porta host mutazioni progetto')).length, 2)
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:fs"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "path"')))
  })
})

test('mantiene filesystem host fuori da reader, porta e revisione file progetto', () => {
  withFixture({
    'electron/domains/filesystem/project-file-reader.cjs': [
      "require('node:fs')",
      "require('node:path')",
    ].join('\n'),
    'electron/domains/filesystem/project-file-reader-host.port.cjs': [
      "require('fs/promises')",
      "require('path')",
    ].join('\n'),
    'electron/domains/filesystem/project-file-revision.cjs': [
      "require('node:fs/promises')",
      "require('node:path')",
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('dominio Lettura file progetto dipende direttamente')).length, 2)
    assert.equal(problems.filter((problem) => problem.includes('dominio Porta host lettura file progetto')).length, 2)
    assert.equal(problems.filter((problem) => problem.includes('dominio Revisione file progetto')).length, 2)
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:fs"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "path"')))
  })
})

test('mantiene filesystem host fuori dal salvataggio file progetto e dalla sua porta', () => {
  withFixture({
    'electron/domains/filesystem/project-file-save.cjs': [
      "require('node:fs')",
      "require('node:path')",
    ].join('\n'),
    'electron/domains/filesystem/project-file-save-host.port.cjs': [
      "require('fs/promises')",
      "require('path')",
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('dominio Salvataggio file progetto dipende direttamente')).length, 2)
    assert.equal(problems.filter((problem) => problem.includes('dominio Porta host salvataggio file progetto')).length, 2)
    assert.ok(problems.some((problem) => problem.includes('filesystem host "node:fs"')))
    assert.ok(problems.some((problem) => problem.includes('filesystem host "path"')))
  })
})

test('estende il confine filesystem host a ogni nuovo modulo del dominio filesystem', () => {
  withFixture({
    'electron/domains/filesystem/new-owner.cjs': [
      "require('node:fs')",
      "require('node:path')",
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('dominio Filesystem progetto dipende direttamente')).length, 2)
  })
})

test('mantiene processi host ed Electron fuori dal dominio Menu', () => {
  withFixture({
    'electron/domains/menu/runtime.cjs': [
      "require('node:child_process')",
      "require('child_process')",
      "require('electron')",
    ].join('\n'),
  }, (problems) => {
    assert.equal(problems.filter((problem) => problem.includes('dominio Menu dipende direttamente')).length, 3)
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
    'electron/infrastructure/github/github-service.adapter.cjs': 'module.exports = {}\n',
    'electron/domains/ai/pi-executable.cjs': 'module.exports = {}\n',
    'electron/domains/ai/terminal-attachments.cjs': 'module.exports = {}\n',
    'electron/domains/menu/context-command-dispatcher.cjs': 'module.exports = {}\n',
    'electron/domains/filesystem/file-utils.cjs': 'module.exports = {}\n',
    'electron/domains/filesystem/project-file-content.cjs': 'module.exports = {}\n',
    'electron/domains/filesystem/project-path-model.cjs': 'module.exports = {}\n',
    'electron/managed-ssh-service.cjs': 'module.exports = {}\n',
    'electron/remote-file-store.cjs': 'module.exports = {}\n',
    'electron/runtime.cjs': "module.exports = require('./shell-session-manager.cjs')\n",
    'electron/sftp-service.cjs': 'module.exports = {}\n',
  }, (problems) => {
    assert.ok(problems.some((problem) => problem.includes('path legacy "src/App" rimosso; usa "src/app"')))
    assert.ok(problems.some((problem) => problem.includes('path legacy "electron/github-service" rimosso')))
    assert.ok(problems.some((problem) => problem.includes('electron/infrastructure/github/github-service.adapter.cjs: path legacy rimosso ricreato')))
    assert.ok(problems.some((problem) => problem.includes('electron/domains/ai/pi-executable.cjs: path legacy rimosso ricreato')))
    assert.ok(problems.some((problem) => problem.includes('electron/domains/ai/terminal-attachments.cjs: path legacy rimosso ricreato')))
    assert.ok(problems.some((problem) => problem.includes('electron/domains/menu/context-command-dispatcher.cjs: path legacy rimosso ricreato')))
    assert.ok(problems.some((problem) => problem.includes('electron/domains/filesystem/file-utils.cjs: path legacy rimosso ricreato')))
    assert.ok(problems.some((problem) => problem.includes('electron/domains/filesystem/project-file-content.cjs: path legacy rimosso ricreato')))
    assert.ok(problems.some((problem) => problem.includes('electron/domains/filesystem/project-path-model.cjs: path legacy rimosso ricreato')))
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

test('impedisce ai moduli con owner unico di tornare nei vecchi path condivisi', () => {
  withFixture({
    'src/components/remote-diff-dialog.tsx': 'export const dialog = {}\n',
    'src/components/terminal-paste-status.tsx': 'export const status = {}\n',
    'src/lib/editor-icon-resolution.ts': 'export const icon = {}\n',
    'src/lib/editor-new-file.ts': 'export const draft = {}\n',
    'src/lib/git-graph.js': 'export const graph = {}\n',
    'src/lib/github-project-status.js': 'export const status = {}\n',
    'src/lib/remote-transfer-retry.ts': 'export const retry = {}\n',
    'src/lib/shell-xterm-output-controller.ts': 'export const output = {}\n',
    'src/lib/terminal-paste-controller.d.ts': 'export declare const paste: unknown\n',
    'src/lib/workspace-command-library.js': 'export const commands = {}\n',
  }, (problems) => {
    for (const [legacyPath, owner] of [
      ['src/components/remote-diff-dialog.tsx', 'src/features/editor'],
      ['src/components/terminal-paste-status.tsx', 'src/features/ai'],
      ['src/lib/editor-icon-resolution.ts', 'src/features/editor'],
      ['src/lib/editor-new-file.ts', 'src/features/editor'],
      ['src/lib/git-graph.js', 'src/features/github'],
      ['src/lib/github-project-status.js', 'src/features/github'],
      ['src/lib/remote-transfer-retry.ts', 'src/features/remote-files'],
      ['src/lib/shell-xterm-output-controller.ts', 'src/features/terminal'],
      ['src/lib/terminal-paste-controller.d.ts', 'src/features/ai'],
      ['src/lib/workspace-command-library.js', 'src/features/terminal'],
    ]) {
      assert.ok(problems.some((problem) => problem.includes(`${legacyPath}: path legacy rimosso ricreato; usa "${owner}"`)))
    }
  })
})

test('rileva cicli tra moduli interni', () => {
  withFixture({
    'src/shared/a.ts': "import { b } from './b'\nexport const a = b\n",
    'src/shared/b.ts': "import { a } from './a'\nexport const b = a\n",
  }, (problems) => assert.ok(problems.some((problem) => problem.includes('ciclo di dipendenze'))))
})
