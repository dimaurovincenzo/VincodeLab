import { useLayoutEffect, useRef } from 'react'
import { TreeView } from '@/components/ui'

function StartTreeNodeRenameEffect({ attempt, startRenaming, value }: { attempt: number; startRenaming: (value: string) => void; value: string }) {
  const started = useRef<string | null>(null)

  useLayoutEffect(() => {
    const key = `${value}:${attempt}`
    if (started.current === key) return
    started.current = key
    startRenaming(value)
  }, [attempt, startRenaming, value])

  return null
}

export function StartTreeNodeRename({ attempt, value }: { attempt: number; value: string }) {
  return <TreeView.Context>{({ startRenaming }) => <StartTreeNodeRenameEffect attempt={attempt} startRenaming={startRenaming} value={value} />}</TreeView.Context>
}
