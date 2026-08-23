import { Combobox as ArkCombobox } from '@ark-ui/react/combobox'
import { Portal } from '@ark-ui/react/portal'
import { createStyleContext } from '../../../styled-system/jsx'
import { combobox } from '../../../styled-system/recipes'

const { withProvider, withContext } = createStyleContext(combobox)

const Combobox = {
  Root: withProvider(ArkCombobox.Root, 'root') as typeof ArkCombobox.Root,
  Label: withContext(ArkCombobox.Label, 'label'),
  Control: withContext(ArkCombobox.Control, 'control'),
  Input: withContext(ArkCombobox.Input, 'input'),
  Trigger: withContext(ArkCombobox.Trigger, 'trigger'),
  ClearTrigger: withContext(ArkCombobox.ClearTrigger, 'clearTrigger'),
  Positioner: withContext(ArkCombobox.Positioner, 'positioner'),
  Content: withContext(ArkCombobox.Content, 'content'),
  List: withContext(ArkCombobox.List, 'list'),
  ItemGroup: withContext(ArkCombobox.ItemGroup, 'itemGroup'),
  ItemGroupLabel: withContext(ArkCombobox.ItemGroupLabel, 'itemGroupLabel'),
  Item: withContext(ArkCombobox.Item, 'item'),
  ItemText: withContext(ArkCombobox.ItemText, 'itemText'),
  ItemIndicator: withContext(ArkCombobox.ItemIndicator, 'itemIndicator'),
  Empty: withContext(ArkCombobox.Empty, 'empty'),
  Context: ArkCombobox.Context,
  ItemContext: ArkCombobox.ItemContext,
  Portal,
}

export { Combobox }
export type {
  ComboboxHighlightChangeDetails,
  ComboboxInputValueChangeDetails,
  ComboboxOpenChangeDetails,
  ComboboxValueChangeDetails,
} from '@ark-ui/react/combobox'
