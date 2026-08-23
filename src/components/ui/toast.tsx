import { ark } from '@ark-ui/react/factory'
import { Portal } from '@ark-ui/react/portal'
import { Toast as ArkToast, Toaster as ArkToaster } from '@ark-ui/react/toast'
import { CircleCheck, Info, TriangleAlert, X, XCircle } from 'lucide-react'
import { createStyleContext } from '../../../styled-system/jsx'
import { toast as toastStyles } from '../../../styled-system/recipes'
import { toastStore, type ToastType } from './toast-store'

const icons = {
  success: CircleCheck,
  error: XCircle,
  info: Info,
  warning: TriangleAlert,
} satisfies Record<ToastType, typeof CircleCheck>

const { withProvider, withContext } = createStyleContext(toastStyles)
const ToastGroup = withProvider(ArkToaster, 'group')
const ToastRoot = withContext(ArkToast.Root, 'root')
const ToastIcon = withContext(ark.div, 'icon')
const ToastBody = withContext(ark.div, 'body')
const ToastTitle = withContext(ArkToast.Title, 'title')
const ToastDescription = withContext(ArkToast.Description, 'description')
const ToastActions = withContext(ark.div, 'actions')
const ToastActionTrigger = withContext(ArkToast.ActionTrigger, 'actionTrigger')
const ToastCount = withContext(ark.span, 'count')
const ToastCloseTrigger = withContext(ArkToast.CloseTrigger, 'closeTrigger')

type ToasterProps = {
  closeButton?: boolean
}

const occurrenceCount = (meta?: Record<string, unknown>) => {
  const errorExperience = meta?.errorExperience
  if (!errorExperience || typeof errorExperience !== 'object') return 1
  const occurrences = Reflect.get(errorExperience, 'occurrences')
  return typeof occurrences === 'number' && Number.isFinite(occurrences) && occurrences > 1 ? Math.floor(occurrences) : 1
}

function Toaster({ closeButton = true }: ToasterProps) {
  return (
    <Portal>
      <ToastGroup toaster={toastStore} aria-label="Notifiche">
        {(item) => {
          const type = (item.type && item.type in icons ? item.type : 'info') as ToastType
          const StatusIcon = icons[type]
          const occurrences = occurrenceCount(item.meta)

          return (
            <ToastRoot role={type === 'error' ? 'alert' : 'status'}>
              <ToastIcon data-toast-icon aria-hidden="true">
                <StatusIcon size={16} />
              </ToastIcon>
              <ToastBody>
                {item.title ? <ToastTitle>{item.title}</ToastTitle> : null}
                {item.description ? <ToastDescription>{item.description}</ToastDescription> : null}
                {item.action || occurrences > 1 ? (
                  <ToastActions>
                    {item.action ? <ToastActionTrigger>{item.action.label}</ToastActionTrigger> : null}
                    {occurrences > 1 ? (
                      <ToastCount aria-label={`Notifica raggruppata: ${occurrences} occorrenze`}>×{occurrences}</ToastCount>
                    ) : null}
                  </ToastActions>
                ) : null}
              </ToastBody>
              {closeButton ? (
                <ToastCloseTrigger aria-label="Chiudi notifica">
                  <X aria-hidden="true" size={14} />
                </ToastCloseTrigger>
              ) : null}
            </ToastRoot>
          )
        }}
      </ToastGroup>
    </Portal>
  )
}

export { Toaster }
