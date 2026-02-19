import type { ComponentInstance, ComponentType, Port } from '~/types/schema'

type ComponentPort = Port & { label?: string }

export const buildPortsFromType = (type: ComponentType | undefined): ComponentPort[] => {
  if (!type) return []
  return type.ports.map((port) => ({
    id: port.id,
    domain: port.domain,
    conductor: port.conductor,
    dir: port.direction,
    label: port.label,
  }))
}

export const mergeComponentPortsWithType = (
  component: ComponentInstance,
  type: ComponentType | undefined,
): ComponentPort[] => {
  if (!type) return component.ports

  const existingById = new Map(component.ports.map((port) => [port.id, port] as const))
  const merged = type.ports.map((portDef) => {
    const existing = existingById.get(portDef.id)
    existingById.delete(portDef.id)

    return {
      id: portDef.id,
      domain: portDef.domain,
      conductor: portDef.conductor,
      dir: portDef.direction,
      label: portDef.label ?? existing?.label,
    }
  })

  // Keep unknown legacy ports at the end so older custom data stays loadable.
  const legacyPorts = Array.from(existingById.values()).map((port) => ({ ...port }))
  return [...merged, ...legacyPorts]
}
