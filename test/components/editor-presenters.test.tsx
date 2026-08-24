import { describe, expect, it } from 'vitest'
import { fileIconFor, folderIconFor, gitFileStatusLabel } from '@/features/editor/components/editor-icons'
import { languageForFile } from '@/features/editor/model/editor-language'

describe('presentazione Editor estratta', () => {
  it('mantiene la semantica Git per file non tracciati e modifiche su due aree', () => {
    expect(gitFileStatusLabel({ index: '?', path: 'nuovo.ts', workingTree: '?' })).toEqual({
      code: '?',
      description: 'Git — file non tracciato',
    })
    expect(gitFileStatusLabel({ index: 'A', path: 'src/app.ts', workingTree: 'M' })).toEqual({
      code: 'A/M',
      description: 'Git — staging: A · workspace: M',
    })
  })

  it('risolve icone note senza inventare un fallback per file sconosciuti', () => {
    expect(fileIconFor('README.md')).toBeTruthy()
    expect(fileIconFor('PACKAGE.JSON')).toBeTruthy()
    expect(fileIconFor('file.estensione-sconosciuta')).toBeNull()
    expect(folderIconFor('src')).toBeTruthy()
    expect(folderIconFor('cartella-sconosciuta')).toBeNull()
  })

  it('mantiene il mapping CodeMirror e lascia neutri i formati non supportati', () => {
    for (const fileName of ['app.tsx', 'config.yaml', 'script.sh', 'query.sql', 'tool.py']) {
      expect(languageForFile(fileName)).not.toEqual([])
    }
    expect(languageForFile('archive.bin')).toEqual([])
  })
})
