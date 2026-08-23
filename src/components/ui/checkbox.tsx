import { Check } from 'lucide-react'
import { Checkbox as ArkCheckbox } from '@ark-ui/react/checkbox'
import type { ReactNode } from 'react'
import { createStyleContext } from '../../../styled-system/jsx'
import { checkbox } from '../../../styled-system/recipes'

const { withProvider, withContext } = createStyleContext(checkbox)

const CheckboxRoot = withProvider(ArkCheckbox.Root, 'root')
const CheckboxControl = withContext(ArkCheckbox.Control, 'control')
const CheckboxIndicator = withContext(ArkCheckbox.Indicator, 'indicator')
const CheckboxLabel = withContext(ArkCheckbox.Label, 'label')

type CheckboxProps = { checked: boolean; disabled?: boolean; label: ReactNode; onCheckedChange: (checked: boolean) => void; 'aria-label'?: string }

function Checkbox({ checked, disabled, label, onCheckedChange, 'aria-label': ariaLabel }: CheckboxProps) {
  return <CheckboxRoot checked={checked} disabled={disabled} onCheckedChange={({ checked: next }) => onCheckedChange(next === true)}>
    <ArkCheckbox.HiddenInput aria-label={ariaLabel} />
    <CheckboxControl><CheckboxIndicator><Check aria-hidden="true" size={12} /></CheckboxIndicator></CheckboxControl>
    {label !== '' && <CheckboxLabel>{label}</CheckboxLabel>}
  </CheckboxRoot>
}

export { Checkbox }
