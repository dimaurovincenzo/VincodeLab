import { CircleAlert, CircleHelp, Copy, RotateCw, TriangleAlert } from 'lucide-react'
import { forwardRef, useState, type ReactNode } from 'react'
import { cx } from '../../../styled-system/css'
import { errorNoticeStyles } from '@/theme/styles/error-notice'
import type { UserError } from '@/lib/user-error'
import { normalizeUserError, reportUserError, userErrorDiagnostic } from '@/lib/user-error'
import { Button } from './button'
import { Collapsible } from './collapsible'

type ErrorNoticeAction = {
  label: string
  onClick: () => void | Promise<void>
  pendingLabel?: string
}

type ErrorNoticeProps = {
  action?: ErrorNoticeAction
  children?: ReactNode
  className?: string
  error: UserError
  secondaryAction?: ErrorNoticeAction
  showDetails?: boolean
}

const icons = {
  info: CircleHelp,
  warning: TriangleAlert,
  error: CircleAlert,
}

const ErrorNotice = forwardRef<HTMLDivElement, ErrorNoticeProps>(function ErrorNotice({
  action,
  children,
  className,
  error,
  secondaryAction,
  showDetails = true,
}, ref) {
  const [pendingAction, setPendingAction] = useState<'primary' | 'secondary' | null>(null)
  const [copyResult, setCopyResult] = useState<{ correlationId: string; status: 'copied' | 'failed' } | null>(null)
  const [recoveryFailure, setRecoveryFailure] = useState<{ error: UserError; sourceCorrelationId: string } | null>(null)
  const currentRecoveryFailure = recoveryFailure?.sourceCorrelationId === error.correlationId ? recoveryFailure.error : null
  const activeError = currentRecoveryFailure ?? error
  const copyStatus = copyResult?.correlationId === activeError.correlationId ? copyResult.status : null
  const StatusIcon = icons[activeError.severity]
  const role = activeError.severity === 'error' ? 'alert' : 'status'

  const runAction = async (kind: 'primary' | 'secondary', selected: ErrorNoticeAction) => {
    if (pendingAction) return
    setPendingAction(kind)
    setCopyResult(null)
    setRecoveryFailure(null)
    try {
      await selected.onClick()
    } catch (cause) {
      const incident = reportUserError(normalizeUserError(cause, {
        category: error.category,
        component: error.component ?? 'error-notice',
        description: `${error.description} Il tentativo “${selected.label}” non è stato completato; puoi riprovare.`,
        operation: `${error.operation ?? 'operation'}-recovery`,
        title: error.title,
      }))
      setRecoveryFailure({ error: incident, sourceCorrelationId: error.correlationId })
    } finally {
      setPendingAction(null)
    }
  }

  const copyDiagnostic = async () => {
    try {
      await navigator.clipboard.writeText(userErrorDiagnostic(activeError))
      setCopyResult({ correlationId: activeError.correlationId, status: 'copied' })
    } catch {
      setCopyResult({ correlationId: activeError.correlationId, status: 'failed' })
    }
  }

  return <div
    aria-live={activeError.severity === 'error' ? 'assertive' : 'polite'}
    className={cx(errorNoticeStyles.root, errorNoticeStyles.severity[activeError.severity], className)}
    ref={ref}
    role={role}
    tabIndex={-1}
  >
    <span className={cx(errorNoticeStyles.icon, errorNoticeStyles.iconTone[activeError.severity])}>
      <StatusIcon aria-hidden="true" size={18} />
    </span>
    <div className={errorNoticeStyles.body}>
      <h2 className={errorNoticeStyles.title}>{activeError.title}</h2>
      <p className={errorNoticeStyles.description}>{activeError.description}</p>
      <p className={errorNoticeStyles.reference}>Riferimento {activeError.correlationId}</p>
      {children}
      {(action || secondaryAction) && <div className={errorNoticeStyles.actions}>
        {action && <Button disabled={pendingAction !== null} onClick={() => void runAction('primary', action)}>
          <RotateCw aria-hidden="true" />
          {pendingAction === 'primary' ? action.pendingLabel ?? 'Operazione in corso…' : action.label}
        </Button>}
        {secondaryAction && <Button disabled={pendingAction !== null} onClick={() => void runAction('secondary', secondaryAction)} variant="outline">
          {pendingAction === 'secondary' ? secondaryAction.pendingLabel ?? 'Operazione in corso…' : secondaryAction.label}
        </Button>}
      </div>}
      {showDetails && <Collapsible.Root lazyMount unmountOnExit>
        <Collapsible.Trigger asChild>
          <Button variant="plain">Mostra dettagli</Button>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div className={errorNoticeStyles.details}>
            <pre className={errorNoticeStyles.detailsText}>{userErrorDiagnostic(activeError)}</pre>
            <div className={errorNoticeStyles.actions}>
              <Button onClick={() => void copyDiagnostic()} variant="outline"><Copy aria-hidden="true" /> Copia diagnostica</Button>
            </div>
            {copyStatus && <p className={errorNoticeStyles.copyStatus} role="status">
              {copyStatus === 'copied' ? 'Diagnostica copiata.' : 'Impossibile accedere agli appunti. Seleziona e copia i dettagli manualmente.'}
            </p>}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>}
    </div>
  </div>
})

export { ErrorNotice }
export type { ErrorNoticeAction, ErrorNoticeProps }
