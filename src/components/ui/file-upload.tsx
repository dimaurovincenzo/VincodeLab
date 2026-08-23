import { FileUpload as ArkFileUpload } from '@ark-ui/react/file-upload'
import { ark } from '@ark-ui/react/factory'
import { createStyleContext } from '../../../styled-system/jsx'
import { fileUpload } from '../../../styled-system/recipes'

const { withProvider, withContext } = createStyleContext(fileUpload)
const FileUploadRoot = withProvider(ArkFileUpload.Root, 'root') as typeof ArkFileUpload.Root

const FileUpload = {
  Root: FileUploadRoot,
  Label: withContext(ArkFileUpload.Label, 'label'),
  Dropzone: withContext(ArkFileUpload.Dropzone, 'dropzone'),
  HiddenInput: ArkFileUpload.HiddenInput,
  Trigger: withContext(ArkFileUpload.Trigger, 'trigger'),
  ItemGroup: withContext(ArkFileUpload.ItemGroup, 'itemGroup'),
  Item: withContext(ArkFileUpload.Item, 'item'),
  ItemName: withContext(ArkFileUpload.ItemName, 'itemName'),
  ItemPreview: withContext(ArkFileUpload.ItemPreview, 'itemPreview'),
  ItemPreviewImage: withContext(ArkFileUpload.ItemPreviewImage, 'itemPreviewImage'),
  ItemSizeText: withContext(ArkFileUpload.ItemSizeText, 'itemSizeText'),
  ItemDeleteTrigger: withContext(ArkFileUpload.ItemDeleteTrigger, 'itemDeleteTrigger'),
  ClearTrigger: withContext(ArkFileUpload.ClearTrigger, 'clearTrigger'),
  Action: withContext(ark.div, 'action'),
  Context: ArkFileUpload.Context,
}

export { FileUpload }
export type {
  FileUploadFileChangeDetails,
  FileUploadFileRejectDetails,
  FileUploadRootProps,
} from '@ark-ui/react/file-upload'
