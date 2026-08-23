import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toaster, toast } from '@/components/ui'
import { toastStore } from '@/components/ui/toast-store'

afterEach(() => {
  toast.remove()
  vi.useRealTimers()
})

const visibleToast = (id: string) => toastStore.getVisibleToasts().find((item) => item.id === id)

describe('Error Experience toast', () => {
  it('deduplica lo stesso errore, aggiorna il toast esistente e conta le occorrenze', () => {
    const firstId = toast.error('Connessione al database interrotta', {
      dedupeKey: 'database:connection-lost',
      description: 'La query è stata mantenuta.',
      id: 'error:database-connection',
    })
    const secondId = toast.error('Connessione al database interrotta', {
      dedupeKey: 'database:connection-lost',
      description: 'La query è stata mantenuta.',
      id: 'error:database-connection',
    })

    expect(firstId).toBe('error:database-connection')
    expect(secondId).toBe(firstId)
    expect(toastStore.getCount()).toBe(1)
    expect(visibleToast(firstId)?.meta?.errorExperience).toEqual({ occurrences: 2 })

    toast.update(firstId, {
      description: 'La connessione è di nuovo disponibile.',
      title: 'Database riconnesso',
      type: 'success',
    })

    expect(visibleToast(firstId)).toMatchObject({
      description: 'La connessione è di nuovo disponibile.',
      meta: {},
      title: 'Database riconnesso',
      type: 'success',
    })
  })

  it('raggruppa errori correlati e mantiene nel toast il problema più recente', () => {
    const retry = vi.fn()
    const firstId = toast.error('Trasferimento remoto interrotto', {
      dedupeKey: 'download:first-file',
      description: 'Impossibile scaricare “first-file.txt”.',
      groupKey: 'remote-downloads',
      recoveryAction: { label: 'Riprova', onClick: retry },
    })
    const secondId = toast.error('Trasferimento remoto interrotto', {
      dedupeKey: 'download:second-file',
      description: 'Impossibile scaricare “second-file.txt”.',
      groupKey: 'remote-downloads',
    })

    expect(secondId).toBe(firstId)
    expect(toastStore.getCount()).toBe(1)
    expect(visibleToast(firstId)).toMatchObject({
      action: { label: 'Riprova', onClick: retry },
      description: 'Impossibile scaricare “second-file.txt”.',
      meta: { errorExperience: { occurrences: 2 } },
    })
  })

  it('rispetta il cooldown dopo la chiusura e riapre solo dopo un intervallo quieto', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T10:00:00.000Z'))

    const firstId = toast.error('Servizio temporaneamente non disponibile', {
      cooldownMs: 5_000,
      dedupeKey: 'service:offline',
    })
    toastStore.remove(firstId)

    vi.advanceTimersByTime(1_000)
    const suppressedId = toast.error('Servizio temporaneamente non disponibile', {
      cooldownMs: 5_000,
      dedupeKey: 'service:offline',
    })
    expect(suppressedId).toBe(firstId)
    expect(toastStore.getCount()).toBe(0)

    vi.advanceTimersByTime(5_001)
    const reopenedId = toast.error('Servizio temporaneamente non disponibile', {
      cooldownMs: 5_000,
      dedupeKey: 'service:offline',
    })
    expect(reopenedId).toBe(firstId)
    expect(toastStore.getCount()).toBe(1)
    expect(visibleToast(firstId)?.meta?.errorExperience).toEqual({ occurrences: 1 })
  })

  it('dimentica il cooldown quando una recovery rimuove programmaticamente l’incidente', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T10:00:00.000Z'))
    const firstId = toast.warning('Explorer Git non aggiornato', {
      cooldownMs: 5_000,
      dedupeKey: 'editor:git-refresh',
    })

    toast.remove(firstId)
    const reopenedId = toast.warning('Explorer Git non aggiornato', {
      cooldownMs: 5_000,
      dedupeKey: 'editor:git-refresh',
    })

    expect(reopenedId).not.toBe(firstId)
    expect(toastStore.getCount()).toBe(1)
  })

  it('consente l’opt-out dalla deduplica per i flussi che richiedono notifiche distinte', () => {
    const firstId = toast.error('Conflitto rilevato', { dedupe: false })
    const secondId = toast.error('Conflitto rilevato', { dedupe: false })

    expect(secondId).not.toBe(firstId)
    expect(toastStore.getCount()).toBe(2)
  })

  it('deduplica anche warning e info mantenendo la severità accessibile', async () => {
    render(<Toaster />)
    act(() => {
      toast.warning('Dimensione non aggiornata', { dedupeKey: 'terminal:resize' })
      toast.warning('Dimensione non aggiornata', { dedupeKey: 'terminal:resize' })
    })

    const warning = await screen.findByRole('status', { name: 'Dimensione non aggiornata' })
    expect(warning).toHaveAttribute('data-type', 'warning')
    expect(within(warning).getByLabelText('Notifica raggruppata: 2 occorrenze')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('espone recovery con Ark ActionTrigger senza sottrarre il focus e annuncia gli errori come alert', async () => {
    const recover = vi.fn()
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Continua a lavorare</button>
        <Toaster />
      </>,
    )

    const currentControl = screen.getByRole('button', { name: 'Continua a lavorare' })
    currentControl.focus()

    act(() => {
      toast.error('Connessione GitHub interrotta', {
        dedupeKey: 'github:network',
        description: 'Le modifiche locali sono rimaste al sicuro.',
        recoveryAction: { label: 'Riprova', onClick: recover },
      })
      toast.error('Connessione GitHub interrotta', {
        dedupeKey: 'github:network',
        description: 'Le modifiche locali sono rimaste al sicuro.',
        recoveryAction: { label: 'Riprova', onClick: recover },
      })
    })

    const alert = await screen.findByRole('alert', { name: 'Connessione GitHub interrotta' })
    expect(alert).toHaveAttribute('aria-atomic', 'true')
    expect(alert).toHaveAttribute('tabindex', '0')
    expect(currentControl).toHaveFocus()
    expect(within(alert).getByText('Le modifiche locali sono rimaste al sicuro.')).toBeVisible()
    expect(within(alert).getByLabelText('Notifica raggruppata: 2 occorrenze')).toHaveTextContent('×2')

    const recoveryButton = within(alert).getByRole('button', { name: 'Riprova' })
    expect(recoveryButton).toHaveAttribute('data-scope', 'toast')
    expect(recoveryButton).toHaveAttribute('data-part', 'action-trigger')
    await user.click(recoveryButton)
    expect(recover).toHaveBeenCalledTimes(1)
  })
})
