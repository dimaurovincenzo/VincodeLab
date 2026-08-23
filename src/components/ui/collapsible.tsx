import { Collapsible as ArkCollapsible } from '@ark-ui/react/collapsible'
import { createStyleContext } from '../../../styled-system/jsx'
import { collapsible } from '../../../styled-system/recipes'

const { withProvider, withContext } = createStyleContext(collapsible)

const Collapsible = {
  Root: withProvider(ArkCollapsible.Root, 'root'),
  Trigger: withContext(ArkCollapsible.Trigger, 'trigger'),
  Content: withContext(ArkCollapsible.Content, 'content'),
  Indicator: withContext(ArkCollapsible.Indicator, 'indicator'),
}

export { Collapsible }
