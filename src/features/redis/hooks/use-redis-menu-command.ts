import { useEffect, useRef } from 'react'

export function useRedisMenuCommand(command: string, handler: () => void) {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<string>).detail === command) handlerRef.current()
    }
    window.addEventListener('vincodelab:application-menu-command', listener)
    return () => window.removeEventListener('vincodelab:application-menu-command', listener)
  }, [command])
}
