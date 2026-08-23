import { Dialog as ArkDialog } from '@ark-ui/react/dialog'
import { Portal } from '@ark-ui/react/portal'
import { createStyleContext } from '../../../styled-system/jsx'
import { dialog } from '../../../styled-system/recipes'

const { withRootProvider, withContext } = createStyleContext(dialog)

const Dialog = {
  Root: withRootProvider(ArkDialog.Root),
  Portal,
  Backdrop: withContext(ArkDialog.Backdrop, 'backdrop'),
  Positioner: withContext(ArkDialog.Positioner, 'positioner'),
  Content: withContext(ArkDialog.Content, 'content'),
  Title: withContext(ArkDialog.Title, 'title'),
  Description: withContext(ArkDialog.Description, 'description'),
  Trigger: ArkDialog.Trigger,
  CloseTrigger: withContext(ArkDialog.CloseTrigger, 'closeTrigger'),
}

export { Dialog }
