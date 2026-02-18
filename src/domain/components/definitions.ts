import type { ComponentFieldDefinition } from '~/types/schema'

export const fieldVoltage: ComponentFieldDefinition = {
  key: 'nominalV',
  label: 'Nominal Voltage (V)',
  type: 'number',
  step: 0.1,
}

export const fieldOperationalVoltage: ComponentFieldDefinition = {
  key: 'operationalV',
  label: 'Operational Voltage (V)',
  type: 'number',
  step: 0.1,
}

export const fieldMaxVoltage: ComponentFieldDefinition = {
  key: 'maxVoltageV',
  label: 'Max Voltage (V)',
  type: 'number',
  step: 0.1,
}

export const fieldMaxInputVoltage: ComponentFieldDefinition = {
  key: 'maxInputV',
  label: 'Max Input Voltage (V)',
  type: 'number',
  step: 0.1,
}

export const fieldOutputVoltage: ComponentFieldDefinition = {
  key: 'outputV',
  label: 'Output Voltage (V)',
  type: 'number',
  step: 0.1,
}

export const fieldCapacityAh: ComponentFieldDefinition = {
  key: 'capacityAh',
  label: 'Capacity (Ah)',
  type: 'number',
  step: 1,
}

export const fieldMaxChargeCurrentA: ComponentFieldDefinition = {
  key: 'maxChargeA',
  label: 'Max Charge Current (A)',
  type: 'number',
  step: 1,
}

export const fieldMaxDischargeCurrentA: ComponentFieldDefinition = {
  key: 'maxDischargeA',
  label: 'Max Discharge Current (A)',
  type: 'number',
  step: 1,
}

export const fieldWatt: ComponentFieldDefinition = {
  key: 'watts',
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
  key: 'amps',
  label: 'Current (A)',
  type: 'number',
  step: 0.1,
}

export const fieldDutyCycle: ComponentFieldDefinition = {
  key: 'dutyCycle',
  label: 'Duty Cycle (0-1)',
  type: 'number',
  step: 0.05,
}

export const fieldAvailableW: ComponentFieldDefinition = {
  key: 'availableW',
  label: 'Available Power (W)',
  type: 'number',
  step: 1,
}

export const fieldMaxOutputCurrentA: ComponentFieldDefinition = {
  key: 'maxOutA',
  label: 'Max Output Current (A)',
  type: 'number',
  step: 0.1,
}

export const fieldMaxOutputW: ComponentFieldDefinition = {
  key: 'maxOutW',
  label: 'Max Output Power (W)',
  type: 'number',
  step: 1,
}

export const fieldEfficiency: ComponentFieldDefinition = {
  key: 'efficiency',
  label: 'Efficiency (0-1)',
  type: 'number',
  step: 0.01,
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
