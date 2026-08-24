import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSkill, VincodeLabBridge } from '@/bridge'
import { ProjectInstructions } from '@/features/ai/components/project-instructions'
import { ProjectSkills } from '@/features/ai/components/project-skills'
import { clearVolatileDrafts } from '@/lib/volatile-draft-store'
import type { WorkspaceChangeGuard } from '@/lib/workspace-change-guard'

function installVincodeLab(value: Record<string, unknown>) {
  Object.defineProperty(window, 'vincodeLab', {
    configurable: true,
    value: value as unknown as VincodeLabBridge,
  })
}

function guardCapture() {
  let current: WorkspaceChangeGuard | null = null
  const onChange = vi.fn((guard: WorkspaceChangeGuard | null) => { current = guard })
  const get = () => {
    if (!current) throw new Error('Guard workspace non registrato.')
    return current
  }
  return { get, onChange }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, reject, resolve }
}

describe('WorkspaceChangeGuard delle risorse progetto', () => {
  beforeEach(() => {
    clearVolatileDrafts()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('salva e scarta la skill selezionata mantenendo selezione e focus', async () => {
    const user = userEvent.setup()
    const skill: ProjectSkill = {
      id: 'review-code',
      name: 'review-code',
      description: 'Review del codice',
      valid: true,
      issues: [],
      content: '# Salvato',
    }
    const skills = {
      list: vi.fn(async () => [skill]),
      get: vi.fn(async (_skillId: string) => skill),
      update: vi.fn(async (skillId: string, content: string) => ({ ...skill, id: skillId, content })),
      create: vi.fn(),
      delete: vi.fn(),
      reload: vi.fn(),
    }
    installVincodeLab({ skills })
    const capture = guardCapture()

    const { unmount } = render(<ProjectSkills workspace="/tmp/guard-skills" onWorkspaceGuardChange={capture.onChange} />)
    await user.click(await screen.findByRole('option', { name: /review-code/i }))
    const editor = await screen.findByRole('textbox', { name: 'Contenuto SKILL.md' })
    await waitFor(() => expect(editor).toHaveValue('# Salvato'))

    editor.focus()
    await user.type(editor, ' modificato')
    expect(capture.get().hasUnsavedChanges()).toBe(true)

    await act(async () => capture.get().discardAll())
    expect(editor).toHaveValue('# Salvato')
    expect(editor).toHaveFocus()
    expect(screen.getByRole('option', { name: /review-code/i })).toHaveAttribute('aria-selected', 'true')

    await user.type(editor, ' aggiornato')
    await act(async () => capture.get().saveAll())
    expect(skills.update).toHaveBeenCalledWith('review-code', '# Salvato aggiornato')
    expect(capture.get().hasUnsavedChanges()).toBe(false)
    expect(editor).toHaveFocus()
    expect(screen.getByRole('option', { name: /review-code/i })).toHaveAttribute('aria-selected', 'true')
    expect(capture.onChange).toHaveBeenCalledTimes(1)

    unmount()
    expect(capture.onChange).toHaveBeenCalledTimes(2)
    expect(capture.onChange).toHaveBeenLastCalledWith(null)
  })

  it('mantiene selezione, contenuto e baseline correnti se la nuova skill non si apre', async () => {
    const user = userEvent.setup()
    const skillA: ProjectSkill = { id: 'skill-a', name: 'skill-a', description: 'A', valid: true, issues: [], content: '# A' }
    const skillB: ProjectSkill = { id: 'skill-b', name: 'skill-b', description: 'B', valid: true, issues: [], content: '# B' }
    let skillBReads = 0
    const skills = {
      list: vi.fn(async () => [skillA, skillB]),
      get: vi.fn((skillId: string) => {
        if (skillId === skillA.id) return Promise.resolve(skillA)
        skillBReads += 1
        return skillBReads === 1
          ? Promise.reject(new Error('token=non-mostrare lettura fallita'))
          : Promise.resolve(skillB)
      }),
      update: vi.fn(async (skillId: string, content: string) => ({ ...skillA, id: skillId, content })),
      create: vi.fn(),
      delete: vi.fn(),
      reload: vi.fn(),
    }
    installVincodeLab({ skills })

    render(<ProjectSkills workspace="/tmp/skill-load-failure" />)
    const optionA = await screen.findByRole('option', { name: /skill-a/i })
    const optionB = screen.getByRole('option', { name: /skill-b/i })
    await user.click(optionA)
    const editor = await screen.findByRole('textbox', { name: 'Contenuto SKILL.md' })
    await waitFor(() => expect(editor).toHaveValue('# A'))

    await user.click(optionB)
    await waitFor(() => expect(skills.get).toHaveBeenCalledWith('skill-b'))

    expect(optionA).toHaveAttribute('aria-selected', 'true')
    expect(optionB).toHaveAttribute('aria-selected', 'false')
    expect(editor).toHaveValue('# A')
    expect(screen.getByRole('button', { name: /salva modifiche/i })).toBeDisabled()
    const failure = await screen.findByRole('alert')
    expect(within(failure).getByText('Skill selezionata non aperta')).toBeInTheDocument()
    expect(within(failure).getByText(/Riferimento ERR-[A-F0-9]{6}/)).toBeInTheDocument()
    expect(screen.queryByText(/non-mostrare/i)).not.toBeInTheDocument()

    await user.click(within(failure).getByRole('button', { name: 'Riprova' }))
    await waitFor(() => expect(editor).toHaveValue('# B'))
    expect(optionB).toHaveAttribute('aria-selected', 'true')

    await user.click(optionA)
    await waitFor(() => expect(editor).toHaveValue('# A'))
    await user.type(editor, ' ancora A')
    await user.click(screen.getByRole('button', { name: /salva modifiche/i }))
    await waitFor(() => expect(skills.update).toHaveBeenCalledWith('skill-a', '# A ancora A'))
    expect(skills.update).not.toHaveBeenCalledWith('skill-b', expect.any(String))
  })

  it('pubblica soltanto la selezione Skill più recente quando le letture terminano fuori ordine', async () => {
    const user = userEvent.setup()
    const skillA: ProjectSkill = { id: 'skill-a', name: 'skill-a', description: 'A', valid: true, issues: [], content: '# A' }
    const skillB: ProjectSkill = { id: 'skill-b', name: 'skill-b', description: 'B', valid: true, issues: [], content: '# B' }
    const pendingA = deferred<ProjectSkill>()
    const pendingB = deferred<ProjectSkill>()
    const skills = {
      list: vi.fn(async () => [skillA, skillB]),
      get: vi.fn((skillId: string) => skillId === skillA.id ? pendingA.promise : pendingB.promise),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      reload: vi.fn(),
    }
    installVincodeLab({ skills })

    render(<ProjectSkills workspace="/tmp/skill-selection-race" />)
    const optionA = await screen.findByRole('option', { name: /skill-a/i })
    const optionB = screen.getByRole('option', { name: /skill-b/i })
    await user.click(optionA)
    await user.click(optionB)
    expect(skills.get).toHaveBeenNthCalledWith(1, 'skill-a')
    expect(skills.get).toHaveBeenNthCalledWith(2, 'skill-b')

    await act(async () => pendingB.resolve(skillB))
    const editor = await screen.findByRole('textbox', { name: 'Contenuto SKILL.md' })
    await waitFor(() => expect(editor).toHaveValue('# B'))
    expect(optionB).toHaveAttribute('aria-selected', 'true')

    await act(async () => pendingA.resolve(skillA))
    expect(editor).toHaveValue('# B')
    expect(optionA).toHaveAttribute('aria-selected', 'false')
    expect(optionB).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: /salva modifiche/i })).toBeDisabled()
  })

  it('salva e scarta le istruzioni correnti mantenendo lo stesso editor focalizzato', async () => {
    const user = userEvent.setup()
    const instructions = {
      get: vi.fn(async () => ({ exists: true, content: '# Base' })),
      save: vi.fn(async (content: string) => ({ exists: true as const, content })),
      clear: vi.fn(),
    }
    installVincodeLab({ workspace: { getActive: vi.fn(async () => ({ path: '/tmp/guard-instructions' })) }, instructions })
    const capture = guardCapture()

    const { unmount } = render(<ProjectInstructions onWorkspaceGuardChange={capture.onChange} />)
    const editor = await screen.findByRole('textbox', { name: 'Istruzioni progetto' })
    await waitFor(() => expect(editor).toBeEnabled())
    expect(editor).toHaveValue('# Base')

    editor.focus()
    await user.type(editor, ' temporanee')
    expect(capture.get().hasUnsavedChanges()).toBe(true)

    await act(async () => capture.get().discardAll())
    expect(editor).toHaveValue('# Base')
    expect(editor).toHaveFocus()

    await user.type(editor, ' definitive')
    await act(async () => capture.get().saveAll())
    expect(instructions.save).toHaveBeenCalledWith('# Base definitive')
    expect(capture.get().hasUnsavedChanges()).toBe(false)
    expect(editor).toHaveFocus()
    expect(capture.onChange).toHaveBeenCalledTimes(1)

    unmount()
    expect(capture.onChange).toHaveBeenCalledTimes(2)
    expect(capture.onChange).toHaveBeenLastCalledWith(null)
  })

  it('mantiene le istruzioni nell’editor e consente di ripetere un salvataggio non riuscito', async () => {
    const user = userEvent.setup()
    let saveAttempts = 0
    const instructions = {
      get: vi.fn(async () => ({ exists: true, content: '# Base' })),
      save: vi.fn(async (content: string) => {
        saveAttempts += 1
        if (saveAttempts === 1) throw new Error('password=non-mostrare EACCES')
        return { exists: true as const, content }
      }),
      clear: vi.fn(),
    }
    installVincodeLab({ workspace: { getActive: vi.fn(async () => ({ path: '/tmp/instructions-retry' })) }, instructions })

    render(<ProjectInstructions />)
    const editor = await screen.findByRole('textbox', { name: 'Istruzioni progetto' })
    await waitFor(() => expect(editor).toBeEnabled())
    await user.type(editor, ' locali')
    await user.click(screen.getByRole('button', { name: /salva modifiche/i }))

    const failure = await screen.findByRole('alert')
    expect(within(failure).getByText('Istruzioni progetto non salvate')).toBeInTheDocument()
    expect(within(failure).getByText(/Le modifiche sono rimaste nell.editor/i)).toBeInTheDocument()
    expect(within(failure).getByText(/Riferimento ERR-[A-F0-9]{6}/)).toBeInTheDocument()
    expect(screen.queryByText(/non-mostrare/i)).not.toBeInTheDocument()
    expect(editor).toHaveValue('# Base locali')

    await user.click(within(failure).getByRole('button', { name: 'Riprova' }))
    await waitFor(() => expect(instructions.save).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(editor).toHaveValue('# Base locali')
  })

  it('non applica alla skill nuova il baseline di un salvataggio precedente tardivo', async () => {
    const user = userEvent.setup()
    const skillA: ProjectSkill = { id: 'skill-a', name: 'skill-a', description: 'A', valid: true, issues: [], content: '# A' }
    const skillB: ProjectSkill = { id: 'skill-b', name: 'skill-b', description: 'B', valid: true, issues: [], content: '# B' }
    const pendingSave = deferred<ProjectSkill>()
    const skills = {
      list: vi.fn(async () => [skillA, skillB]),
      get: vi.fn(async (skillId: string) => skillId === skillA.id ? skillA : skillB),
      update: vi.fn(() => pendingSave.promise),
      create: vi.fn(),
      delete: vi.fn(),
      reload: vi.fn(),
    }
    installVincodeLab({ skills })

    render(<ProjectSkills workspace="/tmp/skill-save-race" />)
    await user.click(await screen.findByRole('option', { name: /skill-a/i }))
    const editor = await screen.findByRole('textbox', { name: 'Contenuto SKILL.md' })
    await waitFor(() => expect(editor).toHaveValue('# A'))
    await user.type(editor, ' modificata')
    await user.click(screen.getByRole('button', { name: /salva modifiche/i }))
    await waitFor(() => expect(skills.update).toHaveBeenCalledWith('skill-a', '# A modificata'))

    await user.click(screen.getByRole('option', { name: /skill-b/i }))
    await user.click(await screen.findByRole('button', { name: /scarta e apri/i }))
    await waitFor(() => expect(editor).toHaveValue('# B'))

    await act(async () => pendingSave.resolve({ ...skillA, content: '# A modificata' }))
    await waitFor(() => expect(screen.getByText('skill-b/SKILL.md')).toBeInTheDocument())
    expect(editor).toHaveValue('# B')
    expect(screen.getByRole('button', { name: /salva modifiche/i })).toBeDisabled()
  })

  it('ripristina la skill su disco se lo scarto incrocia un salvataggio in corso', async () => {
    const user = userEvent.setup()
    const skill: ProjectSkill = { id: 'skill-a', name: 'skill-a', description: 'A', valid: true, issues: [], content: '# A' }
    const pendingSave = deferred<ProjectSkill>()
    let updateAttempt = 0
    const skills = {
      list: vi.fn(async () => [skill]),
      get: vi.fn(async () => skill),
      update: vi.fn((skillId: string, content: string) => {
        updateAttempt += 1
        return updateAttempt === 1 ? pendingSave.promise : Promise.resolve({ ...skill, id: skillId, content })
      }),
      create: vi.fn(),
      delete: vi.fn(),
      reload: vi.fn(),
    }
    installVincodeLab({ skills })
    const capture = guardCapture()

    render(<ProjectSkills workspace="/tmp/skill-discard-race" onWorkspaceGuardChange={capture.onChange} />)
    await user.click(await screen.findByRole('option', { name: /skill-a/i }))
    const editor = await screen.findByRole('textbox', { name: 'Contenuto SKILL.md' })
    await waitFor(() => expect(editor).toHaveValue('# A'))
    await user.type(editor, ' da scartare')
    await user.click(screen.getByRole('button', { name: /salva modifiche/i }))
    await waitFor(() => expect(skills.update).toHaveBeenCalledTimes(1))

    const discard = capture.get().discardAll()
    expect(skills.update).toHaveBeenCalledTimes(1)
    await act(async () => {
      pendingSave.resolve({ ...skill, content: '# A da scartare' })
      await discard
    })

    expect(skills.update).toHaveBeenNthCalledWith(2, 'skill-a', '# A')
    expect(editor).toHaveValue('# A')
    expect(capture.get().hasUnsavedChanges()).toBe(false)
  })

  it('ripristina le istruzioni assenti se lo scarto incrocia un salvataggio in corso', async () => {
    const user = userEvent.setup()
    const pendingSave = deferred<{ exists: true; content: string }>()
    const instructions = {
      get: vi.fn(async () => ({ exists: false, content: '' })),
      save: vi.fn(() => pendingSave.promise),
      clear: vi.fn(async () => ({ exists: false as const, content: '' })),
    }
    installVincodeLab({ workspace: { getActive: vi.fn(async () => ({ path: '/tmp/instructions-discard-race' })) }, instructions })
    const capture = guardCapture()

    render(<ProjectInstructions onWorkspaceGuardChange={capture.onChange} />)
    const editor = await screen.findByRole('textbox', { name: 'Istruzioni progetto' })
    await waitFor(() => expect(editor).toBeEnabled())
    await user.type(editor, '# Da scartare')
    await user.click(screen.getByRole('button', { name: /salva modifiche/i }))
    await waitFor(() => expect(instructions.save).toHaveBeenCalledTimes(1))

    const discard = capture.get().discardAll()
    await act(async () => {
      pendingSave.resolve({ exists: true, content: '# Da scartare' })
      await discard
    })

    expect(instructions.clear).toHaveBeenCalledTimes(1)
    expect(editor).toHaveValue('')
    expect(capture.get().hasUnsavedChanges()).toBe(false)
  })
})
