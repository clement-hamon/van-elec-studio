import type { ComponentInstance, ComponentType } from '~/types/schema'
import type { CircuitGraph } from '~/src/circuit-graph/types'

export type VoltageRole = 'source' | 'storage' | 'conversion' | 'distribution' | 'load'

const numericProp = (props: Record<string, unknown>, key: string) => {
  const value = props[key]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export const voltageFromDomain = (domain?: string) => {
  if (domain === '12V') return 12
  if (domain === '24V') return 24
  if (domain === '48V') return 48
  return null
}

export const resolveVoltageRole = (type: ComponentType | undefined): VoltageRole | null =>
  type?.category ?? null

export const resolveOutputVoltageFromProps = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
): number | null => {
  if (!component || !type) return null
  const role = resolveVoltageRole(type)
  if (role === 'distribution' || role === 'load') return null
  const props = component.props as Record<string, unknown>
  return (
    numericProp(props, 'outputVoltage') ||
    numericProp(props, 'voltage') ||
    numericProp(props, 'operatingVoltage') ||
    numericProp(props, 'inputVoltage')
  )
}

export const resolveMaxInputVoltageFromProps = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
): number | null => {
  if (!component || !type) return null
  const role = resolveVoltageRole(type)
  if (!role || role === 'source' || role === 'distribution') return null

  const props = component.props as Record<string, unknown>

  if (role === 'storage') {
    return (
      numericProp(props, 'maxInputVoltage') ||
      numericProp(props, 'chargeCutoffVoltage') ||
      numericProp(props, 'recommendedChargeVoltage') ||
      numericProp(props, 'operatingVoltage') ||
      numericProp(props, 'inputVoltage') ||
      numericProp(props, 'voltage')
    )
  }

  if (role === 'conversion') {
    return (
      numericProp(props, 'maxInputVoltage') ||
      numericProp(props, 'inputVoltage') ||
      numericProp(props, 'operatingVoltage') ||
      numericProp(props, 'voltage')
    )
  }

  return (
    numericProp(props, 'maxInputVoltage') ||
    numericProp(props, 'operatingVoltage') ||
    numericProp(props, 'inputVoltage') ||
    numericProp(props, 'voltage')
  )
}

export const resolveLoadVoltage = (
  component: ComponentInstance | undefined,
  type: ComponentType | undefined,
): number | null => {
  const maxInput = resolveMaxInputVoltageFromProps(component, type)
  if (maxInput) return maxInput
  const domain =
    (component?.derived?.voltageDomain as string | undefined) || type?.constraints?.voltageDomain
  return voltageFromDomain(domain)
}

export type VoltageResolver = {
  getRole: (nodeId: string) => VoltageRole | null
  getOutputVoltage: (nodeId: string) => number
  getMaxInputVoltage: (nodeId: string) => number | null
}

export const createVoltageResolver = (graph: CircuitGraph): VoltageResolver => {
  const roleById = new Map<string, VoltageRole | null>()
  const maxInputById = new Map<string, number | null>()
  const outputMemo = new Map<string, number>()
  const visiting = new Set<string>()

  graph.nodes.forEach((node) => {
    const type = graph.typesById.get(node.typeId)
    roleById.set(node.id, resolveVoltageRole(type))
    maxInputById.set(node.id, resolveMaxInputVoltageFromProps(node, type))
  })

  const resolveFallbackVoltage = (node: ComponentInstance | undefined, type: ComponentType | undefined) => {
    const domain =
      (node?.derived?.voltageDomain as string | undefined) || type?.constraints?.voltageDomain
    return voltageFromDomain(domain) ?? 12
  }

  const getOutputVoltage = (nodeId: string): number => {
    if (outputMemo.has(nodeId)) return outputMemo.get(nodeId) ?? 12
    if (visiting.has(nodeId)) return 12
    visiting.add(nodeId)

    const node = graph.nodesById.get(nodeId)
    const type = node ? graph.typesById.get(node.typeId) : undefined
    const role = roleById.get(nodeId)

    let voltage: number | null = null
    if (role === 'distribution') {
      const sources = graph.incoming.get(nodeId) ?? []
      if (sources.length > 0) {
        voltage = sources.reduce((max, sourceId) => Math.max(max, getOutputVoltage(sourceId)), 0)
      }
    }

    if (!voltage) {
      voltage = resolveOutputVoltageFromProps(node, type)
    }

    if (!voltage) {
      voltage = resolveFallbackVoltage(node, type)
    }

    outputMemo.set(nodeId, voltage)
    visiting.delete(nodeId)
    return voltage
  }

  return {
    getRole: (nodeId: string) => roleById.get(nodeId) ?? null,
    getOutputVoltage,
    getMaxInputVoltage: (nodeId: string) => maxInputById.get(nodeId) ?? null,
  }
}
