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
  fieldMaxInputVoltage,
  fieldMaxOutputCurrentA,
  fieldMaxOutputW,
  fieldMaxVoltage,
  fieldOperationalVoltage,
  fieldOutputVoltage,
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
    type: 'battery',
    defaultParams: {
      nominalV: 12,
      operationalV: 12,
      maxVoltageV: 14.4,
      capacityAh: 200,
      maxChargeA: 75,
      maxDischargeA: 120,
    },
    fields: [
      fieldVoltage,
      fieldOperationalVoltage,
      fieldMaxVoltage,
      fieldCapacityAh,
      fieldMaxChargeCurrentA,
      fieldMaxDischargeCurrentA
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
    type: 'distribution',
    defaultParams: { ratingA: 60 },
    fields: [fieldRatingA],
    ports: [
      { id: 'in', label: 'In', direction: 'in', domain: 'dc', conductor: 'POS' },
      { id: 'out', label: 'Out', direction: 'out', domain: 'dc', conductor: 'POS' },
    ],
  },
  {
    id: 'switch',
    label: 'Switch',
    description:
      'Manual DC circuit switch for isolating or controlling a branch. Place on a protected line and size by expected branch current.',
    type: 'distribution',
    defaultParams: { ratingA: 20 },
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
    defaultParams: { maxOutW: 1000, maxInputV: 15, outputV: 230, efficiency: 0.9 },
    fields: [fieldMaxOutputW, fieldMaxInputVoltage, fieldOutputVoltage, fieldEfficiency],
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
    ports: [
      { id: 'dc-in', label: 'DC +', direction: 'in', domain: 'dc', conductor: 'POS' },
      { id: 'dc-neg', label: 'DC -', direction: 'out', domain: 'dc', conductor: 'NEG' },
    ],
  },
  {
    id: 'light-bar',
    label: 'Light Bar',
    description:
      'Higher-power DC lighting load. Use a properly fused branch circuit and adequate wire gauge.',
    type: 'load',
    defaultParams: { watts: 36, dutyCycle: 1, lumens: 3000 },
    fields: [fieldWatt, fieldDutyCycle, fieldLumens],
    ports: [
      { id: 'dc-in', label: 'DC +', direction: 'in', domain: 'dc', conductor: 'POS' },
      { id: 'dc-neg', label: 'DC -', direction: 'out', domain: 'dc', conductor: 'NEG' },
    ],
  },
  {
    id: 'fridge-12v',
    label: '12V Fridge',
    description:
      '12V refrigeration load for food storage. Run on a protected DC branch and size wiring for continuous operation duty cycles.',
    type: 'load',
    defaultParams: { watts: 50, dutyCycle: 1 },
    fields: [fieldWatt, fieldDutyCycle],
    ports: [
      { id: 'dc-in', label: 'DC +', direction: 'in', domain: 'dc', conductor: 'POS' },
      { id: 'dc-neg', label: 'DC -', direction: 'out', domain: 'dc', conductor: 'NEG' },
    ],
  },
  {
    id: 'tv',
    label: 'TV',
    description:
      'Entertainment display load. Connect on a protected DC branch and size wiring for expected viewing duty cycle.',
    type: 'load',
    defaultParams: { watts: 60, dutyCycle: 1 },
    fields: [fieldWatt, fieldDutyCycle],
    ports: [
      { id: 'dc-in', label: 'DC +', direction: 'in', domain: 'dc', conductor: 'POS' },
      { id: 'dc-neg', label: 'DC -', direction: 'out', domain: 'dc', conductor: 'NEG' },
    ],
  },
  {
    id: 'custom-load',
    label: 'Custom Load',
    description:
      'Generic DC load with configurable wattage. Use for any appliance and protect the branch per the expected current.',
    type: 'load',
    defaultParams: { watts: 50, dutyCycle: 1 },
    fields: [fieldWatt, fieldCurrentA, fieldDutyCycle],
    ports: [
      { id: 'dc-in', label: 'DC +', direction: 'in', domain: 'dc', conductor: 'POS' },
      { id: 'dc-neg', label: 'DC -', direction: 'out', domain: 'dc', conductor: 'NEG' },
    ],
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
    id: 'dc-neg-bus',
    label: 'DC NEG Bus',
    description:
      'Negative return distribution node for DC circuits. Use it to collect and route return paths back to battery negative.',
    type: 'distribution',
    defaultParams: { ratingA: 100, maxBranches: 4 },
    fields: [fieldRatingA, fieldMaxBranches],
    ports: [
      { id: 'in', label: 'In', direction: 'in', domain: 'dc', conductor: 'NEG' },
      { id: 'out-1', label: 'Out 1', direction: 'out', domain: 'dc', conductor: 'NEG' },
      { id: 'out-2', label: 'Out 2', direction: 'out', domain: 'dc', conductor: 'NEG' },
      { id: 'out-3', label: 'Out 3', direction: 'out', domain: 'dc', conductor: 'NEG' },
      { id: 'out-4', label: 'Out 4', direction: 'out', domain: 'dc', conductor: 'NEG' },
    ],
  },
  {
    id: 'solar-panel',
    label: 'Solar Panel',
    description:
      'DC source that converts sunlight to electrical power. Connect to a charge controller input; do not connect directly to batteries.',
    type: 'source',
    defaultParams: { availableW: 200, outputV: 18 },
    fields: [fieldAvailableW, fieldOutputVoltage],
    ports: [{ id: 'dc-out', label: 'DC Out', direction: 'out', domain: 'dc', conductor: 'POS' }],
  },
  {
    id: 'charge-controller',
    label: 'Charge Controller',
    description:
      'Regulates solar input to a safe battery charge profile. Connect solar panels to its input and the battery to its output; protect both sides per current limits.',
    type: 'conversion',
    defaultParams: { controllerType: 'mppt', maxOutA: 30, maxInputV: 50, outputV: 14.4, efficiency: 0.95 },
    fields: [
      fieldControllerType,
      fieldMaxInputVoltage,
      fieldOutputVoltage,
      fieldMaxOutputCurrentA,
      fieldEfficiency
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
    type: 'source',
    defaultParams: { maxOutA: 120, outputV: 14.4 },
    fields: [fieldMaxOutputCurrentA, fieldOutputVoltage],
    ports: [{ id: 'dc-out', label: 'DC Out', direction: 'out', domain: 'dc', conductor: 'POS' }],
  },
  {
    id: 'dc-dc-charger',
    label: 'DC-DC Charger',
    description:
      'Regulates DC input to a battery charge profile. Place between alternator (or other DC source) and the battery; fuse input and output.',
    type: 'conversion',
    defaultParams: { maxOutA: 40, maxInputV: 32, outputV: 14.4, efficiency: 0.9 },
    fields: [fieldMaxInputVoltage, fieldOutputVoltage, fieldMaxOutputCurrentA, fieldEfficiency],
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
    defaultParams: { availableW: 2000, outputV: 230 },
    fields: [fieldAvailableW, fieldOutputVoltage],
    ports: [{ id: 'ac-out', label: 'AC Out', direction: 'out', domain: 'ac', conductor: 'L' }],
  },
  {
    id: 'ac-dc-charger',
    label: 'AC-DC Charger',
    description:
      'Converts AC input to regulated DC for battery charging. Connect shore inlet to AC input and battery to DC output with appropriate fusing.',
    type: 'conversion',
    defaultParams: { maxOutA: 40, maxInputV: 265, outputV: 14.4, efficiency: 0.9 },
    fields: [fieldMaxInputVoltage, fieldOutputVoltage, fieldMaxOutputCurrentA, fieldEfficiency],
    ports: [
      { id: 'ac-in', label: 'AC In', direction: 'in', domain: 'ac', conductor: 'L' },
      { id: 'dc-out', label: 'DC Out', direction: 'out', domain: 'dc', conductor: 'POS' },
    ],
  },
]
