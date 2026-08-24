export type SpecialFileIconKey =
  | 'biome'
  | 'cargo'
  | 'certificate'
  | 'composer'
  | 'docker'
  | 'dotenv'
  | 'editorconfig'
  | 'license'
  | 'log'
  | 'protobuf'
  | 'python-config'
  | 'shell'
  | 'sqlite'

const EXACT_FILE_ICONS: Readonly<Record<string, SpecialFileIconKey>> = {
  '.bash_profile': 'shell',
  '.bashrc': 'shell',
  '.editorconfig': 'editorconfig',
  '.profile': 'shell',
  '.zprofile': 'shell',
  '.zshrc': 'shell',
  'biome.json': 'biome',
  'biome.jsonc': 'biome',
  'cargo.lock': 'cargo',
  'cargo.toml': 'cargo',
  'composer.json': 'composer',
  'composer.lock': 'composer',
  'pyproject.toml': 'python-config',
}

export function specialFileIconKey(fileName: string): SpecialFileIconKey | null {
  const lowerName = fileName.toLowerCase()
  const exact = EXACT_FILE_ICONS[lowerName]
  if (exact) return exact

  if (/^\.env(?:$|\.)/.test(lowerName)) return 'dotenv'
  if (/^dockerfile(?:\..+)?$/.test(lowerName) || /^(?:docker-)?compose(?:\.[^.]+)?\.ya?ml$/.test(lowerName)) return 'docker'
  if (/^(?:license|copying)(?:\..+)?$/.test(lowerName)) return 'license'
  if (/^requirements(?:[-_.].+)?\.txt$/.test(lowerName)) return 'python-config'

  const extension = lowerName.includes('.') ? lowerName.split('.').pop() ?? '' : ''
  if (['pem', 'crt', 'cer', 'p12', 'pfx', 'key'].includes(extension)) return 'certificate'
  if (extension === 'proto') return 'protobuf'
  if (['sqlite', 'sqlite3', 'db', 'db3'].includes(extension)) return 'sqlite'
  if (extension === 'log') return 'log'

  return null
}
