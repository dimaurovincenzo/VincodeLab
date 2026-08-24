import { useEffect, useRef } from 'react'
import type { AppMenuCommand } from '@/bridge'

const APP_MENU_COMMAND_EVENT = 'vincodelab:application-menu-command'

export function dispatchApplicationMenuCommand(command: AppMenuCommand) {
  window.dispatchEvent(new CustomEvent<AppMenuCommand>(APP_MENU_COMMAND_EVENT, { detail: command }))
}

export function useApplicationMenuCommand(command: AppMenuCommand, handler: () => void) {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<AppMenuCommand>).detail === command) handlerRef.current()
    }
    window.addEventListener(APP_MENU_COMMAND_EVENT, listener)
    return () => window.removeEventListener(APP_MENU_COMMAND_EVENT, listener)
  }, [command])
}
