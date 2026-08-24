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
    assert.ok(problems.some((problem) => problem.includes('preload dipende')))
  })
})

test('rileva cicli tra moduli interni', () => {
  withFixture({
    'src/shared/a.ts': "import { b } from './b'\nexport const a = b\n",
    'src/shared/b.ts': "import { a } from './a'\nexport const b = a\n",
  }, (problems) => assert.ok(problems.some((problem) => problem.includes('ciclo di dipendenze'))))
})
