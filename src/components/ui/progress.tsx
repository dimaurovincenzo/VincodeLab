import { Progress as ArkProgress } from '@ark-ui/react/progress'
import { createStyleContext } from '../../../styled-system/jsx'
import { progress } from '../../../styled-system/recipes'

const { withProvider, withContext } = createStyleContext(progress)

const Progress = {
  Root: withProvider(ArkProgress.Root, 'root'),
  Label: withContext(ArkProgress.Label, 'label'),
  Track: withContext(ArkProgress.Track, 'track'),
  Range: withContext(ArkProgress.Range, 'range'),
  ValueText: withContext(ArkProgress.ValueText, 'valueText'),
}

export { Progress }
