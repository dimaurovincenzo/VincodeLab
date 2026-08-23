import { Listbox as ArkListbox } from '@ark-ui/react/listbox'
import { createStyleContext } from '../../../styled-system/jsx'
import { listbox } from '../../../styled-system/recipes'

const { withProvider, withContext } = createStyleContext(listbox)

const Listbox = {
  Root: withProvider(ArkListbox.Root, 'root') as typeof ArkListbox.Root,
  Label: withContext(ArkListbox.Label, 'label'),
  ValueText: withContext(ArkListbox.ValueText, 'valueText'),
  Content: withContext(ArkListbox.Content, 'content'),
  Input: withContext(ArkListbox.Input, 'input'),
  ItemGroup: withContext(ArkListbox.ItemGroup, 'itemGroup'),
  ItemGroupLabel: withContext(ArkListbox.ItemGroupLabel, 'itemGroupLabel'),
  Item: withContext(ArkListbox.Item, 'item'),
  ItemText: withContext(ArkListbox.ItemText, 'itemText'),
  ItemIndicator: withContext(ArkListbox.ItemIndicator, 'itemIndicator'),
  Empty: withContext(ArkListbox.Empty, 'empty'),
  Context: ArkListbox.Context,
  ItemContext: ArkListbox.ItemContext,
}

export { Listbox }
export type {
  ListboxHighlightChangeDetails,
  ListboxSelectionMode,
  ListboxValueChangeDetails,
} from '@ark-ui/react/listbox'
