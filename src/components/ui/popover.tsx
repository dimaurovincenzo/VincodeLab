import { Popover as ArkPopover } from '@ark-ui/react/popover'
import { Portal } from '@ark-ui/react/portal'
import { createStyleContext } from '../../../styled-system/jsx'
import { popover } from '../../../styled-system/recipes'

const { withRootProvider, withContext } = createStyleContext(popover)

const Popover = {
  Root: withRootProvider(ArkPopover.Root),
  Trigger: ArkPopover.Trigger,
  Anchor: ArkPopover.Anchor,
  Positioner: withContext(ArkPopover.Positioner, 'positioner'),
  Content: withContext(ArkPopover.Content, 'content'),
  Title: withContext(ArkPopover.Title, 'title'),
  Description: withContext(ArkPopover.Description, 'description'),
  CloseTrigger: withContext(ArkPopover.CloseTrigger, 'closeTrigger'),
  Arrow: withContext(ArkPopover.Arrow, 'arrow'),
  ArrowTip: withContext(ArkPopover.ArrowTip, 'arrowTip'),
  Portal,
}

export { Popover }
