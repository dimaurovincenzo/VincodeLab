import { Component, createRef, type ErrorInfo, type ReactNode } from 'react'
import { ErrorNotice } from '@/components/ui'
import { errorBoundaryStyles } from '@/theme/styles/home'
import { normalizeUserError, reportUserError, type UserError } from '@/lib/user-error'

interface ViewErrorBoundaryProps {
  children: ReactNode
  onRetry?: () => void
  viewName: string
}

interface ViewErrorBoundaryState {
  error: UserError | null
}

export class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  state: ViewErrorBoundaryState = { error: null }
  private readonly fallbackRef = createRef<HTMLDivElement>()

  static getDerivedStateFromError(error: Error): ViewErrorBoundaryState {
    return { error: normalizeUserError(error, {
      category: 'internal',
      component: 'view',
      operation: 'render',
      title: 'Questa sezione non è disponibile',
      description: 'Riprova a caricare soltanto questa vista. Le altre sezioni restano operative.',
    }) }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    const normalized = normalizeUserError(error, {
      category: 'internal',
      component: `view:${this.props.viewName.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`,
      operation: 'render',
      title: `${this.props.viewName} non è disponibile`,
      description: 'Riprova a caricare soltanto questa vista. Il lavoro nelle altre sezioni è rimasto disponibile.',
    })
    reportUserError(normalized)
    this.setState({ error: normalized }, () => this.fallbackRef.current?.focus())
  }

  private readonly retry = () => {
    this.props.onRetry?.()
    this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children

    return <div className={errorBoundaryStyles.view}>
      <div className={errorBoundaryStyles.panel}>
        <p className={errorBoundaryStyles.eyebrow}>{this.props.viewName}</p>
        <ErrorNotice
          action={{ label: 'Riprova', onClick: this.retry }}
          error={this.state.error}
          ref={this.fallbackRef}
        />
      </div>
    </div>
  }
}
