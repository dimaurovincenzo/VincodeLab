import { runShellLifecycleScenario } from './lib/architecture-soak/shell-lifecycle.scenario.mjs'
import { runSqliteWorkerScenario } from './lib/architecture-soak/sqlite-worker.scenario.mjs'
import { runTerminalStreamScenario } from './lib/architecture-soak/terminal-stream.scenario.mjs'
import { runUpdateConcurrencyScenario } from './lib/architecture-soak/update-concurrency.scenario.mjs'
import { runWorkspacePersistenceScenario } from './lib/architecture-soak/workspace-persistence.scenario.mjs'

export {
  runShellLifecycleScenario,
  runSqliteWorkerScenario,
  runTerminalStreamScenario,
  runUpdateConcurrencyScenario,
  runWorkspacePersistenceScenario,
}

export const ARCHITECTURE_SCENARIOS = Object.freeze({
  terminal_stream: runTerminalStreamScenario,
  shell_lifecycle: runShellLifecycleScenario,
  sqlite_worker: runSqliteWorkerScenario,
  update_concurrency: runUpdateConcurrencyScenario,
  workspace_persistence: runWorkspacePersistenceScenario,
})

export async function runArchitectureScenario(name, config) {
  const scenario = ARCHITECTURE_SCENARIOS[name]
  if (!scenario) throw new Error('Scenario architetturale non valido.')
  return scenario(config)
}
