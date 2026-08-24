const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.join(__dirname, '../..')
const appSourceFiles = [
  'src/lib/renderer-error.ts',
  'src/features/ai/api/ai.bridge.ts',
  'src/features/ai/model/ai-runtime.types.ts',
  'src/features/ai/services/ai-error.ts',
  'src/features/ai/hooks/use-ai-failure.ts',
  'src/features/ai/hooks/use-ai-terminal-paste.ts',
  'src/features/ai/hooks/use-ai-terminal-instance.ts',
  'src/features/ai/hooks/use-ai-terminal-runtime.ts',
  'src/features/ai/hooks/use-ai-runtime.ts',
  'src/features/ai/components/lazy-ai-views.ts',
  'src/features/ai/components/ai-workbench.tsx',
  'src/features/ai/components/ai-session-error-notice.tsx',
  'src/app/components/lazy-workbench-views.ts',
  'src/app/model/app-controller.types.ts',
  'src/app/services/app-controller-errors.ts',
  'src/app/hooks/use-app-navigation.ts',
  'src/app/hooks/use-app-context-menu.ts',
  'src/app/hooks/use-app-appearance.ts',
  'src/app/hooks/use-ai-context.ts',
  'src/app/hooks/use-workspace-persistence.ts',
  'src/app/hooks/use-workspace-close-guards.ts',
  'src/app/hooks/use-workspace-lifecycle.ts',
  'src/app/hooks/use-workbench-commands.ts',
  'src/app/hooks/use-app-controller.ts',
  'src/app/App.tsx',
  'src/app/components/app-shell.tsx',
  'src/app/components/workspace-views.tsx',
  'src/app/components/standalone-views.tsx',
  'src/app/components/home-view.tsx',
]

function readAppSource() {
  return appSourceFiles
    .map((relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'))
    .join('\n')
}

module.exports = { appSourceFiles, readAppSource }
