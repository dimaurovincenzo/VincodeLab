import { describe, expect, it } from 'vitest'
import {
  defaultPiConfigDimensions,
  isPackageSource,
  newSystemSkillDraftIdentity,
  normalizePackageSource,
  packageSourceCopy,
  packageSourceDraftIdentity,
  preferenceEnumLabels,
  preferenceSectionLabels,
  systemSkillDraftIdentity,
} from '@/features/settings'

describe('settings model', () => {
  it('normalizza le sorgenti dei pacchetti senza alterare Git e percorsi locali', () => {
    expect(normalizePackageSource('npm', '  @autore/pacchetto  ')).toBe('npm:@autore/pacchetto')
    expect(normalizePackageSource('npm', 'npm:pacchetto')).toBe('npm:pacchetto')
    expect(normalizePackageSource('git', '  git:github.com/autore/repository  ')).toBe('git:github.com/autore/repository')
    expect(normalizePackageSource('local', '  /tmp/pacchetto  ')).toBe('/tmp/pacchetto')
  })

  it('riconosce soltanto le sorgenti supportate', () => {
    expect(isPackageSource('npm')).toBe(true)
    expect(isPackageSource('git')).toBe(true)
    expect(isPackageSource('local')).toBe(true)
    expect(isPackageSource('registry')).toBe(false)
    expect(isPackageSource(undefined)).toBe(false)
  })

  it('produce identita di draft stabili e separate per risorsa', () => {
    expect(systemSkillDraftIdentity('skill-a')).toEqual({
      scope: 'settings-system-skill',
      workspace: 'global',
      resource: 'skill-a',
    })
    expect(packageSourceDraftIdentity('git')).toEqual({
      scope: 'settings-package-source',
      workspace: 'global',
      resource: 'git',
    })
    expect(newSystemSkillDraftIdentity).toEqual({
      scope: 'settings-new-skill',
      workspace: 'global',
      resource: 'name',
    })
  })

  it('mantiene centralizzati i valori e i testi del dominio', () => {
    expect(defaultPiConfigDimensions).toEqual({ cols: 120, rows: 34 })
    expect(Object.isFrozen(defaultPiConfigDimensions)).toBe(true)
    expect(preferenceSectionLabels.database).toBe('Database')
    expect(preferenceEnumLabels.underline).toBe('Sottolineato')
    expect(packageSourceCopy.npm.placeholder).toContain('pacchetto')
  })
})
