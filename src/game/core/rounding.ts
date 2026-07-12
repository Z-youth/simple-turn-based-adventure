function normalizeNegativeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value
}

export function roundIntegerResult(value: number): number {
  const rounded = value >= 0
    ? Math.floor(value + 0.5)
    : Math.ceil(value - 0.5)

  return normalizeNegativeZero(rounded)
}

export function roundDecimalResult(value: number): number {
  return normalizeNegativeZero(roundIntegerResult(value * 10) / 10)
}

export function clampMinimum(value: number, minimum: number): number {
  return Math.max(value, minimum)
}

export function clampProbabilityForRoll(value: number): number {
  return Math.min(1, clampMinimum(value, 0))
}
