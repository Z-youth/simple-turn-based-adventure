import { describe, expect, it } from 'vitest'
import {
  createFixedSequenceRandomState,
  createFixedSequenceRandomSource,
  createSeededRandomState,
  readRandomValue,
  rollProbabilityFromState,
  rollProbability,
} from '../game/core/rng'

describe('fixed random source', () => {
  it('replays the same sequence deterministically', () => {
    const first = createFixedSequenceRandomSource([0, 0.25, 0.99])
    const second = createFixedSequenceRandomSource([0, 0.25, 0.99])

    expect([first.next(), first.next(), first.next()]).toEqual([
      second.next(),
      second.next(),
      second.next(),
    ])
  })

  it('throws instead of silently returning a value when exhausted', () => {
    const source = createFixedSequenceRandomSource([0.5])

    expect(source.next()).toBe(0.5)
    expect(() => source.next()).toThrowError('Fixed random sequence is exhausted.')
  })

  it.each([-0.01, 1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an out-of-range value: %s',
    (value) => {
      expect(() => createFixedSequenceRandomSource([value])).toThrow(RangeError)
    },
  )

  it('uses the clamped probability for rolls', () => {
    const source = createFixedSequenceRandomSource([0.99, 0])

    expect(rollProbability(1.3, source)).toBe(true)
    expect(rollProbability(-0.2, source)).toBe(false)
  })
})

describe('transactional random state', () => {
  it('returns a value and a new state without changing the old state', () => {
    const initial = createFixedSequenceRandomState([0.25, 0.75])
    const first = readRandomValue(initial)
    const repeated = readRandomValue(initial)

    expect(first.value).toBe(0.25)
    expect(first.state.cursor).toBe(1)
    expect(initial.cursor).toBe(0)
    expect(repeated).toEqual(first)
  })

  it('replays seeded state deterministically without time or Math.random', () => {
    const first = readRandomValue(createSeededRandomState(42))
    const second = readRandomValue(createSeededRandomState(42))

    expect(first).toEqual(second)
    expect(first.state.cursor).toBe(1)
  })

  it.each([0, 1, 0xffffffff])(
    'replays unsigned 32-bit seed %s deterministically',
    (seed) => {
      const first = readRandomValue(createSeededRandomState(seed))
      const second = readRandomValue(createSeededRandomState(seed))

      expect(first).toEqual(second)
      expect(first.value).toBeGreaterThanOrEqual(0)
      expect(first.value).toBeLessThan(1)
    },
  )

  it('keeps distinct valid seeds distinct unless the generator advances them equally', () => {
    expect(readRandomValue(createSeededRandomState(0)))
      .not.toEqual(readRandomValue(createSeededRandomState(1)))
  })

  it.each([
    -1,
    0x100000000,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects invalid seed %s with a stable range error', (seed) => {
    expect(() => createSeededRandomState(seed)).toThrowError(
      'Random seed must be an unsigned 32-bit integer.',
    )
  })

  it('rejects directly constructed invalid random states before reading', () => {
    const invalidSeed = {
      kind: 'seeded' as const,
      seed: Number.NaN,
      cursor: 0,
    }
    const invalidCursor = {
      kind: 'fixedSequence' as const,
      values: [0.5] as const,
      cursor: 2,
    }
    const overflowingCursor = {
      kind: 'seeded' as const,
      seed: 1,
      cursor: Number.MAX_SAFE_INTEGER,
    }

    expect(() => readRandomValue(invalidSeed)).toThrowError('INVALID_RANDOM_SEED')
    expect(() => readRandomValue(invalidCursor)).toThrowError(
      'INVALID_RANDOM_SEQUENCE',
    )
    expect(() => readRandomValue(overflowingCursor)).toThrowError(
      'INVALID_RANDOM_CURSOR',
    )
  })

  it.each([
    [0, false],
    [1, true],
    [1.3, true],
    [-0.2, false],
  ])('does not consume deterministic state for probability %s', (probability, rolled) => {
    const initial = createFixedSequenceRandomState([])
    const result = rollProbabilityFromState(probability, initial)

    expect(result.rolled).toBe(rolled)
    expect(result.consumed).toBe(false)
    expect(result.state).toBe(initial)
  })
})
