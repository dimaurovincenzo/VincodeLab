import { Spinner } from '@/components/ui'
import { emptyStateStyles } from '@/theme/styles/empty-state'

type ViewLoadingStateProps = {
  description?: string
  label: string
}

/** Stato di attesa uniforme per il caricamento lazy delle viste operative. */
export function ViewLoadingState({
  description = 'La vista sarà disponibile tra pochi istanti.',
  label,
}: ViewLoadingStateProps) {
  return <div aria-busy="true" aria-live="polite" className={emptyStateStyles.loadingRoot} role="status">
    <span className={emptyStateStyles.loadingIcon}><Spinner aria-label={`Caricamento ${label}`} size={22} /></span>
    <div className={emptyStateStyles.loadingCopy}>
      <strong className={emptyStateStyles.title}>Caricamento {label}…</strong>
      <span className={emptyStateStyles.description}>{description}</span>
    </div>
  </div>
}
