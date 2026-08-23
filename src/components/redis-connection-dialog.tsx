import { CheckCircle2, PlugZap, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Dialog, ErrorNotice, Field, IconButton, SelectField, Spinner } from '@/components/ui'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'
import type { RedisConnection, RedisConnectionInput, RedisConnectionTestResult } from '@/lib/redis-types'
import { redisStyles as rs } from '@/theme/styles/redis'

type Props = {
  connection: RedisConnection | null
  open: boolean
  onClose: () => void
  onSave: (input: RedisConnectionInput) => Promise<void>
  onTest: (input: RedisConnectionInput) => Promise<RedisConnectionTestResult>
}

type Draft = RedisConnectionInput

const emptyDraft = (): Draft => ({ name: '', mode: 'standalone', host: '127.0.0.1', port: 6379, database: 0, username: '', password: '', tls: false })

function connectionDraft(connection: RedisConnection | null): Draft {
  return connection ? { name: connection.name, mode: connection.mode ?? 'standalone', host: connection.host, port: connection.port, database: connection.database, sentinelMasterName: connection.sentinelMasterName, username: connection.username ?? '', password: '', clearPassword: false, sentinelUsername: connection.sentinelUsername ?? '', sentinelPassword: '', clearSentinelPassword: false, tls: connection.tls ?? false } : emptyDraft()
}

function inputFromDraft(draft: Draft) {
  return {
    ...draft,
    name: draft.name.trim(),
    host: draft.host.trim(),
    sentinelMasterName: draft.mode === 'sentinel' ? draft.sentinelMasterName?.trim() : undefined,
    sentinelUsername: draft.mode === 'sentinel' ? draft.sentinelUsername?.trim() || undefined : undefined,
    sentinelPassword: draft.mode === 'sentinel' ? draft.sentinelPassword || undefined : undefined,
    clearSentinelPassword: draft.mode === 'sentinel' ? draft.clearSentinelPassword : undefined,
    username: draft.username?.trim() || undefined,
    password: draft.password || undefined,
  }
}

function connectionError(error: unknown, operation: string, title: string) {
  return reportUserError(normalizeUserError(error, { category: 'database', component: 'redis-connection-dialog', operation, title, fallbackDescription: 'Controlla host, porta, credenziali e disponibilità del server Redis.' }))
}

