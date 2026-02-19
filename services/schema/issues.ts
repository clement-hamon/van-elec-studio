import type { FlowOutput, Issue } from '~/types/schema'

export const flowDiagnosticsToIssues = (flow: FlowOutput | null): Issue[] => {
  if (!flow) return []
  return flow.diagnostics.flatMap((diagnostic, index) => {
    const ref = diagnostic.refs?.find((item) => item.edgeId || item.nodeId)
    if (!ref) return []
    const targetId = (ref.edgeId ?? ref.nodeId) as string
    const targetType = ref.edgeId ? 'cable' : 'component'

    return [
      {
        id: `flow-${diagnostic.code}-${targetId}-${index}`,
        level:
          diagnostic.severity === 'error'
            ? 'error'
            : diagnostic.severity === 'warning'
              ? 'warning'
              : 'info',
        message: diagnostic.message,
        targetType,
        targetId,
        category: 'Flow',
      },
    ]
  })
}
