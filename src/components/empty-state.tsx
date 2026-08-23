import type { ReactNode } from 'react'
import { cx } from '../../styled-system/css'
import { emptyStateStyles } from '@/theme/styles/empty-state'

interface EmptyStateProps {
  className?: string
  description: string
  eyebrow?: string
  icon: ReactNode
  title: string
}

/** Stato vuoto uniforme: spiega il contesto e indica il passo successivo senza simulare dati. */
export function EmptyState({ className = '', description, eyebrow, icon, title }: EmptyStateProps) {
  return <div className={cx(emptyStateStyles.root, className)}>
    <div className={emptyStateStyles.icon} aria-hidden="true">{icon}</div>
    {eyebrow && <p className={emptyStateStyles.eyebrow}>{eyebrow}</p>}
    <h2 className={emptyStateStyles.title}>{title}</h2>
    <p className={emptyStateStyles.description}>{description}</p>
  </div>
}
