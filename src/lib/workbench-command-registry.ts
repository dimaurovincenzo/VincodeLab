export type WorkbenchCommandId = string

export type WorkbenchCommandSource =
  | 'palette'
  | 'quick-open'
  | 'menu'
  | 'shortcut'
  | 'context-menu'
  | 'api'

export type WorkbenchFocusRequest = Readonly<{
  target: string
  select?: boolean
  preventScroll?: boolean
}>

export type WorkbenchCommandRunOutcome = Readonly<{
  status?: 'completed' | 'cancelled'
  focus?: WorkbenchFocusRequest
  message?: string
}>

export type WorkbenchCommandInvocation = Readonly<{
  source: WorkbenchCommandSource
  query?: string
}>

export type WorkbenchCommandCondition<TContext extends object> =
  | boolean
  | ((context: Readonly<TContext>) => boolean)

export type WorkbenchCommand<TContext extends object> = Readonly<{
  id: WorkbenchCommandId
  title: string
  category: string
  description?: string
  keywords?: readonly string[]
  shortcut?: string
  when?: WorkbenchCommandCondition<TContext>
  enabled?: WorkbenchCommandCondition<TContext>
  run: (
    context: Readonly<TContext>,
    invocation: WorkbenchCommandInvocation,
  ) => void | WorkbenchCommandRunOutcome | Promise<void | WorkbenchCommandRunOutcome>
}>

export type WorkbenchCommandState<TContext extends object> = Readonly<{
  command: WorkbenchCommand<TContext>
  visible: boolean
  enabled: boolean
}>

export type WorkbenchCommandExecution =
  | Readonly<{
      status: 'executed'
      commandId: WorkbenchCommandId
      outcome: WorkbenchCommandRunOutcome
      focus?: WorkbenchFocusRequest
    }>
  | Readonly<{
      status: 'not-found' | 'unavailable' | 'disabled'
      commandId: WorkbenchCommandId
    }>
  | Readonly<{
      status: 'failed'
      commandId: WorkbenchCommandId
      error: unknown
    }>

export type WorkbenchCommandRegistryListener = () => void

const defaultInvocation: WorkbenchCommandInvocation = Object.freeze({ source: 'api' })
const completedOutcome: WorkbenchCommandRunOutcome = Object.freeze({ status: 'completed' })

function evaluateCondition<TContext extends object>(
  condition: WorkbenchCommandCondition<TContext> | undefined,
  context: Readonly<TContext>,
) {
  if (condition === undefined) return true
  return typeof condition === 'function' ? condition(context) : condition
}

function assertCommand(command: WorkbenchCommand<object>) {
  if (!command.id.trim()) throw new Error('A workbench command requires a non-empty id.')
  if (!command.title.trim()) throw new Error(`Command "${command.id}" requires a title.`)
  if (!command.category.trim()) throw new Error(`Command "${command.id}" requires a category.`)
}

export function defineWorkbenchCommand<TContext extends object>(
  command: WorkbenchCommand<TContext>,
) {
  return command
}

export class WorkbenchCommandRegistry<TContext extends object> {
  readonly #commands = new Map<WorkbenchCommandId, WorkbenchCommand<TContext>>()
  readonly #listeners = new Set<WorkbenchCommandRegistryListener>()
  #context: Readonly<TContext>

  constructor(initialContext: TContext) {
    this.#context = initialContext
  }

  get context() {
    return this.#context
  }

  setContext(context: TContext) {
    if (Object.is(this.#context, context)) return
    this.#context = context
    this.#emitChange()
  }

  subscribe(listener: WorkbenchCommandRegistryListener) {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  register(command: WorkbenchCommand<TContext>) {
    assertCommand(command as WorkbenchCommand<object>)
    if (this.#commands.has(command.id)) {
      throw new Error(`Workbench command id "${command.id}" is already registered.`)
    }

    this.#commands.set(command.id, command)
    this.#emitChange()

    let disposed = false
    return () => {
      if (disposed || this.#commands.get(command.id) !== command) return
      disposed = true
      this.#commands.delete(command.id)
      this.#emitChange()
    }
  }

  registerAll(commands: readonly WorkbenchCommand<TContext>[]) {
    const ids = new Set<WorkbenchCommandId>()
    for (const command of commands) {
      assertCommand(command as WorkbenchCommand<object>)
      if (ids.has(command.id) || this.#commands.has(command.id)) {
        throw new Error(`Workbench command id "${command.id}" is already registered.`)
      }
      ids.add(command.id)
    }

    for (const command of commands) this.#commands.set(command.id, command)
    if (commands.length > 0) this.#emitChange()

    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      let changed = false
      for (const command of commands) {
        if (this.#commands.get(command.id) !== command) continue
        changed = this.#commands.delete(command.id) || changed
      }
      if (changed) this.#emitChange()
    }
  }

  getState(id: WorkbenchCommandId, context: Readonly<TContext> = this.#context) {
    const command = this.#commands.get(id)
    if (!command) return undefined
    const visible = evaluateCondition(command.when, context)
    return {
      command,
      visible,
      enabled: visible && evaluateCondition(command.enabled, context),
    } satisfies WorkbenchCommandState<TContext>
  }

  list(context: Readonly<TContext> = this.#context) {
    const states: WorkbenchCommandState<TContext>[] = []
    for (const command of this.#commands.values()) {
      const state = this.getState(command.id, context)
      if (state?.visible) states.push(state)
    }
    return states
  }

  async execute(
    id: WorkbenchCommandId,
    invocation: WorkbenchCommandInvocation = defaultInvocation,
    context: Readonly<TContext> = this.#context,
  ): Promise<WorkbenchCommandExecution> {
    const state = this.getState(id, context)
    if (!state) return { status: 'not-found', commandId: id }
    if (!state.visible) return { status: 'unavailable', commandId: id }
    if (!state.enabled) return { status: 'disabled', commandId: id }

    try {
      const outcome = (await state.command.run(context, invocation)) ?? completedOutcome
      return {
        status: 'executed',
        commandId: id,
        outcome,
        ...(outcome.focus ? { focus: outcome.focus } : {}),
      }
    } catch (error) {
      return { status: 'failed', commandId: id, error }
    }
  }

  #emitChange() {
    for (const listener of this.#listeners) listener()
  }
}
