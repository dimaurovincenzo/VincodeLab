import type { VolatileDraftIdentity } from '@/lib/volatile-draft-store'
import type { PackageSource } from './settings.types'

export const defaultPiConfigDimensions = Object.freeze({ cols: 120, rows: 34 })

export const preferenceSectionLabels: Record<AppPreferenceDefinition['section'], string> = {
  editor: 'Editor',
  terminal: 'Terminale',
  git: 'Git',
  database: 'Database',
}

export const preferenceEnumLabels: Record<string, string> = {
  'system-mono': 'Monospace di sistema',
  menlo: 'Menlo',
  monaco: 'Monaco',
  bar: 'Barra',
  block: 'Blocco',
  underline: 'Sottolineato',
}

export const packageSourceCopy: Record<PackageSource, { placeholder: string; help: string }> = {
  npm: { placeholder: '@autore/pacchetto oppure pacchetto', help: 'Installazione dal catalogo npm di Pi.' },
  git: { placeholder: 'git:github.com/autore/repository oppure URL Git', help: 'Repository Git, con ref opzionale.' },
  local: { placeholder: '/percorso/al/pacchetto', help: 'Pacchetto gia presente sul computer.' },
}

export function normalizePackageSource(kind: PackageSource, value: string) {
  const source = value.trim()
  return kind === 'npm' && !source.startsWith('npm:') ? `npm:${source}` : source
}

export function systemSkillDraftIdentity(skillId: string): VolatileDraftIdentity {
  return { scope: 'settings-system-skill', workspace: 'global', resource: skillId }
}

export function packageSourceDraftIdentity(source: PackageSource): VolatileDraftIdentity {
  return { scope: 'settings-package-source', workspace: 'global', resource: source }
}

export const newSystemSkillDraftIdentity: VolatileDraftIdentity = {
  scope: 'settings-new-skill',
  workspace: 'global',
  resource: 'name',
}

export function isPackageSource(value: string | undefined): value is PackageSource {
  return value === 'npm' || value === 'git' || value === 'local'
}
