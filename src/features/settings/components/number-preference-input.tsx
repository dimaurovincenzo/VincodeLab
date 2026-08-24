import { useEffect, useRef, useState } from 'react'
import { Field } from '@/components/ui'

export type NumberPreferenceInputProps = {
  definition: AppPreferenceDefinition
  disabled: boolean
  initialDraft?: string
  value: number
  onCommit: (value: number) => Promise<boolean>
  onDraftChange?: (draft: string | null) => void
}

export function NumberPreferenceInput({
  definition,
  disabled,
  initialDraft,
  value,
  onCommit,
  onDraftChange,
}: NumberPreferenceInputProps) {
  const [draft, setDraft] = useState(initialDraft ?? String(value))
  const [committing, setCommitting] = useState(false)
  const commitGeneration = useRef(0)
  const inputMounted = useRef(true)
  useEffect(() => () => {
    inputMounted.current = false
    commitGeneration.current += 1
  }, [])
  const parsed = Number(draft)
  const valid = draft.trim() !== ''
    && Number.isFinite(parsed)
    && (definition.min === undefined || parsed >= definition.min)
    && (definition.max === undefined || parsed <= definition.max)

  const commit = async () => {
    if (!valid) {
      setDraft(String(value))
      onDraftChange?.(null)
      return
    }
    if (Object.is(parsed, value)) {
      setDraft(String(value))
      onDraftChange?.(null)
      return
    }
    const generation = ++commitGeneration.current
    setCommitting(true)
    const saved = await onCommit(parsed).catch(() => false)
    if (!inputMounted.current || generation !== commitGeneration.current) return
    setCommitting(false)
    if (saved) onDraftChange?.(null)
  }

  return <Field.Root invalid={!valid}>
    <Field.Input
      aria-label={definition.label}
      disabled={disabled || committing}
      max={definition.max}
      min={definition.min}
      step={definition.step}
      type="number"
      value={draft}
      onBlur={() => { void commit() }}
      onChange={(event) => {
        setDraft(event.target.value)
        onDraftChange?.(event.target.value === String(value) ? null : event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          commitGeneration.current += 1
          setCommitting(false)
          setDraft(String(value))
          onDraftChange?.(null)
          event.currentTarget.blur()
        }
      }}
    />
    <Field.ErrorText>
      Inserisci un numero{definition.min === undefined ? '' : ` da ${definition.min}`}{definition.max === undefined ? '' : ` a ${definition.max}`}.
    </Field.ErrorText>
  </Field.Root>
}
