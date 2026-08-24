function normalizeStatus(status) {
  return String(status || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('it-IT')
}

export function githubProjectStatusTone(status) {
  const normalized = normalizeStatus(status)

  if (/complet|completato|done|closed|chius/.test(normalized)) return 'success'
  if (/lavorazione|in progress|progress|doing|attiv/.test(normalized)) return 'info'
  if (/pianific|to do|todo|backlog/.test(normalized)) return 'planned'
  if (/attesa|waiting|pending|sospes/.test(normalized)) return 'warning'
  if (/pronto|ready|review|revisione/.test(normalized)) return 'ready'
  if (/bloccat|blocked|errore|failed/.test(normalized)) return 'error'
  return 'inactive'
}
