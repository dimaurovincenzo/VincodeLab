import { Component, createRef, type ErrorInfo, type ReactNode } from 'react'
import { ErrorNotice } from '@/components/ui'
import { errorBoundaryStyles } from '@/theme/styles/home'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'

interface AppErrorBoundaryProps { children: ReactNode }
interface AppErrorBoundaryState {
  error: UserError | null
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null }
  private readonly fallbackRef = createRef<HTMLDivElement>()

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error: normalizeUserError(error, {
      category: 'internal',
      component: 'renderer-app',
      operation: 'render',
      title: 'Interfaccia temporaneamente non disponibile',
      description: 'Riprova a caricare l’interfaccia. I file del progetto non sono stati modificati.',
    }) }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    const normalized = normalizeUserError(error, {
      category: 'internal',
      component: 'renderer-app',
      operation: 'render',
      title: 'Interfaccia temporaneamente non disponibile',
      description: 'Riprova a caricare l’interfaccia. I file del progetto non sono stati modificati.',
    })
    reportUserError(normalized)
    this.setState({ error: normalized }, () => this.fallbackRef.current?.focus())
  }

  retry = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) return <main className={errorBoundaryStyles.app}>
      <div className={errorBoundaryStyles.panel}>
        <p className={errorBoundaryStyles.eyebrow}>VincodeLab</p>
        <ErrorNotice
          action={{ label: 'Riprova', onClick: this.retry }}
          error={this.state.error}
          ref={this.fallbackRef}
          secondaryAction={{ label: 'Ricarica app', onClick: () => window.location.reload() }}
        />
      </div>
    </main>
    return this.props.children
  }
}
