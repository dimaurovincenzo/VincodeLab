import { createToaster, type ToastActionOptions } from '@ark-ui/react/toast'

type ToastOptions = {
  description?: string
  duration?: number
  id?: string
  action?: ToastAction
}

type ToastType = 'success' | 'error' | 'info' | 'warning'
type ToastAction = ToastActionOptions

type ErrorToastOptions = ToastOptions & {
  /** Prevents repeated incidents from opening more than one toast. Enabled by default for errors. */
  dedupe?: boolean
  /** Stable signature for the same error. It is never rendered in the DOM. */
  dedupeKey?: string
  /** Broader bucket used to group related failures in a single toast. */
  groupKey?: string
  /** Suppresses reopening the same dismissed error until the incident has been quiet for this interval. */
  cooldownMs?: number
  /** Primary, safe recovery offered through Ark Toast.ActionTrigger. */
  recoveryAction?: ToastAction
}

type ToastUpdateOptions = ToastOptions & {
  title?: string
  type?: ToastType
}

type ErrorToastEntry = {
  cooldownMs: number
  id: string
  lastSeenAt: number
  occurrences: number
}

type ErrorExperienceMeta = {
  occurrences: number
}

const ERROR_TOAST_DEFAULT_COOLDOWN_MS = 5_000
const ERROR_TOAST_DEFAULT_DURATION_MS = 10_000
const MAX_ERROR_TOAST_ENTRIES = 128

const toastStore = createToaster<string>({
  placement: 'bottom-end',
  max: 5,
  gap: 10,
  offsets: '16px',
  overlap: false,
  pauseOnPageIdle: true,
})

const errorToastEntries = new Map<string, ErrorToastEntry>()
let nextErrorToastId = 0

const actionFrom = (options?: ErrorToastOptions) => options?.recoveryAction ?? options?.action

const createOptions = (type: ToastType, title: string, options?: ToastOptions) => ({
  ...(options?.duration === undefined ? {} : { duration: options.duration }),
  ...(options?.id === undefined ? {} : { id: options.id }),
  action: options?.action,
  closable: true,
  description: options?.description,
  title,
  type,
})

const showToast = (type: ToastType, title: string, options?: ToastOptions) => toastStore.create(createOptions(type, title, options))

const errorBucketKey = (type: ToastType, title: string, options?: ErrorToastOptions) => {
  if (options?.id) return `${type}:id:${options.id}`
  if (options?.groupKey) return `${type}:group:${options.groupKey}`
  if (options?.dedupeKey) return `${type}:incident:${options.dedupeKey}`
  return `${type}:message:${JSON.stringify([title, options?.description ?? ''])}`
}

const pruneErrorToastEntries = () => {
  if (errorToastEntries.size < MAX_ERROR_TOAST_ENTRIES) return

  const entries = [...errorToastEntries.entries()].sort(([, left], [, right]) => left.lastSeenAt - right.lastSeenAt)
  for (const [key, entry] of entries) {
    if (errorToastEntries.size < MAX_ERROR_TOAST_ENTRIES) break
    if (!toastStore.isVisible(entry.id)) errorToastEntries.delete(key)
  }
}

const errorMeta = (occurrences: number): { errorExperience: ErrorExperienceMeta } => ({
  errorExperience: { occurrences },
})

const errorOptions = (type: ToastType, id: string, title: string, occurrences: number, options?: ErrorToastOptions, fallbackAction?: ToastAction) => ({
  ...createOptions(type, title, {
    ...options,
    action: actionFrom(options) ?? fallbackAction,
    duration: options?.duration ?? (type === 'error' ? ERROR_TOAST_DEFAULT_DURATION_MS : undefined),
    id,
  }),
  meta: errorMeta(occurrences),
})

const showErrorToast = (type: 'error' | 'info' | 'warning', title: string, options?: ErrorToastOptions) => {
  if (options?.dedupe === false) {
    return toastStore.create(errorOptions(type, options.id ?? `toast:${type}:${++nextErrorToastId}`, title, 1, options))
  }

  const key = errorBucketKey(type, title, options)
  const now = Date.now()
  const cooldownMs = Math.max(0, options?.cooldownMs ?? ERROR_TOAST_DEFAULT_COOLDOWN_MS)
  const existing = errorToastEntries.get(key)

  if (existing) {
    const quietFor = now - existing.lastSeenAt
    existing.lastSeenAt = now
    existing.cooldownMs = cooldownMs

    if (toastStore.isVisible(existing.id)) {
      const currentAction = toastStore.getVisibleToasts().find((item) => item.id === existing.id)?.action
      existing.occurrences += 1
      toastStore.update(existing.id, errorOptions(type, existing.id, title, existing.occurrences, options, currentAction))
      return existing.id
    }

    if (quietFor < existing.cooldownMs) return existing.id

    existing.occurrences = 1
    toastStore.create(errorOptions(type, existing.id, title, existing.occurrences, options))
    return existing.id
  }

  pruneErrorToastEntries()
  const entry: ErrorToastEntry = {
    cooldownMs,
    id: options?.id ?? `toast:${type}:${++nextErrorToastId}`,
    lastSeenAt: now,
    occurrences: 1,
  }
  errorToastEntries.set(key, entry)
  toastStore.create(errorOptions(type, entry.id, title, entry.occurrences, options))
  return entry.id
}

const forgetErrorToast = (id: string) => {
  for (const [key, entry] of errorToastEntries) {
    if (entry.id === id) errorToastEntries.delete(key)
  }
}

const updateToast = (id: string, options: ToastUpdateOptions) => {
  const resolvesError = options.type !== undefined && options.type !== 'error'
  if (resolvesError) forgetErrorToast(id)

  return toastStore.update(id, {
    ...(options.action === undefined ? {} : { action: options.action }),
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.duration === undefined ? {} : { duration: options.duration }),
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.type === undefined ? {} : { type: options.type }),
    ...(resolvesError ? { meta: {} } : {}),
  })
}

const toast = {
  success: (title: string, options?: ToastOptions) => showToast('success', title, options),
  error: (title: string, options?: ErrorToastOptions) => showErrorToast('error', title, options),
  info: (title: string, options?: ErrorToastOptions) => showErrorToast('info', title, options),
  warning: (title: string, options?: ErrorToastOptions) => showErrorToast('warning', title, options),
  update: updateToast,
  dismiss: (id?: string) => toastStore.dismiss(id),
  remove: (id?: string) => {
    if (id === undefined) errorToastEntries.clear()
    else forgetErrorToast(id)
    return toastStore.remove(id)
  },
}

export { toast, toastStore }
export type { ErrorToastOptions, ToastAction, ToastOptions, ToastType, ToastUpdateOptions }
