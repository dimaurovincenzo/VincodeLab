const BASE_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
]

export function contentSecurityPolicy({ development = false } = {}) {
  const developmentConnections = development
    ? ' http://127.0.0.1:5173 ws://127.0.0.1:5173'
    : ''
  return [
    ...BASE_DIRECTIVES.slice(0, 5),
    `connect-src 'self'${developmentConnections}`,
    ...BASE_DIRECTIVES.slice(5),
  ].join('; ')
}
