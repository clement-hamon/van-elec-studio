import type { SchemaState, ComponentType } from '~/types/schema'
import type { CircuitGraph, LogicalNeighbor, LogicalNet, Net } from './types'

const unique = <T>(items: T[]) => Array.from(new Set(items))

const collectNodeDomains = (type: ComponentType | undefined) => {
  if (!type?.ports) return []
  return unique(type.ports.map((port) => port.domain))
}

const isPassThroughType = (type: ComponentType | undefined) => {
  if (!type) return false
  if (type.passThrough === true) return true
  if (type.passThrough === false) return false
  if (type.energyRole === 'protection' || type.energyRole === 'distribution') return true
  if (type.category === 'distribution') return true
  return false
}

export const buildGraph = (schema: SchemaState, registry: ComponentType[]): CircuitGraph => {
  const nodesById = new Map(schema.components.map((component) => [component.id, component]))
  const edgesById = new Map(schema.cables.map((cable) => [cable.id, cable]))
  const typesById = new Map(registry.map((type) => [type.id, type]))

  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  const adjacency = new Map<string, { neighborId: string; edgeId: string }[]>()

  const addEdge = (fromId: string, toId: string, edgeId: string) => {
    const out = outgoing.get(fromId) ?? []
    out.push(toId)
    outgoing.set(fromId, out)

    const inc = incoming.get(toId) ?? []
    inc.push(fromId)
    incoming.set(toId, inc)

    const adjFrom = adjacency.get(fromId) ?? []
    adjFrom.push({ neighborId: toId, edgeId })
    adjacency.set(fromId, adjFrom)

    const adjTo = adjacency.get(toId) ?? []
    adjTo.push({ neighborId: fromId, edgeId })
    adjacency.set(toId, adjTo)
  }

  schema.cables.forEach((cable) => {
    if (!nodesById.has(cable.sourceId) || !nodesById.has(cable.targetId)) return
    addEdge(cable.sourceId, cable.targetId, cable.id)
  })

  const nodeDomains = new Map<string, string[]>()
  schema.components.forEach((component) => {
    const type = typesById.get(component.typeId)
    nodeDomains.set(component.id, collectNodeDomains(type))
  })

  const nets: Net[] = []
  const visited = new Set<string>()

  schema.components.forEach((component) => {
    if (visited.has(component.id)) return
    const nodeIds: string[] = []
    const edgeIds: Set<string> = new Set()
    const domains: string[] = []

    const queue = [component.id]
    visited.add(component.id)

    while (queue.length) {
      const current = queue.shift()
      if (!current) continue
      nodeIds.push(current)

      const nodeDomain = nodeDomains.get(current) ?? []
      nodeDomain.forEach((domain) => domains.push(domain))

      const adj = adjacency.get(current) ?? []
      adj.forEach((entry) => {
        edgeIds.add(entry.edgeId)
        if (!visited.has(entry.neighborId)) {
          visited.add(entry.neighborId)
          queue.push(entry.neighborId)
        }
      })
    }

  nets.push({
      id: `net-${nets.length + 1}`,
      nodeIds,
      edgeIds: Array.from(edgeIds),
      domains: unique(domains),
    })
  })

  const logicalNodeIds = schema.components
    .filter((component) => {
      const type = typesById.get(component.typeId)
      return !isPassThroughType(type)
    })
    .map((component) => component.id)

  const logicalNeighbors = new Map<string, LogicalNeighbor[]>()

  logicalNodeIds.forEach((startId) => {
    const results: LogicalNeighbor[] = []
    const visited = new Set<string>([startId])
    const queue: LogicalNeighbor[] = []

    const startAdj = adjacency.get(startId) ?? []
    startAdj.forEach((entry) => {
      queue.push({
        nodeId: entry.neighborId,
        pathNodeIds: [startId, entry.neighborId],
        pathEdgeIds: [entry.edgeId],
      })
    })

    while (queue.length) {
      const current = queue.shift()
      if (!current || visited.has(current.nodeId)) continue
      visited.add(current.nodeId)

      const node = nodesById.get(current.nodeId)
      const type = node ? typesById.get(node.typeId) : undefined
      if (isPassThroughType(type)) {
        const nextAdj = adjacency.get(current.nodeId) ?? []
        nextAdj.forEach((entry) => {
          if (visited.has(entry.neighborId)) return
          queue.push({
            nodeId: entry.neighborId,
            pathNodeIds: [...current.pathNodeIds, entry.neighborId],
            pathEdgeIds: [...current.pathEdgeIds, entry.edgeId],
          })
        })
        continue
      }

      results.push(current)
    }

    const uniqueResults = new Map<string, LogicalNeighbor>()
    results.forEach((entry) => {
      if (!uniqueResults.has(entry.nodeId)) uniqueResults.set(entry.nodeId, entry)
    })
    logicalNeighbors.set(startId, Array.from(uniqueResults.values()))
  })

  const logicalAdjacency = new Map<string, string[]>()
  logicalNodeIds.forEach((nodeId) => {
    const neighbors = logicalNeighbors.get(nodeId) ?? []
    logicalAdjacency.set(
      nodeId,
      unique(neighbors.map((neighbor) => neighbor.nodeId)),
    )
  })

  const logicalNets: LogicalNet[] = []
  const logicalVisited = new Set<string>()

  logicalNodeIds.forEach((nodeId) => {
    if (logicalVisited.has(nodeId)) return
    const queue = [nodeId]
    const nodeIds: string[] = []
    logicalVisited.add(nodeId)

    while (queue.length) {
      const current = queue.shift()
      if (!current) continue
      nodeIds.push(current)

      const neighbors = logicalAdjacency.get(current) ?? []
      neighbors.forEach((neighborId) => {
        if (logicalVisited.has(neighborId)) return
        logicalVisited.add(neighborId)
        queue.push(neighborId)
      })
    }

    logicalNets.push({
      id: `logical-net-${logicalNets.length + 1}`,
      nodeIds,
    })
  })

  return {
    nodes: schema.components,
    edges: schema.cables,
    nodesById,
    edgesById,
    typesById,
    outgoing,
    incoming,
    adjacency,
    nodeDomains,
    nets,
    logicalNodeIds,
    logicalNeighbors,
    logicalAdjacency,
    logicalNets,
  }
}
