import { Database, Plug } from 'lucide-react'
import type { RedisConnection } from '@/bridge'
import { Button, ErrorNotice, Spinner } from '@/components/ui'
import { EmptyState } from '@/components/empty-state'
import type { UserError } from '@/lib/user-error'
import { redisStyles as rs } from '@/theme/styles/redis'

type Props = {
  connection: RedisConnection
  connecting: boolean
  error: UserError | null
  onConnect: () => void
}

export function RedisConnectionGate({ connection, connecting, error, onConnect }: Props) {
  return <section className={rs.connectionGate}>
    {error && <ErrorNotice action={{ label: 'Riprova connessione', onClick: onConnect }} className={rs.notice} error={error} />}
    <EmptyState
      description={`“${connection.name}” è selezionata, ma il server non è stato contattato. Connettiti per caricare le chiavi del database ${connection.database}.`}
      eyebrow="Connessione manuale"
      icon={<Database size={26} />}
      title="Connessione Redis inattiva"
    />
    <div className={rs.connectionGateActions}>
      <Button disabled={connecting} onClick={onConnect}>
        {connecting ? <Spinner size={14} /> : <Plug aria-hidden="true" size={14} />}
        {connecting ? 'Connessione…' : `Connetti a ${connection.name}`}
      </Button>
    </div>
    <p className={rs.connectionGateHint}>La selezione e i filtri restano salvati; nessuna richiesta di rete parte entrando nella tab Redis.</p>
  </section>
}
