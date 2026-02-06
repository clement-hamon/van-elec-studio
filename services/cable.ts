import type { CableDerived, CableProps } from '~/types/schema'

const COPPER_RESISTIVITY = 1.724e-8
const ALUMINUM_RESISTIVITY = 2.82e-8

const AWG_MIN = 0
const AWG_MAX = 40

const clampAwg = (awg: number) => Math.min(Math.max(Math.round(awg), AWG_MIN), AWG_MAX)

const awgToDiameterMeters = (awg: number) => {
  const awgValue = clampAwg(awg)
  const diameterInches = 0.005 * Math.pow(92, (36 - awgValue) / 39)
  return diameterInches * 0.0254
}

const awgToAreaMeters2 = (awg: number) => {
  const diameter = awgToDiameterMeters(awg)
  return Math.PI * Math.pow(diameter / 2, 2)
}

const resistancePerMeter = (awg: number, material: CableProps['material']) => {
  const area = awgToAreaMeters2(awg)
  if (area === 0) return 0
  const rho = material === 'aluminum' ? ALUMINUM_RESISTIVITY : COPPER_RESISTIVITY
  return rho / area
}

const estimateAmpacity = (awg: number) => {
  const lookup: Record<number, number> = {
    0: 150,
    1: 130,
    2: 115,
    4: 85,
    6: 65,
    8: 50,
    10: 35,
    12: 25,
    14: 20,
    16: 15,
  }
  const rounded = clampAwg(awg)
  if (lookup[rounded]) return lookup[rounded]
  return Math.max(5, 35 - (rounded - 10) * 2)
}

export const computeCableDerived = (
  props: CableProps,
  expectedCurrentA = 0,
  expectedPowerW = 0,
  circuitVoltageV = 0,
): CableDerived => {
  const length = Math.max(0, props.lengthM)
  const resistance = resistancePerMeter(props.gaugeAwg, props.material)
  const loopResistance = resistance * length * 2
  const voltageDrop = loopResistance * expectedCurrentA

  return {
    ampacityA: estimateAmpacity(props.gaugeAwg),
    expectedCurrentA,
    expectedPowerW,
    circuitVoltageV,
    resistanceOhmPerM: resistance,
    loopResistanceOhm: loopResistance,
    voltageDropV: voltageDrop,
  }
}
