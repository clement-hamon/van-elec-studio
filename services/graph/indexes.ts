import type { BaseNode, Port, ScenarioInput } from '../../types/schema'

export type NodeWithPorts = Pick<BaseNode, 'id' | 'ports'>

export const portKey = (nodeId: string, portId: string) => `${nodeId}:${portId}`

export const isNodeEnabled = (nodeId: string, scenario: ScenarioInput | undefined) => {
  const enabled = scenario?.enabledNodes?.[nodeId]
  return enabled !== false
}

export const buildPortIndex = (nodes: NodeWithPorts[]) => {
  const portByKey = new Map<string, Port>()
  for (const node of nodes) {
    for (const port of node.ports) {
      portByKey.set(portKey(node.id, port.id), port)
    }
  }
  return portByKey
}

export const buildEnabledPortIndex = (
  nodes: NodeWithPorts[],
  scenario: ScenarioInput | undefined,
) => {
  const portByKey = new Map<string, Port>()
  for (const node of nodes) {
    if (!isNodeEnabled(node.id, scenario)) continue
    for (const port of node.ports) {
      portByKey.set(portKey(node.id, port.id), port)
    }
  }
  return portByKey
}

export const buildNodeIndex = <N extends { id: string }>(nodes: N[]) => {
  return new Map<string, N>(nodes.map((node) => [node.id, node] as const))
}
