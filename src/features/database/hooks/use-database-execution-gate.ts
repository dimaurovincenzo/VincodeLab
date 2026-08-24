import { useCallback, useRef } from 'react'

export function useDatabaseExecutionGate() {
  const revision = useRef(0)
  const begin = useCallback(() => ++revision.current, [])
  const invalidate = useCallback(() => { revision.current += 1 }, [])
  const isCurrent = useCallback((request: number) => request === revision.current, [])
  return { begin, invalidate, isCurrent }
}
