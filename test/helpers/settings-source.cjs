const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.join(__dirname, '../..')
const settingsSourceFiles = [
  'src/features/settings/api/settings.bridge.ts',
  'src/features/settings/components/compatibility-settings-section.tsx',
  'src/features/settings/components/general-settings-section.tsx',
  'src/features/settings/components/number-preference-input.tsx',
  'src/features/settings/components/packages-settings-section.tsx',
  'src/features/settings/components/preference-control.tsx',
  'src/features/settings/components/runtime-settings-section.tsx',
  'src/features/settings/components/settings-section-error.tsx',
  'src/features/settings/components/settings.tsx',
  'src/features/settings/components/skills-settings-section.tsx',
  'src/features/settings/components/updates-settings-section.tsx',
  'src/features/settings/hooks/use-managed-updates.ts',
  'src/features/settings/hooks/use-pi-config.ts',
  'src/features/settings/hooks/use-pi-packages.ts',
  'src/features/settings/hooks/use-settings-preferences.ts',
  'src/features/settings/hooks/use-settings-refresh.ts',
  'src/features/settings/hooks/use-settings-workspace-guard.ts',
  'src/features/settings/hooks/use-system-skills.ts',
  'src/features/settings/model/settings-model.ts',
  'src/features/settings/model/settings.types.ts',
  'src/features/settings/services/settings-error.ts',
]

function readSettingsSource() {
  return settingsSourceFiles
    .map((relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'))
    .join('\n')
}

module.exports = { readSettingsSource, settingsSourceFiles }
