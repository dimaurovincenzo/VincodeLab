import { Editable as ArkEditable } from '@ark-ui/react/editable'
import { createStyleContext } from '../../../styled-system/jsx'
import { editable } from '../../../styled-system/recipes'

const { withProvider, withContext } = createStyleContext(editable)

const Editable = {
  Root: withProvider(ArkEditable.Root, 'root'),
  Area: withContext(ArkEditable.Area, 'area'),
  Input: withContext(ArkEditable.Input, 'input'),
  Preview: withContext(ArkEditable.Preview, 'preview'),
  Control: withContext(ArkEditable.Control, 'control'),
  EditTrigger: withContext(ArkEditable.EditTrigger, 'editTrigger'),
  SubmitTrigger: withContext(ArkEditable.SubmitTrigger, 'submitTrigger'),
  CancelTrigger: withContext(ArkEditable.CancelTrigger, 'cancelTrigger'),
}

export { Editable }
