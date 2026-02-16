import type { ComponentType } from '~/types/schema'
import {
  fieldAvailableW,
  fieldCapacityAh,
  fieldControllerType,
  fieldCurrentA,
  fieldDutyCycle,
  fieldEfficiency,
  fieldLumens,
  fieldMaxBranches,
  fieldMaxChargeCurrentA,
  fieldMaxDischargeCurrentA,
  fieldMaxOutputCurrentA,
  fieldMaxOutputW,
  fieldRatingA,
  fieldVoltage,
  fieldWatt,
} from './definitions'

export const componentRegistry: ComponentType[] = [
  {
    id: 'battery',
    label: 'Battery',
    description:
      'Stores DC energy and supplies power to loads. Integrate on the main DC bus with a main fuse and proper cable sizing; connect chargers through regulated charge paths.',
    type: 'storage',
    defaultParams: {
      nominalV: 12,
      capacityAh: 200,
      maxChargeA: 75,
      maxDischargeA: 120,
    },
    fields: [fieldVoltage, fieldCapacityAh, fieldMaxChargeCurrentA, fieldMaxDischargeCurrentA],
    ports: [
      { id: 'positive', label: '+', direction: 'bidirectional', domain: 'dc', conductor: 'POS' },
      { id: 'negative', label: '-', direction: 'bidirectional', domain: 'dc', conductor: 'NEG' },
    ],
  },
  {
    id: 'fuse',
    label: 'Fuse',
    description:
      'Overcurrent protection for a single circuit. Place close to the power source and size to protect the downstream cable and equipment.',
    type: 'distribution',
    defaultParams: { ratingA: 60 },
    fields: [fieldRatingA],
    ports: [
      { id: 'in', label: 'In', direction: 'in', domain: 'dc', conductor: 'POS' },
      { id: 'out', label: 'Out', direction: 'out', domain: 'dc', conductor: 'POS' },
    ],
  },
  {
    id: 'inverter',
    label: 'Inverter',
    description:
      'Converts DC to AC for AC loads. Feed from a protected DC source and route AC output to your AC distribution panel.',
    type: 'conversion',
    defaultParams: { maxOutW: 1000, efficiency: 0.9 },
    fields: [fieldMaxOutputW, fieldEfficiency],
    ports: [
      { id: 'dc-in', label: 'DC In', direction: 'in', domain: 'dc', conductor: 'POS' },
      { id: 'ac-out', label: 'AC Out', direction: 'out', domain: 'ac', conductor: 'L' },
    ],
  },
  {
    id: 'led-light',
    label: 'LED Light',
    description:
      'Low-power DC lighting load. Connect on a protected DC branch sized for the fixture current.',
    type: 'load',
    defaultParams: { watts: 6, dutyCycle: 1, lumens: 500 },
    fields: [fieldWatt, fieldDutyCycle, fieldLumens],
    ports: [{ id: 'dc-in', label: 'DC In', direction: 'in', domain: 'dc', conductor: 'POS' }],
  },
  {
    id: 'light-bar',
    label: 'Light Bar',
    description:
      'Higher-power DC lighting load. Use a properly fused branch circuit and adequate wire gauge.',
    type: 'load',
    defaultParams: { watts: 36, dutyCycle: 1, lumens: 3000 },
    fields: [fieldWatt, fieldDutyCycle, fieldLumens],
    ports: [{ id: 'dc-in', label: 'DC In', direction: 'in', domain: 'dc', conductor: 'POS' }],
  },
  {
    id: 'custom-load',
    label: 'Custom Load',
    description:
      'Generic DC load with configurable wattage. Use for any appliance and protect the branch per the expected current.',
    type: 'load',
    defaultParams: { watts: 50, dutyCycle: 1 },
    fields: [fieldWatt, fieldCurrentA, fieldDutyCycle],
    ports: [{ id: 'dc-in', label: 'DC In', direction: 'in', domain: 'dc', conductor: 'POS' }],
  },
  {
    id: 'dc-bus',
    label: 'DC Bus',
    description:
      'Distribution node for splitting DC power to multiple branches. Feed with a protected main line and fuse each outgoing branch.',
    type: 'distribution',
    defaultParams: { ratingA: 100, maxBranches: 4 },
    fields: [fieldRatingA, fieldMaxBranches],
    ports: [
      { id: 'in', label: 'In', direction: 'in', domain: 'dc', conductor: 'POS' },
      { id: 'out-1', label: 'Out 1', direction: 'out', domain: 'dc', conductor: 'POS' },
      { id: 'out-2', label: 'Out 2', direction: 'out', domain: 'dc', conductor: 'POS' },
      { id: 'out-3', label: 'Out 3', direction: 'out', domain: 'dc', conductor: 'POS' },
      { id: 'out-4', label: 'Out 4', direction: 'out', domain: 'dc', conductor: 'POS' },
    ],
  },
  {
    id: 'solar-panel',
    label: 'Solar Panel',
    description:
      'DC source that converts sunlight to electrical power. Connect to a charge controller input; do not connect directly to batteries.',
    type: 'source',
    defaultParams: { availableW: 200 },
    fields: [fieldAvailableW],
    ports: [{ id: 'dc-out', label: 'DC Out', direction: 'out', domain: 'dc', conductor: 'POS' }],
  },
  {
    id: 'charge-controller',
    label: 'Charge Controller',
    description:
      'Regulates solar input to a safe battery charge profile. Connect solar panels to its input and the battery to its output; protect both sides per current limits.',
    type: 'conversion',
    defaultParams: { controllerType: 'mppt', maxOutA: 30, efficiency: 0.95 },
    fields: [fieldControllerType, fieldMaxOutputCurrentA, fieldEfficiency],
    ports: [
      { id: 'dc-in', label: 'DC In', direction: 'in', domain: 'dc', conductor: 'POS' },
      { id: 'dc-out', label: 'DC Out', direction: 'out', domain: 'dc', conductor: 'POS' },
    ],
  },
  {
    id: 'alternator',
    label: 'Alternator',
    description:
      'Engine-driven DC source for charging. Should feed a DC-DC charger before the battery to control current and voltage.',
    type: 'source',
    defaultParams: { maxOutA: 120 },
    fields: [fieldMaxOutputCurrentA],
    ports: [{ id: 'dc-out', label: 'DC Out', direction: 'out', domain: 'dc', conductor: 'POS' }],
  },
  {
    id: 'dc-dc-charger',
    label: 'DC-DC Charger',
    description:
      'Regulates DC input to a battery charge profile. Place between alternator (or other DC source) and the battery; fuse input and output.',
    type: 'conversion',
    defaultParams: { maxOutA: 40, efficiency: 0.9 },
    fields: [fieldMaxOutputCurrentA, fieldEfficiency],
    ports: [
      { id: 'dc-in', label: 'DC In', direction: 'in', domain: 'dc', conductor: 'POS' },
      { id: 'dc-out', label: 'DC Out', direction: 'out', domain: 'dc', conductor: 'POS' },
    ],
  },
  {
    id: 'shore-inlet',
    label: 'Shore Inlet',
    description:
      'AC input from a shore power connection. Feed an AC-DC charger or AC panel; include upstream protection and correct inlet rating.',
    type: 'source',
    defaultParams: { availableW: 2000 },
    fields: [fieldAvailableW],
    ports: [{ id: 'ac-out', label: 'AC Out', direction: 'out', domain: 'ac', conductor: 'L' }],
  },
  {
    id: 'ac-dc-charger',
    label: 'AC-DC Charger',
    description:
      'Converts AC input to regulated DC for battery charging. Connect shore inlet to AC input and battery to DC output with appropriate fusing.',
    type: 'conversion',
    defaultParams: { maxOutA: 40, efficiency: 0.9 },
    fields: [fieldMaxOutputCurrentA, fieldEfficiency],
    ports: [
      { id: 'ac-in', label: 'AC In', direction: 'in', domain: 'ac', conductor: 'L' },
      { id: 'dc-out', label: 'DC Out', direction: 'out', domain: 'dc', conductor: 'POS' },
    ],
  },
]
