import { SegmentGroup as ArkSegmentGroup } from '@ark-ui/react/segment-group'
import { createStyleContext } from '../../../styled-system/jsx'
import { segmentGroup } from '../../../styled-system/recipes'

const { withProvider, withContext } = createStyleContext(segmentGroup)

const SegmentGroup = {
  Root: withProvider(ArkSegmentGroup.Root, 'root'),
  Label: withContext(ArkSegmentGroup.Label, 'label'),
  Item: withContext(ArkSegmentGroup.Item, 'item'),
  ItemText: withContext(ArkSegmentGroup.ItemText, 'itemText'),
  ItemControl: withContext(ArkSegmentGroup.ItemControl, 'itemControl'),
  ItemHiddenInput: ArkSegmentGroup.ItemHiddenInput,
  Indicator: withContext(ArkSegmentGroup.Indicator, 'indicator'),
}

export { SegmentGroup }
