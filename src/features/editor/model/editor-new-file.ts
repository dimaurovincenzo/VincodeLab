export type NewFileDraftResult =
  | { action: 'cancel' }
  | { action: 'create'; fileName: string }

export function resolveNewFileDraft(value: string | null | undefined): NewFileDraftResult {
  const fileName = value?.trim() ?? ''
  return fileName ? { action: 'create', fileName } : { action: 'cancel' }
}
