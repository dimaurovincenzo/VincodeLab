import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import {
  createPersistentViewState,
  shouldMountPersistentView,
  visitPersistentView,
  type PersistentViewId,
} from '@/lib/persistent-view-state'

type View = 'terminal' | 'settings' | 'skills' | 'instructions'

function StatefulPanel({ view }: { view: Exclude<View, 'terminal'> }) {
  const [draft, setDraft] = useState('')
  return <section data-testid={`${view}-panel`}>
    <label>{view}<input aria-label={`Bozza ${view}`} value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
  </section>
}

function DeferredViewsHarness() {
  const [active, setActive] = useState<View>('terminal')
  const [mounted, setMounted] = useState(createPersistentViewState)

  const select = (view: View) => {
    setActive(view)
    if (view !== 'terminal') setMounted((current) => visitPersistentView(current, view as PersistentViewId))
  }

  return <main>
    {(['terminal', 'settings', 'skills', 'instructions'] as const).map((view) => (
      <button key={view} type="button" onClick={() => select(view)}>{view}</button>
    ))}
    <section hidden={active !== 'terminal'}>Terminale iniziale</section>
    {shouldMountPersistentView(mounted, 'settings', active === 'settings') && <div hidden={active !== 'settings'}><StatefulPanel view="settings" /></div>}
    {shouldMountPersistentView(mounted, 'skills', active === 'skills') && <div hidden={active !== 'skills'}><StatefulPanel view="skills" /></div>}
    {shouldMountPersistentView(mounted, 'instructions', active === 'instructions') && <div hidden={active !== 'instructions'}><StatefulPanel view="instructions" /></div>}
  </main>
}

describe('mount persistente dopo la prima visita', () => {
  it('non costruisce le viste differite allo startup e ne conserva nodo e stato dopo la visita', async () => {
    const user = userEvent.setup()
    render(<DeferredViewsHarness />)

    expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('skills-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('instructions-panel')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings' }))
    const settings = screen.getByTestId('settings-panel')
    await user.type(screen.getByRole('textbox', { name: 'Bozza settings' }), 'persistente')

    await user.click(screen.getByRole('button', { name: 'skills' }))
    const skills = screen.getByTestId('skills-panel')
    expect(screen.getByTestId('settings-panel')).toBe(settings)

    await user.click(screen.getByRole('button', { name: 'instructions' }))
    const instructions = screen.getByTestId('instructions-panel')
    await user.click(screen.getByRole('button', { name: 'terminal' }))

    expect(screen.getByTestId('settings-panel')).toBe(settings)
    expect(screen.getByTestId('skills-panel')).toBe(skills)
    expect(screen.getByTestId('instructions-panel')).toBe(instructions)
    expect(screen.getByLabelText('Bozza settings')).toHaveValue('persistente')
  })
})
