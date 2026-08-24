import { normalizeUserError, type UserError } from '@/lib/user-error'
import type { GitHubErrorContext } from '../model/github-workspace.types'

export function contextualGitHubError(error: unknown, context: GitHubErrorContext) {
  const classified = normalizeUserError(error, {
    component: 'github-workspace',
    operation: context.operation,
  })
  const preserved = context.preserved ? ` ${context.preserved}` : ''
  const rateLimited = classified.category === 'network'
    && (/RATE.?LIMIT|TOO_MANY_REQUESTS/u.test(classified.code ?? '') || /limitando|rate.?limit|429/iu.test(classified.technicalMessage))
  const copy = rateLimited
    ? { title: 'Limite richieste GitHub raggiunto', description: `${context.action} non è stata completata. Attendi qualche minuto, poi ${context.recovery.toLocaleLowerCase('it-IT')}.${preserved}` }
    : classified.category === 'authentication'
      ? { title: 'Accesso GitHub richiesto', description: `${context.action} non è stata completata. Accedi di nuovo a GitHub, poi ${context.recovery.toLocaleLowerCase('it-IT')}.${preserved}` }
      : classified.category === 'permission'
        ? { title: 'Permessi GitHub insufficienti', description: `${context.action} non è stata autorizzata. Verifica i permessi del repository o gli scope del token.${preserved}` }
        : classified.category === 'network'
          ? { title: 'GitHub non raggiungibile', description: `${context.action} non è stata completata. Controlla la connessione e ${context.recovery.toLocaleLowerCase('it-IT')}.${preserved}` }
          : classified.category === 'timeout'
            ? { title: 'GitHub non ha risposto in tempo', description: `${context.action} non è stata completata entro il tempo disponibile. ${context.recovery}.${preserved}` }
            : classified.category === 'not-found'
              ? { title: context.notFoundTitle ?? 'Risorsa GitHub non disponibile', description: `${context.action} non è stata completata perché la risorsa non è più disponibile. Aggiorna i dati prima di continuare.${preserved}` }
              : classified.category === 'conflict'
                ? { title: 'Stato Git cambiato nel frattempo', description: `${context.action} non è stata completata perché il repository è cambiato. Aggiorna lo stato prima di decidere come continuare.${preserved}` }
                : { title: context.title, description: `${context.action} non è stata completata. ${context.recovery}.${preserved}` }

  return normalizeUserError(error, {
    category: classified.category,
    code: classified.code,
    component: 'github-workspace',
    correlationId: classified.correlationId,
    description: copy.description,
    operation: context.operation,
    severity: classified.severity,
    title: copy.title,
  })
}

export function sameUserError(left: UserError | undefined, right: UserError) {
  return Boolean(left
    && left.category === right.category
    && left.code === right.code
    && left.operation === right.operation
    && left.title === right.title)
}
