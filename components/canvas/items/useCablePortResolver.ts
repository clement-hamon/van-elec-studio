import type { Cable, ComponentInstance, Conductor } from '~/types/schema'

type CableEndpoints = {
  score: number
  from: { nodeId: string; portId: string }
  to: { nodeId: string; portId: string }
}

export type CableConductorChoice = Extract<Conductor, 'POS' | 'NEG'>
type PortDirection = ComponentInstance['ports'][number]['dir']

const pickPreferredPortId = (
  component: ComponentInstance,
  direction: 'in' | 'out',
  preferredConductor?: CableConductorChoice,
) => {
  const preferred = component.ports.find(
    (port) =>
      port.dir === direction &&
      (!preferredConductor || port.conductor === preferredConductor),
  )
  if (preferred) return preferred.id

  const bidirectional = component.ports.find(
    (port) =>
      port.dir === 'bidirectional' &&
      (!preferredConductor || port.conductor === preferredConductor),
  )
  if (bidirectional) return bidirectional.id

  if (preferredConductor) return null
  return component.ports[0]?.id ?? null
}

export const useCablePortResolver = () => {
  const connectionScore = (sourceDir: PortDirection, targetDir: PortDirection) => {
    if (sourceDir === 'out' && targetDir === 'in') return 100
    if (sourceDir === 'out' && targetDir === 'bidirectional') return 95
    if (sourceDir === 'bidirectional' && targetDir === 'in') return 85
    if (sourceDir === 'bidirectional' && targetDir === 'bidirectional') return 70
    return null
  }

  const cableMatchesEndpoints = (cable: Cable, endpoints: CableEndpoints) => {
    // Same physical cable must be considered duplicate regardless of endpoint order.
    // This prevents adding the exact same link twice while still allowing a second
    // cable between the same components if it uses different ports (POS vs NEG).
    const sameDirection =
      cable.from.nodeId === endpoints.from.nodeId &&
      cable.from.portId === endpoints.from.portId &&
      cable.to.nodeId === endpoints.to.nodeId &&
      cable.to.portId === endpoints.to.portId

    const reverseDirection =
      cable.from.nodeId === endpoints.to.nodeId &&
      cable.from.portId === endpoints.to.portId &&
      cable.to.nodeId === endpoints.from.nodeId &&
      cable.to.portId === endpoints.from.portId

    return sameDirection || reverseDirection
  }

  const resolvePreferredEndpoints = (
    componentA: ComponentInstance,
    componentB: ComponentInstance,
    existingCables: Cable[] = [],
    preferredConductor?: CableConductorChoice,
  ): CableEndpoints | null => {
    let best: CableEndpoints | null = null

    const consider = (
      score: number,
      fromNodeId: string,
      fromPortId: string,
      toNodeId: string,
      toPortId: string,
    ) => {
      const candidate: CableEndpoints = {
        score,
        from: { nodeId: fromNodeId, portId: fromPortId },
        to: { nodeId: toNodeId, portId: toPortId },
      }
      if (existingCables.some((cable) => cableMatchesEndpoints(cable, candidate))) return
      if (best && score <= best.score) return
      best = candidate
    }

    componentA.ports.forEach((portA) => {
      componentB.ports.forEach((portB) => {
        if (portA.domain !== portB.domain || portA.conductor !== portB.conductor) return
        if (preferredConductor && portA.conductor !== preferredConductor) return

        const forwardScore = connectionScore(portA.dir, portB.dir)
        if (forwardScore !== null) {
          consider(forwardScore, componentA.id, portA.id, componentB.id, portB.id)
        }

        const reverseScore = connectionScore(portB.dir, portA.dir)
        if (reverseScore !== null) {
          consider(reverseScore, componentB.id, portB.id, componentA.id, portA.id)
        }
      })
    })

    if (best) return best

    const fallbackFromPortId = pickPreferredPortId(componentA, 'out', preferredConductor)
    const fallbackToPortId = pickPreferredPortId(componentB, 'in', preferredConductor)
    if (!fallbackFromPortId || !fallbackToPortId) return null
    const fallback: CableEndpoints = {
      score: 0,
      from: { nodeId: componentA.id, portId: fallbackFromPortId },
      to: { nodeId: componentB.id, portId: fallbackToPortId },
    }
    if (existingCables.some((cable) => cableMatchesEndpoints(cable, fallback))) return null
    return fallback
  }

  const resolveAvailableConductors = (
    componentA: ComponentInstance,
    componentB: ComponentInstance,
    existingCables: Cable[] = [],
  ): CableConductorChoice[] => {
    const choices: CableConductorChoice[] = []
    ;(['POS', 'NEG'] as const).forEach((conductor) => {
      const endpoints = resolvePreferredEndpoints(componentA, componentB, existingCables, conductor)
      if (!endpoints) return
      choices.push(conductor)
    })
    return choices
  }

  return {
    resolvePreferredEndpoints,
    resolveAvailableConductors,
  }
}
