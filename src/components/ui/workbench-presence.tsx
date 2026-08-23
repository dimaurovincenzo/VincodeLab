import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useMemo, type ReactNode } from 'react'

interface WorkbenchPresenceProps {
  children: ReactNode
  className?: string
  presenceKey: string
}

function durationInSeconds(value: string, fallback: number) {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return fallback
  return value.endsWith('ms') ? parsed / 1_000 : parsed
}

function easingTuple(value: string) {
  const numbers = value.match(/-?\d*\.?\d+/g)?.map(Number)
  return numbers?.length === 4 && numbers.every(Number.isFinite)
    ? numbers as [number, number, number, number]
    : [0.2, 0, 0, 1] as const
}

function readGraphiteMotion() {
  if (typeof document === 'undefined') {
    return { duration: 0.1, ease: [0.2, 0, 0, 1] as const }
  }

  const styles = window.getComputedStyle(document.documentElement)
  return {
    duration: durationInSeconds(styles.getPropertyValue('--motion-fast').trim(), 0.1),
    ease: easingTuple(styles.getPropertyValue('--ease-standard').trim()),
  }
}

/**
 * Presence Motion riservata a cambi di contenuto non gestiti da una state machine
 * Ark. Non deve avvolgere terminali, editor o altre viste persistenti.
 */
export function WorkbenchPresence({ children, className, presenceKey }: WorkbenchPresenceProps) {
  const reducedMotion = useReducedMotion()
  const transition = useMemo(
    () => reducedMotion ? { duration: 0 } : readGraphiteMotion(),
    [reducedMotion],
  )

  return <AnimatePresence initial={false} mode="wait">
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={className}
      exit={{ opacity: 0, y: reducedMotion ? 0 : 2 }}
      initial={{ opacity: 0, y: reducedMotion ? 0 : 2 }}
      key={presenceKey}
      transition={transition}
    >
      {children}
    </motion.div>
  </AnimatePresence>
}
