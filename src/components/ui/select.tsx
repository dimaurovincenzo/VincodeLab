import { Check, ChevronsUpDown } from 'lucide-react'
import { Portal } from '@ark-ui/react/portal'
import { Select as ArkSelect, createListCollection } from '@ark-ui/react/select'
import { css } from '../../../styled-system/css'
import { createStyleContext } from '../../../styled-system/jsx'
import { select, type SelectVariantProps } from '../../../styled-system/recipes'

const { withProvider, withContext } = createStyleContext(select)
const SelectRoot = withProvider(ArkSelect.Root, 'root') as ArkSelect.RootComponent<SelectVariantProps>

const Select = {
  Root: SelectRoot,
  Label: withContext(ArkSelect.Label, 'label'),
  Control: withContext(ArkSelect.Control, 'control'),
  Trigger: withContext(ArkSelect.Trigger, 'trigger'),
  ValueText: withContext(ArkSelect.ValueText, 'valueText'),
  Indicator: withContext(ArkSelect.Indicator, 'indicator'),
  Positioner: withContext(ArkSelect.Positioner, 'positioner'),
  Content: withContext(ArkSelect.Content, 'content'),
  Item: withContext(ArkSelect.Item, 'item'),
  ItemText: withContext(ArkSelect.ItemText, 'itemText'),
  ItemIndicator: withContext(ArkSelect.ItemIndicator, 'itemIndicator'),
  HiddenSelect: ArkSelect.HiddenSelect,
  Portal,
}

type SelectOption = { label: string; value: string; disabled?: boolean }

type SelectFieldProps = {
  id?: string
  'aria-label'?: string
  label?: string
  options: SelectOption[]
  value?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  layer?: 'popover' | 'modal'
  onValueChange: (value: string) => void
}

function SelectField({ id, 'aria-label': ariaLabel, label, options, value, placeholder = 'Seleziona…', disabled, invalid, layer = 'popover', onValueChange }: SelectFieldProps) {
  const collection = createListCollection({ items: options })
  const accessibleLabel = label ?? ariaLabel

  return <Select.Root
    collection={collection}
    disabled={disabled}
    ids={id ? { trigger: id } : undefined}
    invalid={invalid}
    layer={layer}
    lazyMount
    unmountOnExit
    value={value ? [value] : []}
    onValueChange={({ value: next }) => onValueChange(next[0] ?? '')}
  >
    {accessibleLabel && <Select.Label className={label ? undefined : css({ srOnly: true })}>{accessibleLabel}</Select.Label>}
    <Select.Control>
      <Select.Trigger>
        <Select.ValueText placeholder={placeholder} />
        <Select.Indicator><ChevronsUpDown aria-hidden="true" size={14} /></Select.Indicator>
      </Select.Trigger>
    </Select.Control>
    <Select.HiddenSelect />
    <Select.Portal>
      <Select.Positioner>
        <Select.Content>
          {options.map((item) => <Select.Item item={item} key={item.value}>
            <Select.ItemText>{item.label}</Select.ItemText>
            <Select.ItemIndicator><Check aria-hidden="true" size={14} /></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Content>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>
}

export { Select, SelectField }
export type { SelectFieldProps, SelectOption }
