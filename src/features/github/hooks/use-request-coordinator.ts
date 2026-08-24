import { useCallback, useMemo, useRef } from 'react'

export function useRequestCoordinator() {
  const sequence = useRef(0)
  const begin = useCallback(() => {
    sequence.current += 1
    return sequence.current
  }, [])
  const invalidate = useCallback(() => { sequence.current += 1 }, [])
  const isCurrent = useCallback((requestId: number) => sequence.current === requestId, [])

  return useMemo(() => ({ begin, invalidate, isCurrent }), [begin, invalidate, isCurrent])
}

export type RequestCoordinator = ReturnType<typeof useRequestCoordinator>
