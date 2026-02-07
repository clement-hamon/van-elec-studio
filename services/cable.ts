import type { CableDerived, CableProps } from '~/types/schema'

const COPPER_RESISTIVITY = 1.724e-8

const AWG_MIN = 0
const AWG_MAX = 40

export const clampAwg = (awg: number) => Math.min(Math.max(Math.round(awg), AWG_MIN), AWG_MAX)

const awgToDiameterMeters = (awg: number) => {
  const awgValue = clampAwg(awg)
  const diameterInches = 0.005 * Math.pow(92, (36 - awgValue) / 39)
  return diameterInches * 0.0254
}

const awgToAreaMeters2 = (awg: number) => {
  const diameter = awgToDiameterMeters(awg)
  return Math.PI * Math.pow(diameter / 2, 2)
}

export const awgToMm2 = (awg: number) => awgToAreaMeters2(awg) * 1_000_000

export const resistancePerMeter = (awg: number) => {
  const area = awgToAreaMeters2(awg)
  if (area === 0) return 0
  return COPPER_RESISTIVITY / area
}

export const estimateAmpacityForAwg = (awg: number) => {
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
  const resistance = resistancePerMeter(props.gaugeAwg)
  const loopResistance = resistance * length * 2
  const voltageDrop = loopResistance * expectedCurrentA

  return {
    ampacityA: estimateAmpacityForAwg(props.gaugeAwg),
    expectedCurrentA,
    expectedPowerW,
    circuitVoltageV,
    resistanceOhmPerM: resistance,
    loopResistanceOhm: loopResistance,
    voltageDropV: voltageDrop,
  }
}

const awgValues = Array.from({ length: AWG_MAX - AWG_MIN + 1 }, (_, i) => AWG_MIN + i)

export const findRequiredAwgForCurrent = (currentA: number) => {
  const current = Math.max(0, currentA)
  for (let i = awgValues.length - 1; i >= 0; i -= 1) {
    const awg = awgValues[i]
    if (estimateAmpacityForAwg(awg) >= current) return awg
  }
  return AWG_MIN
}

export const voltageDropForAwg = (awg: number, lengthM: number, currentA: number) => {
  const resistance = resistancePerMeter(awg)
  return resistance * Math.max(0, lengthM) * 2 * Math.max(0, currentA)
}

export const findRequiredAwgForVoltageDrop = (
  maxDropV: number,
  lengthM: number,
  currentA: number,
) => {
  const limit = Math.max(0, maxDropV)
  for (let i = awgValues.length - 1; i >= 0; i -= 1) {
    const awg = awgValues[i]
    const drop = voltageDropForAwg(awg, lengthM, currentA)
    if (drop <= limit) return awg
  }
  return AWG_MIN
}
