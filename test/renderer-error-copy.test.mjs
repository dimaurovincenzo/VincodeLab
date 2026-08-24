import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { normalizeUserError, reportUserError } from '../src/lib/user-error.js'
import appSourceHelper from './helpers/app-source.cjs'
import settingsSourceHelper from './helpers/settings-source.cjs'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))
const { readAppSource } = appSourceHelper
const { readSettingsSource } = settingsSourceHelper
const components = [
  'features/ai/components/project-skills.tsx',
  'features/ai/components/project-instructions.tsx',
  'features/ai/components/terminal-diagnostics.tsx',
  'features/ai/components/terminal-attachments.tsx',
]

function componentSource(fileName) {
  const component = fs.readFileSync(path.join(testDirectory, '../src', fileName), 'utf8')
  if (fileName !== 'features/ai/components/project-skills.tsx') return component
  const controller = fs.readFileSync(path.join(testDirectory, '../src/features/ai/hooks/use-project-skills-controller.ts'), 'utf8')
  return `${component}\n${controller}`
}

test('le superfici renderer selezionate non mostrano proprieta message grezze', () => {
  const surfaces = [
    ['features/settings', readSettingsSource()],
    ...components.map((fileName) => [fileName, componentSource(fileName)]),
  ]
  for (const [surface, source] of surfaces) {
    assert.match(source, /import \{[^}]*normalizeUserError[^}]*reportUserError[^}]*\} from '@\/lib\/user-error'/su, `${surface} deve usare il contratto errori centrale`)
    assert.match(source, /normalizeUserError\(/u, `${surface} deve normalizzare gli errori`)
    assert.match(source, /reportUserError\(/u, `${surface} deve collegare correlation ID e diagnostica`)
    assert.doesNotMatch(source, /\.message\b/u, `${surface} non deve renderizzare dettagli tecnici diretti`)
    assert.doesNotMatch(source, /error instanceof Error/u, `${surface} non deve interpretare autonomamente gli errori IPC`)
  }
})

test('Settings possiede localmente gli errori e non duplica la superficie con toast', () => {
  const settings = readSettingsSource()
  assert.match(settings, /normalizeUserError\(update\.lastError, \{/u)
  assert.match(settings, /error=\{managedUpdateFailures\.get\(update\.id\)!\}/u)
  assert.match(settings, /<ErrorNotice/u)
  assert.match(settings, /<Field\.ErrorText>/u)
  assert.doesNotMatch(settings, /userErrorMessage/u)
  assert.doesNotMatch(settings, /toast\.(?:error|warning)\(/u)
  assert.doesNotMatch(settings, />\{update\.lastError\}<\/p>/u)
})

test('Pi assente usa copy specifica e apre direttamente il recovery Runtime Pi', () => {
  const app = readAppSource()
  const settings = readSettingsSource()
  assert.match(app, /classified\.code === 'PI_NOT_INSTALLED'/u)
  assert.match(app, /title: 'Pi Coding Agent non installato'/u)
  assert.match(app, /Editor, Terminale locale, GitHub, Database e Redis restano disponibili/u)
  assert.match(app, /setSettingsRuntimeRequest\(\(current\) => current \+ 1\)/u)
  assert.match(settings, /openRuntimeRequest <= 0\) return[\s\S]*?setTab\('runtime'\)/u)
})

test('normalize e report separano copy pubblico e diagnostica sanitizzata', () => {
  const publicError = new Error("Error invoking remote method 'preferences:setGlobal': Error: Impossibile salvare le impostazioni. [CONFIGURATION_SET_GLOBAL_FAILED] [ERR-8F2A1C]")
  const publicIncident = normalizeUserError(publicError, {
    component: 'settings',
    fallbackDescription: 'Le impostazioni non sono state salvate.',
    operation: 'save-preference',
  })
  assert.equal(publicIncident.description, 'Le impostazioni non sono state salvate.')
  assert.equal(publicIncident.correlationId, 'ERR-8F2A1C')
  assert.equal(publicIncident.code, undefined)

  const rawError = new Error('EACCES /Users/alice/private/settings.json token=secret')
  const rawIncident = normalizeUserError(rawError, {
    component: 'settings',
    description: 'Le impostazioni non sono state salvate. Il valore precedente è rimasto attivo.',
    operation: 'save-preference',
    title: 'Impostazione non salvata',
  })
  assert.equal(rawIncident.description, 'Le impostazioni non sono state salvate. Il valore precedente è rimasto attivo.')
  assert.doesNotMatch(rawIncident.technicalMessage, /secret|\/Users\/alice/u)
  assert.match(rawIncident.correlationId, /^ERR-[A-F0-9]{6}$/u)

  const originalConsoleError = console.error
  const logged = []
  console.error = (entry) => logged.push(String(entry))
  try {
    assert.equal(reportUserError(rawIncident), rawIncident)
  } finally {
    console.error = originalConsoleError
  }
  assert.equal(logged.length, 1)
  assert.match(logged[0], /renderer_user_error/u)
  assert.match(logged[0], new RegExp(rawIncident.correlationId, 'u'))
  assert.doesNotMatch(logged[0], /secret|\/Users\/alice/u)
})
