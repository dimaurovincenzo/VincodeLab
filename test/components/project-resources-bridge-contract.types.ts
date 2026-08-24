import type * as Bridge from '@/bridge'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
        ? true
        : false
    : false

type Expect<Value extends true> = Value

interface ExpectedProjectSkillIssue {
  level: 'error' | 'warning'
  message: string
}

interface ExpectedProjectSkill {
  id: string
  name: string
  description: string
  valid: boolean
  issues: ExpectedProjectSkillIssue[]
  content?: string
}

interface ExpectedPiPackageSkill extends Omit<ExpectedProjectSkill, 'content'> {
  source: string
  packageName: string
  relativePath: string
}

type ExpectedPiRuntimeStatus =
  | { state: 'ready'; executable: string; version: string }
  | { state: 'missing'; code: 'PI_NOT_INSTALLED'; executable: null; version: null }

type ExpectedAiTerminalReloadResult =
  | { reloaded: true; runtime: 'pi' }
  | { reloaded: false; runtime: 'herdr'; reason: 'active-pane-ambiguous' }

type ExpectedInstructionsApi = {
  get: () => Promise<{ exists: boolean; content: string }>
  save: (content: string) => Promise<{ exists: true; content: string }>
  clear: () => Promise<{ exists: false; content: string }>
}

type ExpectedProjectSkillsApi = {
  list: () => Promise<ExpectedProjectSkill[]>
  get: (skillId: string) => Promise<ExpectedProjectSkill>
  create: (name: string) => Promise<ExpectedProjectSkill>
  update: (skillId: string, content: string) => Promise<ExpectedProjectSkill>
  delete: (skillId: string) => Promise<{ deleted: true }>
  reload: () => Promise<ExpectedAiTerminalReloadResult>
}

type ExpectedSystemSkillsApi = {
  list: () => Promise<ExpectedProjectSkill[]>
  get: (id: string) => Promise<ExpectedProjectSkill>
  create: (name: string) => Promise<ExpectedProjectSkill>
  update: (id: string, content: string) => Promise<ExpectedProjectSkill>
  delete: (id: string) => Promise<{ deleted: true }>
}

type ExpectedPiSystemApi = {
  status: () => Promise<ExpectedPiRuntimeStatus>
  list: () => Promise<string[]>
  listSkills: () => Promise<ExpectedPiPackageSkill[]>
  install: (source: string) => Promise<{ output: string }>
  update: (source: string) => Promise<{ output: string }>
  remove: (source: string) => Promise<{ output: string }>
}

export type ProjectResourcesBridgeContractAssertions = [
  Expect<Equal<Bridge.ProjectSkillIssue, ExpectedProjectSkillIssue>>,
  Expect<Equal<Bridge.ProjectSkill, ExpectedProjectSkill>>,
  Expect<Equal<Bridge.PiPackageSkill, ExpectedPiPackageSkill>>,
  Expect<Equal<Bridge.PiRuntimeStatus, ExpectedPiRuntimeStatus>>,
  Expect<Equal<Bridge.InstructionsApi, ExpectedInstructionsApi>>,
  Expect<Equal<Bridge.VincodeLabBridge['instructions'], Bridge.InstructionsApi>>,
  Expect<Equal<keyof Bridge.InstructionsApi, 'get' | 'save' | 'clear'>>,
  Expect<Equal<Bridge.ProjectSkillsApi, ExpectedProjectSkillsApi>>,
  Expect<Equal<Bridge.VincodeLabBridge['skills'], Bridge.ProjectSkillsApi>>,
  Expect<Equal<keyof Bridge.ProjectSkillsApi, 'list' | 'get' | 'create' | 'update' | 'delete' | 'reload'>>,
  Expect<Equal<Bridge.SystemSkillsApi, ExpectedSystemSkillsApi>>,
  Expect<Equal<Bridge.VincodeLabBridge['systemSkills'], Bridge.SystemSkillsApi>>,
  Expect<Equal<keyof Bridge.SystemSkillsApi, 'list' | 'get' | 'create' | 'update' | 'delete'>>,
  Expect<Equal<Bridge.PiSystemApi, ExpectedPiSystemApi>>,
  Expect<Equal<Bridge.VincodeLabBridge['piSystem'], Bridge.PiSystemApi>>,
  Expect<Equal<keyof Bridge.PiSystemApi, 'status' | 'list' | 'listSkills' | 'install' | 'update' | 'remove'>>,
  Expect<Equal<Awaited<ReturnType<Bridge.ProjectSkillsApi['reload']>>, Bridge.AiTerminalReloadResult>>,
]

// @ts-expect-error Le issue skill devono essere importate dal bridge, non dichiarate globalmente.
export type ProjectSkillIssueContractMustNotBeGlobal = ProjectSkillIssue
// @ts-expect-error Le skill devono essere importate dal bridge, non dichiarate globalmente.
export type ProjectSkillContractMustNotBeGlobal = ProjectSkill
// @ts-expect-error Le skill dei pacchetti Pi devono essere importate dal bridge, non dichiarate globalmente.
export type PiPackageSkillContractMustNotBeGlobal = PiPackageSkill
// @ts-expect-error Lo stato Pi deve essere importato dal bridge, non dichiarato globalmente.
export type PiRuntimeStatusContractMustNotBeGlobal = PiRuntimeStatus
// @ts-expect-error L'API istruzioni deve essere importata dal bridge, non dichiarata globalmente.
export type InstructionsApiContractMustNotBeGlobal = InstructionsApi
// @ts-expect-error L'API skill progetto deve essere importata dal bridge, non dichiarata globalmente.
export type ProjectSkillsApiContractMustNotBeGlobal = ProjectSkillsApi
// @ts-expect-error L'API skill di sistema deve essere importata dal bridge, non dichiarata globalmente.
export type SystemSkillsApiContractMustNotBeGlobal = SystemSkillsApi
// @ts-expect-error L'API Pi System deve essere importata dal bridge, non dichiarata globalmente.
export type PiSystemApiContractMustNotBeGlobal = PiSystemApi
