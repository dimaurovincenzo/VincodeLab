import type { AiTerminalReloadResult } from './ai-terminal.types'

export interface ProjectSkillIssue {
  level: 'error' | 'warning'
  message: string
}

export interface ProjectSkill {
  id: string
  name: string
  description: string
  valid: boolean
  issues: ProjectSkillIssue[]
  content?: string
}

export interface PiPackageSkill extends Omit<ProjectSkill, 'content'> {
  source: string
  packageName: string
  relativePath: string
}

export type PiRuntimeStatus =
  | { state: 'ready'; executable: string; version: string }
  | { state: 'missing'; code: 'PI_NOT_INSTALLED'; executable: null; version: null }

export type InstructionsApi = {
  get: () => Promise<{ exists: boolean; content: string }>
  save: (content: string) => Promise<{ exists: true; content: string }>
  clear: () => Promise<{ exists: false; content: string }>
}

export type ProjectSkillsApi = {
  list: () => Promise<ProjectSkill[]>
  get: (skillId: string) => Promise<ProjectSkill>
  create: (name: string) => Promise<ProjectSkill>
  update: (skillId: string, content: string) => Promise<ProjectSkill>
  delete: (skillId: string) => Promise<{ deleted: true }>
  reload: () => Promise<AiTerminalReloadResult>
}

export type SystemSkillsApi = {
  list: () => Promise<ProjectSkill[]>
  get: (id: string) => Promise<ProjectSkill>
  create: (name: string) => Promise<ProjectSkill>
  update: (id: string, content: string) => Promise<ProjectSkill>
  delete: (id: string) => Promise<{ deleted: true }>
}

export type PiSystemApi = {
  status: () => Promise<PiRuntimeStatus>
  list: () => Promise<string[]>
  listSkills: () => Promise<PiPackageSkill[]>
  install: (source: string) => Promise<{ output: string }>
  update: (source: string) => Promise<{ output: string }>
  remove: (source: string) => Promise<{ output: string }>
}
