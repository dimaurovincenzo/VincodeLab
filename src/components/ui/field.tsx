import { Field as ArkField } from '@ark-ui/react/field'
import { createStyleContext } from '../../../styled-system/jsx'
import { field } from '../../../styled-system/recipes'

const { withProvider, withContext } = createStyleContext(field)

const Field = {
  Root: withProvider(ArkField.Root, 'root'),
  Label: withContext(ArkField.Label, 'label'),
  Input: withContext(ArkField.Input, 'input'),
  Textarea: withContext(ArkField.Textarea, 'textarea'),
  HelperText: withContext(ArkField.HelperText, 'helperText'),
  ErrorText: withContext(ArkField.ErrorText, 'errorText'),
  RequiredIndicator: ArkField.RequiredIndicator,
}

export { Field }
