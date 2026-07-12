import { clampProbabilityForRoll } from './rounding'

export interface RandomSource {
  /** Returns a value in the half-open interval [0, 1). */
  next(): number
}

function assertRandomValue(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('Random values must be finite and in the range [0, 1).')
  }
}

export function createBrowserRandomSource(): RandomSource {
  return {
    next() {
      return Math.random()
    },
  }
}

export function createFixedSequenceRandomSource(
  values: readonly number[],
): RandomSource {
  values.forEach(assertRandomValue)
  let currentIndex = 0

  return {
    next() {
      if (currentIndex >= values.length) {
        throw new RangeError('Fixed random sequence is exhausted.')
      }

      const value = values[currentIndex]
      currentIndex += 1
      return value
    },
  }
}

export function rollProbability(
  probability: number,
  randomSource: RandomSource,
): boolean {
  return randomSource.next() < clampProbabilityForRoll(probability)
}
