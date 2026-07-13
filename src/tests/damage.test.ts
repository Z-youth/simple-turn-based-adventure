import { describe, expect, it } from 'vitest'
import {
  calculateExtraDamage,
  calculateNormalDamage,
  calculateShieldValueDamage,
} from '../game/core/damage'
import {
  createFixedSequenceRandomState,
  createSeededRandomState,
} from '../game/core/rng'

describe('normal damage formula', () => {
  it('calculates attack times multiplier plus fixed normal damage', () => {
    const result = calculateNormalDamage({
      effectiveAttack: 20,
      multiplier: 0.8,
      fixedDamage: 4,
      criticalRate: 0,
      criticalDamage: 0.5,
      normalDamageIncrease: 0,
      reductionSources: [],
    }, createSeededRandomState(1))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.baseDamage).toBe(20)
    expect(result.resolvedValue).toBe(20)
    expect(result.critical).toBe(false)
  })

  it('applies critical, aggregated increase, and independent reductions in order', () => {
    const result = calculateNormalDamage({
      effectiveAttack: 20,
      multiplier: 0.8,
      fixedDamage: 0,
      criticalRate: 1,
      criticalDamage: 0.5,
      normalDamageIncrease: 0.25,
      reductionSources: [0.5, 0.2],
    }, createSeededRandomState(1))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.baseDamage).toBe(16)
    expect(result.rawValue).toBeCloseTo(12)
    expect(result.resolvedValue).toBe(12)
  })

  it('keeps intermediate precision and rounds only the independent result', () => {
    const result = calculateNormalDamage({
      effectiveAttack: 15.6,
      multiplier: 0.8,
      fixedDamage: 0,
      criticalRate: 0,
      criticalDamage: 0.5,
      normalDamageIncrease: 0,
      reductionSources: [],
    }, createSeededRandomState(1))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rawValue).toBeCloseTo(12.48)
    expect(result.resolvedValue).toBe(12.5)
  })

  it('clamps negative final damage to zero instead of healing', () => {
    const result = calculateNormalDamage({
      effectiveAttack: 10,
      multiplier: 1,
      fixedDamage: 0,
      criticalRate: 0,
      criticalDamage: 0.5,
      normalDamageIncrease: 0,
      reductionSources: [1.5],
    }, createSeededRandomState(1))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.resolvedValue).toBe(0)
  })

  it.each([
    [5.15, 5.2],
    [5.25, 5.3],
    [0.1 + 0.2, 0.3],
  ])('rounds floating boundary %s once to %s', (effectiveAttack, expected) => {
    const result = calculateNormalDamage({
      effectiveAttack,
      multiplier: 1,
      fixedDamage: 0,
      criticalRate: 0,
      criticalDamage: 0,
      normalDamageIncrease: 0,
      reductionSources: [],
    }, createSeededRandomState(1))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rawValue).toBeCloseTo(effectiveAttack)
    expect(result.resolvedValue).toBe(expected)
  })
})

describe('critical probability', () => {
  it.each([
    [0, false],
    [1, true],
    [1.3, true],
  ])('resolves rate %s as critical=%s without consuming RNG', (rate, critical) => {
    const rng = createFixedSequenceRandomState([])
    const result = calculateNormalDamage({
      effectiveAttack: 10,
      multiplier: 1,
      fixedDamage: 0,
      criticalRate: rate,
      criticalDamage: 0.5,
      normalDamageIncrease: 0,
      reductionSources: [],
    }, rng)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.critical).toBe(critical)
    expect(result.rngConsumed).toBe(false)
    expect(result.rngState).toBe(rng)
  })

  it('consumes one explicit random value for a probabilistic roll', () => {
    const result = calculateNormalDamage({
      effectiveAttack: 10,
      multiplier: 1,
      fixedDamage: 0,
      criticalRate: 0.5,
      criticalDamage: 0.5,
      normalDamageIncrease: 0,
      reductionSources: [],
    }, createFixedSequenceRandomState([0.49]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.critical).toBe(true)
    expect(result.rngConsumed).toBe(true)
    expect(result.rngState.cursor).toBe(1)
  })
})

describe('non-critical damage types', () => {
  it('applies normal increase and multiplicative reductions to shield-value damage', () => {
    const result = calculateShieldValueDamage({
      baseValue: 100,
      normalDamageIncrease: 0.2,
      reductionSources: [0.5, 0.2],
    })

    expect(result).toEqual({ ok: true, rawValue: 48, resolvedValue: 48 })
  })

  it('keeps shield-value raw precision and rounds only its final result', () => {
    const result = calculateShieldValueDamage({
      baseValue: 10.5,
      normalDamageIncrease: 0,
      reductionSources: [0.5],
    })

    expect(result).toEqual({ ok: true, rawValue: 5.25, resolvedValue: 5.3 })
  })

  it.each([
    [5.24, 5.2],
    [5.25, 5.3],
  ])('rounds supplied extra damage %s to %s', (value, expected) => {
    const result = calculateExtraDamage(value)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.resolvedValue).toBe(expected)
  })

  it('rejects negative extra damage instead of turning it into healing', () => {
    expect(calculateExtraDamage(-5)).toEqual({
      ok: false,
      reason: 'INVALID_DAMAGE_CALCULATION_INPUT',
    })
  })
})
