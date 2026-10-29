import type { Weights } from './types'

/** Fixed pilot reference minutes per stop; revise only before held-out evaluation. */
export const REFERENCE_MINUTES = {
  drive: 20,
  late: 15,
  weather: 15,
  parking: 15,
  cold: 120,
} as const

export interface RawTerms {
  drive: number
  late: number
  weather: number
  parking: number
  cold: number
}

export function stopRawTerms(input: {
  driveMinutes: number
  lateMinutes: number
  serviceMinutes: number
  rainSeverity: number
  parkingRisk: number
  cargoSensitivity: number
  onBoardMinutes: number
}): RawTerms {
  return {
    drive: input.driveMinutes,
    late: input.lateMinutes,
    weather: input.rainSeverity * input.serviceMinutes,
    parking: input.parkingRisk * input.serviceMinutes,
    cold: input.cargoSensitivity * input.onBoardMinutes,
  }
}

export function objectiveContribution(raw: RawTerms, stopCount: number, weights: Weights) {
  if (!Number.isInteger(stopCount) || stopCount < 1) throw new Error('A route needs at least one stop')
  return {
    drive: weights.drive * raw.drive / (REFERENCE_MINUTES.drive * stopCount),
    late: weights.late * raw.late / (REFERENCE_MINUTES.late * stopCount),
    weather: weights.weather * raw.weather / (REFERENCE_MINUTES.weather * stopCount),
    parking: weights.parking * raw.parking / (REFERENCE_MINUTES.parking * stopCount),
    cold: weights.cold * raw.cold / (REFERENCE_MINUTES.cold * stopCount),
  }
}
