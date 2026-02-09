import type { Ref } from 'vue'
import type Konva from 'konva'
import type { useSchemaStore } from '~/stores/schema'
import type { CanvasMode } from './constants'
import { useCanvasCables } from './useCanvasCables'
import { useCanvasNodes } from './useCanvasNodes'

type CanvasItemsOptions = {
  layer: Konva.Layer
  schemaStore: ReturnType<typeof useSchemaStore>
  getMode: () => CanvasMode
  pendingSourceId: Ref<string | null>
}

export const useCanvasItems = ({
  layer,
  schemaStore,
  getMode,
  pendingSourceId,
}: CanvasItemsOptions) => {
  const cables = useCanvasCables({ layer, schemaStore })
  const nodes = useCanvasNodes({
    layer,
    schemaStore,
    getMode,
    pendingSourceId,
    onRequestSyncCables: () => cables.syncCableLines(nodes.getNodeCenter),
  })

  const buildIssueMaps = () => {
    const componentIssues = new Map<string, 'warning' | 'error'>()
    const cableIssues = new Map<string, 'warning' | 'error'>()

    schemaStore.issues.forEach((issue) => {
      const targetMap = issue.targetType === 'cable' ? cableIssues : componentIssues
      const current = targetMap.get(issue.targetId)
      if (current === 'error') return
      targetMap.set(issue.targetId, issue.level)
    })

    return { componentIssues, cableIssues }
  }

  const applySelection = () => {
    nodes.applySelection(schemaStore.schema.selection.componentId, pendingSourceId.value)
    cables.applySelection(schemaStore.schema.selection.cableId)
  }

  const applyIssueBadges = () => {
    const { componentIssues, cableIssues } = buildIssueMaps()
    nodes.applyIssueBadges(componentIssues)
    cables.applyIssueBadges(cableIssues)
  }

  const syncScene = () => {
    const currentComponentIds = new Set(
      schemaStore.schema.components.map((component) => component.id),
    )
    const currentCableIds = new Set(schemaStore.schema.cables.map((cable) => cable.id))

    nodes.syncNodes(schemaStore.schema.components)
    cables.syncCables(schemaStore.schema.cables)

    nodes.pruneNodes(currentComponentIds)
    cables.pruneCables(currentCableIds)

    cables.syncCableLines(nodes.getNodeCenter)
    applySelection()
    applyIssueBadges()
    layer.batchDraw()
  }

  const syncCableLines = () => {
    cables.syncCableLines(nodes.getNodeCenter)
  }

  nodes.ensureAssets()

  return {
    syncScene,
    syncCableLines,
    applySelection,
    applyIssueBadges,
  }
}
