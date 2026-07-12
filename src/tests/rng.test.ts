import { describe, expect, it } from 'vitest'
import {
  createFixedSequenceRandomSource,
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
