export { aiBridge } from './api/ai.bridge'
export { TerminalAttachments, type TerminalContextAction } from './components/terminal-attachments'
export { TerminalDiagnostics } from './components/terminal-diagnostics'

export const loadProjectInstructions = () => import('./components/project-instructions')
export const loadProjectSkills = () => import('./components/project-skills')
