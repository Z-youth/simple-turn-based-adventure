import { clampProbabilityForRoll } from './rounding'

export interface SeededRandomState {
  readonly kind: 'seeded'
  readonly seed: number
  readonly cursor: number
}

export interface FixedSequenceRandomState {
  readonly kind: 'fixedSequence'
  readonly values: readonly number[]
  readonly cursor: number
}

export type RandomState = SeededRandomState | FixedSequenceRandomState

export interface RandomReadResult {
  readonly value: number
  readonly state: RandomState
}

export interface ProbabilityRollResult {
  readonly rolled: boolean
  readonly consumed: boolean
  readonly randomValue: number | null
  readonly state: RandomState
}

export type RandomStateValidationErrorCode =
  | 'INVALID_RANDOM_SEED'
  | 'INVALID_RANDOM_CURSOR'
  | 'INVALID_RANDOM_SEQUENCE'

export interface RandomSource {
  /** Returns a value in the half-open interval [0, 1). */
  next(): number
}

function assertRandomValue(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('Random values must be finite and in the range [0, 1).')
  }
}

function assertSeed(seed: number): void {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('Random seed must be an unsigned 32-bit integer.')
  }
}

export function validateRandomState(
  state: RandomState,
): RandomStateValidationErrorCode | null {
  if (
    !Number.isSafeInteger(state.cursor)
    || state.cursor < 0
    || state.cursor >= Number.MAX_SAFE_INTEGER
  ) {
    return 'INVALID_RANDOM_CURSOR'
  }
  if (state.kind === 'seeded') {
    return Number.isSafeInteger(state.seed)
      && state.seed >= 0
      && state.seed <= 0xffffffff
      ? null
      : 'INVALID_RANDOM_SEED'
  }
  if (
    state.cursor > state.values.length
    || state.values.some((value) => (
      !Number.isFinite(value) || value < 0 || value >= 1
    ))
  ) {
    return 'INVALID_RANDOM_SEQUENCE'
  }
  return null
}

function assertRandomState(state: RandomState): void {
  const invalid = validateRandomState(state)
  if (invalid !== null) throw new RangeError(invalid)
}

export function createSeededRandomState(seed: number): SeededRandomState {
  assertSeed(seed)
  return { kind: 'seeded', seed, cursor: 0 }
}

export function createFixedSequenceRandomState(
  values: readonly number[],
): FixedSequenceRandomState {
  values.forEach(assertRandomValue)
  return { kind: 'fixedSequence', values: [...values], cursor: 0 }
}

export function readRandomValue(state: RandomState): RandomReadResult {
  assertRandomState(state)
  if (state.kind === 'fixedSequence') {
    if (state.cursor >= state.values.length) {
      throw new RangeError('Fixed random sequence is exhausted.')
    }

    return {
      value: state.values[state.cursor],
      state: { ...state, cursor: state.cursor + 1 },
    }
  }

  const nextSeed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0
  return {
    value: nextSeed / 0x100000000,
    state: {
      kind: 'seeded',
      seed: nextSeed,
      cursor: state.cursor + 1,
    },
  }
}

export function rollProbabilityFromState(
  probability: number,
  state: RandomState,
): ProbabilityRollResult {
  assertRandomState(state)
  if (!Number.isFinite(probability)) {
    throw new RangeError('Probability must be finite.')
  }
  const clamped = clampProbabilityForRoll(probability)
  if (clamped === 0) {
    return {
      rolled: false,
      consumed: false,
      randomValue: null,
      state,
    }
  }
  if (clamped === 1) {
    return {
      rolled: true,
      consumed: false,
      randomValue: null,
      state,
    }
  }

  const read = readRandomValue(state)
  return {
    rolled: read.value < clamped,
    consumed: true,
    randomValue: read.value,
    state: read.state,
  }
}

export function createBrowserRandomSource(): RandomSource {
  return {
    next() {
      const value = new Uint32Array(1)
      globalThis.crypto.getRandomValues(value)
      return value[0] / 0x100000000
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
