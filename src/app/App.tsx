import { AppShell } from './components/app-shell'
import { useAppController } from './hooks/use-app-controller'

export default function App() {
  const controller = useAppController()
  return <AppShell controller={controller} />
}
