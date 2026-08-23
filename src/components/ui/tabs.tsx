import { Tabs as ArkTabs } from '@ark-ui/react/tabs'
import { createStyleContext } from '../../../styled-system/jsx'
import { tabs } from '../../../styled-system/recipes'

const { withProvider, withContext } = createStyleContext(tabs)

const Tabs = {
  Root: withProvider(ArkTabs.Root, 'root'),
  List: withContext(ArkTabs.List, 'list'),
  Trigger: withContext(ArkTabs.Trigger, 'trigger'),
  Content: withContext(ArkTabs.Content, 'content'),
  Indicator: withContext(ArkTabs.Indicator, 'indicator'),
}

export { Tabs }
