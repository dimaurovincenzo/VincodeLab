import { Portal } from '@ark-ui/react/portal'
import { Tooltip as ArkTooltip } from '@ark-ui/react/tooltip'
import { createStyleContext } from '../../../styled-system/jsx'
import { tooltip } from '../../../styled-system/recipes'

const { withRootProvider, withContext } = createStyleContext(tooltip)

const Tooltip = {
  Root: withRootProvider(ArkTooltip.Root),
  Trigger: ArkTooltip.Trigger,
  Positioner: withContext(ArkTooltip.Positioner, 'positioner'),
  Content: withContext(ArkTooltip.Content, 'content'),
  Arrow: withContext(ArkTooltip.Arrow, 'arrow'),
  ArrowTip: withContext(ArkTooltip.ArrowTip, 'arrowTip'),
  Portal,
}

export { Tooltip }
