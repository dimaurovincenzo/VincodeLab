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
    {error && <ErrorNotice action={{ label: 'Riprova connessione', onClick: onConnect }} className={rs.connectionGateNotice} error={error} />}
    <div className={rs.connectionGateCard}>
      <EmptyState
        description={`Avvia la connessione per esplorare le chiavi del database ${connection.database}.`}
        eyebrow="Connessione manuale"
        icon={<Database size={26} />}
        title="Connessione Redis inattiva"
      />
      <dl className={rs.connectionGateFacts}>
        <div><dt>Configurazione</dt><dd>{connection.name}</dd></div>
        <div><dt>Modalità</dt><dd>{connection.mode === 'sentinel' ? 'Sentinel' : 'Standalone'}</dd></div>
        <div><dt>Endpoint</dt><dd>{connection.host}:{connection.port}</dd></div>
        <div><dt>Database</dt><dd>DB {connection.database}</dd></div>
      </dl>
      <div className={rs.connectionGateActions}>
        <Button aria-label={`Connetti a ${connection.name}`} disabled={connecting} onClick={onConnect}>
          {connecting ? <Spinner size={14} /> : <Plug aria-hidden="true" size={14} />}
          {connecting ? 'Connessione…' : 'Connetti ora'}
        </Button>
      </div>
      <p className={rs.connectionGateHint}>Nessuna richiesta di rete viene inviata finché non scegli Connetti.</p>
    </div>
  </section>
}
