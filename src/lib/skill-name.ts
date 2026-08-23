export const SKILL_NAME_MAX_LENGTH = 64
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
export const SKILL_NAME_HELP = 'Minuscole e numeri, separati da trattini; massimo 64 caratteri (es. revisione-codice).'

export function skillNameIssue(value: string): string | null {
  const name = value.trim()
  if (!name) return null
  if (name.length <= SKILL_NAME_MAX_LENGTH && SKILL_NAME_PATTERN.test(name)) return null
  return `Formato non valido. ${SKILL_NAME_HELP}`
}
