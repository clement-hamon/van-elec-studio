import type { ComponentFieldDefinition } from '~/types/schema'

export const fieldVoltage: ComponentFieldDefinition = {
  key: 'voltage',
  label: 'Voltage (V)',
  type: 'number',
  step: 0.1,
}

export const fieldOperatingVoltage: ComponentFieldDefinition = {
  key: 'operatingVoltage',
  label: 'Operating Voltage (V)',
  type: 'number',
  step: 0.1,
}

export const fieldCapacityAh: ComponentFieldDefinition = {
  key: 'capacityAh',
  label: 'Capacity (Ah)',
  type: 'number',
  step: 1,
}

export const fieldWatt: ComponentFieldDefinition = {
  key: 'watt',
  label: 'Power (W)',
  type: 'number',
  step: 1,
}

export const fieldLumens: ComponentFieldDefinition = {
  key: 'lumens',
  label: 'Lumens',
  type: 'number',
  step: 1,
}

export const fieldRatingA: ComponentFieldDefinition = {
  key: 'ratingA',
  label: 'Rating (A)',
  type: 'number',
  step: 1,
}

export const fieldCurrentA: ComponentFieldDefinition = {
  key: 'currentA',
  label: 'Current (A)',
  type: 'number',
  step: 0.1,
}

export const fieldRatedCurrentA: ComponentFieldDefinition = {
  key: 'ratedCurrentA',
  label: 'Rated Current (A)',
  type: 'number',
  step: 1,
}

export const fieldMaxInputVoltage: ComponentFieldDefinition = {
  key: 'maxInputVoltage',
  label: 'Max Input Voltage (V)',
  type: 'number',
  step: 0.1,
}

export const fieldMaxInputCurrentA: ComponentFieldDefinition = {
  key: 'maxInputCurrentA',
  label: 'Max Input Current (A)',
  type: 'number',
  step: 0.1,
}

export const fieldMaxOutputCurrentA: ComponentFieldDefinition = {
  key: 'maxOutputCurrentA',
  label: 'Max Output Current (A)',
  type: 'number',
  step: 0.1,
}

export const fieldInputVoltage: ComponentFieldDefinition = {
  key: 'inputVoltage',
  label: 'Input Voltage (V)',
  type: 'number',
  step: 0.1,
}

export const fieldInputVoltageSelect: ComponentFieldDefinition = {
  key: 'inputVoltage',
  label: 'Input Voltage (V)',
  type: 'select',
  options: [
    { label: '120 V', value: 120 },
    { label: '230 V', value: 230 },
  ],
}

export const fieldOutputVoltage: ComponentFieldDefinition = {
  key: 'outputVoltage',
  label: 'Output Voltage (V)',
  type: 'number',
  step: 0.1,
}

export const fieldContinuousW: ComponentFieldDefinition = {
  key: 'continuousW',
  label: 'Continuous Power (W)',
  type: 'number',
  step: 1,
}

export const fieldMaxBranches: ComponentFieldDefinition = {
  key: 'maxBranches',
  label: 'Max Branches',
  type: 'number',
  step: 1,
}

export const fieldControllerType: ComponentFieldDefinition = {
  key: 'controllerType',
  label: 'Controller Type',
  type: 'select',
  options: [
    { label: 'MPPT', value: 'mppt' },
    { label: 'PWM', value: 'pwm' },
  ],
}
