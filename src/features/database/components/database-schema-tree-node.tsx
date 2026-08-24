import { ChevronRight, FilePenLine, Table2 } from 'lucide-react'
import { TreeView } from '@/components/ui'
import type { DatabaseSchemaTreeNode } from '../model/database.types'

interface DatabaseSchemaTreeNodeProps {
  indexPath: number[]
  node: DatabaseSchemaTreeNode
}

export function DatabaseSchemaTreeNodeView({ indexPath, node }: DatabaseSchemaTreeNodeProps) {
  return <TreeView.NodeProvider indexPath={indexPath} node={node}>
    {node.kind === 'group' ? <TreeView.Branch>
      <TreeView.BranchControl title={node.label}>
        <TreeView.BranchTrigger aria-label={`${node.label}: espandi o comprimi`}><TreeView.BranchIndicator><ChevronRight aria-hidden="true" size={14} /></TreeView.BranchIndicator></TreeView.BranchTrigger>
        <TreeView.BranchText><strong>{node.label}</strong><small>{node.count ?? 0}</small></TreeView.BranchText>
      </TreeView.BranchControl>
      <TreeView.BranchContent>{node.children?.map((child, index) => <DatabaseSchemaTreeNodeView indexPath={[...indexPath, index]} key={child.value} node={child} />)}</TreeView.BranchContent>
    </TreeView.Branch> : <TreeView.Item title={node.tableName ?? node.label}>
      {node.kind === 'table' ? <Table2 aria-hidden="true" size={14} /> : <FilePenLine aria-hidden="true" size={14} />}
      <TreeView.ItemText>{node.label}</TreeView.ItemText>
    </TreeView.Item>}
  </TreeView.NodeProvider>
}
