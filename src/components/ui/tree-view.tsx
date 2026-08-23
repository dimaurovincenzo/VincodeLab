import { TreeView as ArkTreeView } from '@ark-ui/react/tree-view'
import { createStyleContext } from '../../../styled-system/jsx'
import { treeView } from '../../../styled-system/recipes'

const { withProvider, withContext } = createStyleContext(treeView)
const TreeViewRoot = withProvider(ArkTreeView.Root, 'root') as typeof ArkTreeView.Root

const TreeView = {
  Root: TreeViewRoot,
  Label: withContext(ArkTreeView.Label, 'label'),
  Tree: withContext(ArkTreeView.Tree, 'tree'),
  Branch: withContext(ArkTreeView.Branch, 'branch'),
  BranchControl: withContext(ArkTreeView.BranchControl, 'branchControl'),
  BranchTrigger: withContext(ArkTreeView.BranchTrigger, 'branchTrigger'),
  BranchIndicator: withContext(ArkTreeView.BranchIndicator, 'branchIndicator'),
  BranchText: withContext(ArkTreeView.BranchText, 'branchText'),
  BranchContent: withContext(ArkTreeView.BranchContent, 'branchContent'),
  BranchIndentGuide: withContext(ArkTreeView.BranchIndentGuide, 'branchIndentGuide'),
  Item: withContext(ArkTreeView.Item, 'item'),
  ItemIndicator: withContext(ArkTreeView.ItemIndicator, 'itemIndicator'),
  ItemText: withContext(ArkTreeView.ItemText, 'itemText'),
  NodeCheckbox: withContext(ArkTreeView.NodeCheckbox, 'nodeCheckbox'),
  NodeRenameInput: withContext(ArkTreeView.NodeRenameInput, 'nodeRenameInput'),
  NodeProvider: ArkTreeView.NodeProvider,
  NodeContext: ArkTreeView.NodeContext,
  Context: ArkTreeView.Context,
}

export { TreeView }
export type {
  TreeCollection,
  TreeNode,
  TreeViewExpandedChangeDetails,
  TreeViewSelectionChangeDetails,
} from '@ark-ui/react/tree-view'