export function RedisConnectionDialog({ connection, open, onClose, onSave, onTest }: Props) {
  const [draft, setDraft] = useState<Draft>(() => connectionDraft(connection))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState<UserError | null>(null)
  const [testResult, setTestResult] = useState<RedisConnectionTestResult | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ogni apertura deve ripartire dalla configurazione pubblica corrente senza conservare segreti o feedback precedenti
    setDraft(connectionDraft(connection))
    setSaving(false)
    setTesting(false)
    setError(null)
    setTestResult(null)
  }, [connection, open])

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(inputFromDraft(draft))
      onClose()
    } catch (cause) {
      setError(connectionError(cause, connection ? 'update-connection' : 'create-connection', connection ? 'Connessione Redis non aggiornata' : 'Connessione Redis non creata'))
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    if (testing) return
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      setTestResult(await onTest(inputFromDraft(draft)))
    } catch (cause) {
      setError(connectionError(cause, 'test-connection', 'Test Redis non riuscito'))
    } finally {
      setTesting(false)
    }
  }

  return <Dialog.Root initialFocusEl={() => nameInput.current} lazyMount open={open} unmountOnExit onOpenChange={({ open: nextOpen }) => { if (!nextOpen) onClose() }}>
    <Dialog.Portal><Dialog.Backdrop /><Dialog.Positioner><Dialog.Content className={rs.dialogContent}>
      <header className={rs.dialogHeader}><div><p className={rs.dialogEyebrow}>Connessione del workspace</p><Dialog.Title>{connection ? 'Modifica Redis' : 'Nuova connessione Redis'}</Dialog.Title><Dialog.Description>Le credenziali vengono gestite dal bridge sicuro. La vista non esegue comandi di scrittura sui dati.</Dialog.Description></div><Dialog.CloseTrigger asChild><IconButton tooltip="Chiudi"><X aria-hidden="true" size={15} /></IconButton></Dialog.CloseTrigger></header>
      <form className={rs.connectionForm} onSubmit={(event) => { event.preventDefault(); void save() }}>
        <div className={rs.connectionFields}>
          <Field.Root required><Field.Label>Nome</Field.Label><Field.Input ref={nameInput} required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Redis locale" /></Field.Root>
          <SelectField aria-label="Modalità connessione Redis" label="Modalità" options={[{ value: 'standalone', label: 'Standalone' }, { value: 'sentinel', label: 'Sentinel' }]} value={draft.mode} onValueChange={(value) => setDraft((current) => ({ ...current, mode: value as Draft['mode'], port: current.port === 6379 && value === 'sentinel' ? 26379 : current.port }))} />
          <Field.Root required><Field.Label>{draft.mode === 'sentinel' ? 'Host Sentinel' : 'Host'}</Field.Label><Field.Input required value={draft.host} onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))} placeholder="127.0.0.1" /></Field.Root>
          <Field.Root required><Field.Label>Porta</Field.Label><Field.Input max="65535" min="1" required type="number" value={draft.port} onChange={(event) => setDraft((current) => ({ ...current, port: Number(event.target.value) }))} /></Field.Root>
          {draft.mode === 'sentinel' && <Field.Root required><Field.Label>Nome master Sentinel</Field.Label><Field.Input required value={draft.sentinelMasterName ?? ''} onChange={(event) => setDraft((current) => ({ ...current, sentinelMasterName: event.target.value }))} placeholder="mymaster" /></Field.Root>}
          <Field.Root required><Field.Label>Database</Field.Label><Field.Input max="65535" min="0" required type="number" value={draft.database} onChange={(event) => setDraft((current) => ({ ...current, database: Number(event.target.value) }))} /></Field.Root>
        </div>
        <div className={rs.credentials}>
          <Field.Root><Field.Label>Utente</Field.Label><Field.Input autoComplete="off" value={draft.username ?? ''} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))} placeholder="Opzionale" /></Field.Root>
          <Field.Root><Field.Label>Password</Field.Label><Field.Input autoComplete="new-password" disabled={draft.clearPassword} type="password" value={draft.password ?? ''} onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value, clearPassword: false }))} placeholder={connection?.hasPassword ? 'Lascia vuoto per mantenerla' : 'Opzionale'} /></Field.Root>
        </div>
        {connection?.hasPassword && <Checkbox checked={draft.clearPassword ?? false} label="Rimuovi la password salvata" onCheckedChange={(clearPassword) => setDraft((current) => ({ ...current, clearPassword, password: clearPassword ? '' : current.password }))} />}
        {draft.mode === 'sentinel' && <><div className={rs.credentials}>
          <Field.Root><Field.Label>Utente Sentinel</Field.Label><Field.Input autoComplete="off" value={draft.sentinelUsername ?? ''} onChange={(event) => setDraft((current) => ({ ...current, sentinelUsername: event.target.value }))} placeholder="Opzionale e distinto dall’utente Redis" /></Field.Root>
          <Field.Root><Field.Label>Password Sentinel</Field.Label><Field.Input autoComplete="new-password" disabled={draft.clearSentinelPassword} type="password" value={draft.sentinelPassword ?? ''} onChange={(event) => setDraft((current) => ({ ...current, sentinelPassword: event.target.value, clearSentinelPassword: false }))} placeholder={connection?.hasSentinelPassword ? 'Lascia vuoto per mantenerla' : 'Opzionale e distinta dalla password Redis'} /></Field.Root>
        </div>{connection?.hasSentinelPassword && <Checkbox checked={draft.clearSentinelPassword ?? false} label="Rimuovi la password Sentinel salvata" onCheckedChange={(clearSentinelPassword) => setDraft((current) => ({ ...current, clearSentinelPassword, sentinelPassword: clearSentinelPassword ? '' : current.sentinelPassword }))} />}</>}
        <Checkbox checked={draft.tls ?? false} label="Usa TLS" onCheckedChange={(tls) => setDraft((current) => ({ ...current, tls }))} />
        {error && <ErrorNotice action={{ label: error.operation === 'test-connection' ? 'Riprova test' : 'Riprova salvataggio', onClick: error.operation === 'test-connection' ? test : save }} error={error} />}
        {testResult?.ok && <div className={rs.testStatus} role="status"><CheckCircle2 aria-hidden="true" size={15} /> Connessione riuscita in {testResult.latencyMs} ms{testResult.serverVersion ? ` · Redis ${testResult.serverVersion}` : ''}</div>}
        <div className={rs.formActions}><Button disabled={saving || testing} type="button" variant="outline" onClick={() => void test()}>{testing ? <Spinner size={14} /> : <PlugZap aria-hidden="true" size={14} />} {testing ? 'Test in corso…' : 'Testa'}</Button><Dialog.CloseTrigger asChild unstyled><Button disabled={saving} type="button" variant="outline">Annulla</Button></Dialog.CloseTrigger><Button disabled={saving || testing} type="submit">{saving && <Spinner size={14} />}{saving ? 'Salvataggio…' : connection ? 'Salva modifiche' : 'Aggiungi'}</Button></div>
      </form>
    </Dialog.Content></Dialog.Positioner></Dialog.Portal>
  </Dialog.Root>
}
