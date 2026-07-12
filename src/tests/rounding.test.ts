import { describe, expect, it } from 'vitest'
import {
  clampMinimum,
  clampProbabilityForRoll,
  roundDecimalResult,
  roundIntegerResult,
} from '../game/core/rounding'

describe('roundIntegerResult', () => {
  it.each([
    [2.5, 3],
    [4.5, 5],
    [-2.5, -3],
    [-4.5, -5],
    [2.4, 2],
    [-2.4, -2],
  ])('rounds %s to %s', (value, expected) => {
    expect(roundIntegerResult(value)).toBe(expected)
  })
})

describe('roundDecimalResult', () => {
  it.each([
    [12.48, 12.5],
    [12.44, 12.4],
    [-12.45, -12.5],
  ])('rounds %s to one decimal place as %s', (value, expected) => {
    expect(roundDecimalResult(value)).toBe(expected)
  })
})

describe('numeric clamps', () => {
  it('clamps a value to the supplied minimum', () => {
    expect(clampMinimum(-3, 0)).toBe(0)
    expect(clampMinimum(4, 0)).toBe(4)
  })

  it.each([
    [-0.2, 0],
    [0.4, 0.4],
    [1, 1],
    [1.3, 1],
  ])('clamps probability %s to %s for a roll', (value, expected) => {
    expect(clampProbabilityForRoll(value)).toBe(expected)
  })
})
