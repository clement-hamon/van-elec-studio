import type { ComponentType } from '~/types/schema'
import {
  fieldCapacityAh,
  fieldMaxChargeCurrentA,
  fieldContinuousW,
  fieldControllerType,
  fieldCurrentA,
  fieldInputVoltage,
  fieldInputVoltageSelect,
  fieldLumens,
  fieldMaxInputCurrentA,
  fieldMaxInputVoltage,
  fieldMaxOutputCurrentA,
  fieldMaxBranches,
  fieldOperatingVoltage,
  fieldOutputVoltage,
  fieldRatedCurrentA,
  fieldRatingA,
  fieldRecommendedChargeCurrentA,
  fieldVoltage,
  fieldWatt,
} from './definitions'

export const componentRegistry: ComponentType[] = [
  {
    id: 'battery',
    label: 'Battery',
    description:
      'Stores DC energy and supplies power to loads. Integrate on the main DC bus with a main fuse and proper cable sizing; connect chargers through regulated charge paths.',
    nodeType: 'storage',
    defaultProps: {
      outputVoltage: 12,
      maxInputVoltage: 14.6,
      capacityAh: 200,
      recommendedChargeCurrentA: 45,
      maxChargeCurrentA: 75,
    },
    fields: [
      fieldOutputVoltage,
      fieldMaxInputVoltage,
      fieldCapacityAh,
      fieldRecommendedChargeCurrentA,
      fieldMaxChargeCurrentA,
    ],
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
    nodeType: 'distribution',
    defaultProps: { ratingA: 60, operatingVoltage: 12 },
    fields: [fieldRatingA, fieldOperatingVoltage],
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
    nodeType: 'conversion',
    defaultProps: { inputVoltage: 12, outputVoltage: 230, operatingVoltage: 12, continuousW: 1000 },
    fields: [fieldInputVoltage, fieldOutputVoltage, fieldOperatingVoltage, fieldContinuousW],
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
    nodeType: 'load',
    defaultProps: { operatingVoltage: 12, watt: 6, lumens: 500 },
    fields: [fieldOperatingVoltage, fieldWatt, fieldLumens],
    ports: [{ id: 'dc-in', label: 'DC In', direction: 'in', domain: 'dc', conductor: 'POS' }],
  },
  {
    id: 'light-bar',
    label: 'Light Bar',
    description:
      'Higher-power DC lighting load. Use a properly fused branch circuit and adequate wire gauge.',
    nodeType: 'load',
    defaultProps: { operatingVoltage: 12, watt: 36, lumens: 3000 },
    fields: [fieldOperatingVoltage, fieldWatt, fieldLumens],
    ports: [{ id: 'dc-in', label: 'DC In', direction: 'in', domain: 'dc', conductor: 'POS' }],
  },
  {
    id: 'custom-load',
    label: 'Custom Load',
    description:
      'Generic DC load with configurable wattage. Use for any appliance and protect the branch per the expected current.',
    nodeType: 'load',
    defaultProps: { operatingVoltage: 12, watt: 50 },
    fields: [fieldOperatingVoltage, fieldWatt],
    ports: [{ id: 'dc-in', label: 'DC In', direction: 'in', domain: 'dc', conductor: 'POS' }],
  },
  {
    id: 'dc-bus',
    label: 'DC Bus',
    description:
      'Distribution node for splitting DC power to multiple branches. Feed with a protected main line and fuse each outgoing branch.',
    nodeType: 'distribution',
    defaultProps: { operatingVoltage: 12, maxBranches: 4 },
    fields: [fieldOperatingVoltage, fieldMaxBranches],
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
    nodeType: 'source',
    defaultProps: { watt: 200, voltage: 18 },
    fields: [fieldWatt, fieldVoltage, fieldCurrentA],
    ports: [{ id: 'dc-out', label: 'DC Out', direction: 'out', domain: 'dc', conductor: 'POS' }],
  },
  {
    id: 'charge-controller',
    label: 'Charge Controller',
    description:
      'Regulates solar input to a safe battery charge profile. Connect solar panels to its input and the battery to its output; protect both sides per current limits.',
    nodeType: 'conversion',
    defaultProps: {
      controllerType: 'mppt',
      maxInputVoltage: 100,
      maxInputCurrentA: 15,
      maxOutputCurrentA: 30,
      outputVoltage: 14.4,
    },
    fields: [
      fieldControllerType,
      fieldMaxInputVoltage,
      fieldMaxInputCurrentA,
      fieldMaxOutputCurrentA,
      fieldOutputVoltage,
    ],
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
    nodeType: 'source',
    defaultProps: { ratedCurrentA: 120, voltage: 14.4 },
    fields: [fieldRatedCurrentA, fieldVoltage],
    ports: [{ id: 'dc-out', label: 'DC Out', direction: 'out', domain: 'dc', conductor: 'POS' }],
  },
  {
    id: 'dc-dc-charger',
    label: 'DC-DC Charger',
    description:
      'Regulates DC input to a battery charge profile. Place between alternator (or other DC source) and the battery; fuse input and output.',
    nodeType: 'conversion',
    defaultProps: { maxOutputCurrentA: 40, inputVoltage: 17, outputVoltage: 12 },
    fields: [fieldMaxOutputCurrentA, fieldInputVoltage, fieldOutputVoltage],
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
    nodeType: 'source',
    defaultProps: { inputVoltage: 230 },
    fields: [fieldInputVoltageSelect],
    ports: [{ id: 'ac-out', label: 'AC Out', direction: 'out', domain: 'ac', conductor: 'L' }],
  },
  {
    id: 'ac-dc-charger',
    label: 'AC-DC Charger',
    description:
      'Converts AC input to regulated DC for battery charging. Connect shore inlet to AC input and battery to DC output with appropriate fusing.',
    nodeType: 'conversion',
    defaultProps: { maxOutputCurrentA: 40, inputVoltage: 230, outputVoltage: 14.4 },
    fields: [fieldInputVoltageSelect, fieldOutputVoltage, fieldMaxOutputCurrentA],
    ports: [
      { id: 'ac-in', label: 'AC In', direction: 'in', domain: 'ac', conductor: 'L' },
      { id: 'dc-out', label: 'DC Out', direction: 'out', domain: 'dc', conductor: 'POS' },
    ],
  },
]
