import { graphiteTheme } from './theme.ts'

export type ServiceMetric = {
  id: string
  label: string
  latencyMs: number
  availability: number
  trend: 'up' | 'stable' | 'down'
}

export const metrics: ServiceMetric[] = [
  { id: 'api', label: 'API Gateway', latencyMs: 82, availability: 99.98, trend: 'stable' },
  { id: 'jobs', label: 'Background Jobs', latencyMs: 96, availability: 99.91, trend: 'up' },
  { id: 'search', label: 'Search Index', latencyMs: 64, availability: 99.96, trend: 'down' },
]

export function healthScore(metric: ServiceMetric): number {
  const latencyPenalty = Math.min(metric.latencyMs / 20, 10)
  return Number(Math.max(0, metric.availability - latencyPenalty).toFixed(2))
}

export function dashboardSummary() {
  const healthy = metrics.filter((metric) => healthScore(metric) >= 94).length
  return {
    accent: graphiteTheme.accent,
    healthy,
    services: metrics.length,
    status: healthy === metrics.length ? 'operational' : 'degraded',
  } as const
}
