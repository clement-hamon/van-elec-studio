import type { ComponentInstance } from '~/types/schema'

type CableEndpoints = {
  score: number
  from: { nodeId: string; portId: string }
  to: { nodeId: string; portId: string }
}

const pickPreferredPortId = (component: ComponentInstance, direction: 'in' | 'out') => {
  const preferred = component.ports.find((port) => port.dir === direction)
  if (preferred) return preferred.id

  const bidirectional = component.ports.find((port) => port.dir === 'bidirectional')
  if (bidirectional) return bidirectional.id

  return component.ports[0]?.id ?? null
}

export const useCablePortResolver = () => {
  const resolvePreferredEndpoints = (
    componentA: ComponentInstance,
    componentB: ComponentInstance,
  ): CableEndpoints | null => {
    let best: CableEndpoints | null = null

    const consider = (
      score: number,
      fromNodeId: string,
      fromPortId: string,
      toNodeId: string,
      toPortId: string,
    ) => {
      if (best && score <= best.score) return
      best = {
        score,
        from: { nodeId: fromNodeId, portId: fromPortId },
        to: { nodeId: toNodeId, portId: toPortId },
      }
    }

    componentA.ports.forEach((portA) => {
      componentB.ports.forEach((portB) => {
        if (portA.domain !== portB.domain || portA.conductor !== portB.conductor) return

        if (portA.dir === 'out' && portB.dir === 'in') {
          consider(100, componentA.id, portA.id, componentB.id, portB.id)
          return
        }
        if (portB.dir === 'out' && portA.dir === 'in') {
          consider(100, componentB.id, portB.id, componentA.id, portA.id)
          return
        }
        if (portA.dir === 'bidirectional' && portB.dir === 'in') {
          consider(90, componentA.id, portA.id, componentB.id, portB.id)
          return
        }
        if (portB.dir === 'bidirectional' && portA.dir === 'in') {
          consider(90, componentB.id, portB.id, componentA.id, portA.id)
          return
        }
        if (portA.dir === 'out' && portB.dir === 'bidirectional') {
          consider(85, componentA.id, portA.id, componentB.id, portB.id)
          return
        }
        if (portB.dir === 'out' && portA.dir === 'bidirectional') {
          consider(85, componentB.id, portB.id, componentA.id, portA.id)
          return
        }
        if (portA.dir === 'bidirectional' && portB.dir === 'bidirectional') {
          consider(70, componentA.id, portA.id, componentB.id, portB.id)
        }
      })
    })

    if (best) return best

    const fallbackFromPortId = pickPreferredPortId(componentA, 'out')
    const fallbackToPortId = pickPreferredPortId(componentB, 'in')
    if (!fallbackFromPortId || !fallbackToPortId) return null
    return {
      score: 0,
      from: { nodeId: componentA.id, portId: fallbackFromPortId },
      to: { nodeId: componentB.id, portId: fallbackToPortId },
    }
  }

  return {
    resolvePreferredEndpoints,
  }
}
