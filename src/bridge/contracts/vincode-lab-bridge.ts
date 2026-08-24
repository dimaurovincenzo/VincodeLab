import type { PiApi } from './ai-terminal.types'
import type { AppearanceApi } from './appearance.types'
import type { AppMenuApi } from './app-menu.types'
import type { BenchmarkApi } from './benchmark.types'
import type { ContextMenuApi } from './context-menu.types'
import type { DatabaseApi } from './database.types'
import type { FilesApi } from './files.types'
import type { GitHubApi } from './github.types'
import type { LifecycleApi } from './lifecycle.types'
import type { ManagedSshApi } from './managed-ssh.types'
import type { PiConfigApi } from './pi-config.types'
import type { PreferencesApi } from './preferences.types'
import type { InstructionsApi, PiSystemApi, ProjectSkillsApi, SystemSkillsApi } from './project-resources.types'
import type { RedisApi } from './redis.types'
import type { RemoteFilesApi } from './remote-files.types'
import type { RuntimeCapabilitiesApi } from './runtime-capabilities.types'
import type { ShellSessionsApi } from './shell-sessions.types'
import type { TerminalApi } from './terminal.types'
import type { UpdatesApi } from './updates.types'
import type { VolatileDraftsApi } from './volatile-drafts.types'
import type { WorkspaceCommandsApi } from './workspace-commands.types'
import type { WorkspaceSessionApi } from './workspace-session.types'
import type { WorkspaceApi } from './workspace.types'

export type VincodeLabBridge = {
  benchmark?: BenchmarkApi
  lifecycle: LifecycleApi
  appMenu: AppMenuApi
  contextMenu: ContextMenuApi
  workspace: WorkspaceApi
  workspaceSession: WorkspaceSessionApi
  volatileDrafts: VolatileDraftsApi
  appearance: AppearanceApi
  preferences: PreferencesApi
  updates: UpdatesApi
  files: FilesApi
  instructions: InstructionsApi
  skills: ProjectSkillsApi
  pi: PiApi
  systemSkills: SystemSkillsApi
  runtime: RuntimeCapabilitiesApi
  piSystem: PiSystemApi
  piConfig: PiConfigApi
  github: GitHubApi
  workspaceCommands: WorkspaceCommandsApi
  managedSsh: ManagedSshApi
  remoteFiles: RemoteFilesApi
  database: DatabaseApi
  redis: RedisApi
  shellSessions: ShellSessionsApi
  terminal: TerminalApi
}
