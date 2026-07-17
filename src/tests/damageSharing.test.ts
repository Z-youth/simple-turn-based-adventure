import { describe, expect, it } from 'vitest'
import { splitDamageBeforeDefense } from '../game/core/damageSharing'
import { calculateShieldValueDamage } from '../game/core/damage'
import { DamageType } from '../game/core/enums'
import { calculateShieldedDamage } from '../game/core/shields'
import { unitId } from './battleTestUtils'

describe('damage sharing entry point', () => {
  it('splits before each recipient resolves its own reduction and shield', () => {
    const split = splitDamageBeforeDefense(DamageType.Normal, 100, [
      { targetId: unitId('center'), ratio: 0.5 },
      { targetId: unitId('upper'), ratio: 0.25 },
      { targetId: unitId('lower'), ratio: 0.25 },
    ])
    expect(split.ok).toBe(true)
    if (!split.ok) return

    const center = calculateShieldValueDamage({
      baseValue: split.shares[0]?.valueBeforeDefense ?? 0,
      normalDamageIncrease: 0,
      reductionSources: [0.5],
    })
    const upper = calculateShieldValueDamage({
      baseValue: split.shares[1]?.valueBeforeDefense ?? 0,
      normalDamageIncrease: 0,
      reductionSources: [],
    })
    expect(center.ok).toBe(true)
    expect(upper.ok).toBe(true)
    if (!center.ok || !upper.ok) return
    expect(center.resolvedValue).toBe(25)
    expect(upper.resolvedValue).toBe(25)

    const shielded = calculateShieldedDamage({
      currentHealth: 100,
      currentShield: 10,
      hasInfiniteHealth: false,
      alive: true,
      resolvedDamage: upper.resolvedValue,
    })
    expect(shielded.ok).toBe(true)
    if (!shielded.ok) return
    expect(shielded).toMatchObject({ shieldAbsorbed: 10, healthLost: 15 })
  })

  it('rejects extra damage sharing by default', () => {
    expect(splitDamageBeforeDefense(DamageType.Extra, 30, [
      { targetId: unitId('target'), ratio: 1 },
    ])).toEqual({
      ok: false,
      shares: [],
      reason: 'EXTRA_DAMAGE_CANNOT_BE_SHARED',
    })
  })

  it('allows explicitly shareable special damage at the same pre-defense entry', () => {
    expect(splitDamageBeforeDefense(DamageType.ShieldValue, 80, [
      { targetId: unitId('center'), ratio: 0.75 },
      { targetId: unitId('guard'), ratio: 0.25 },
    ])).toEqual({
      ok: true,
      shares: [
        { targetId: unitId('center'), valueBeforeDefense: 60 },
        { targetId: unitId('guard'), valueBeforeDefense: 20 },
      ],
    })
  })

  it('rejects invalid ratios atomically', () => {
    expect(splitDamageBeforeDefense(DamageType.ShieldValue, 30, [
      { targetId: unitId('a'), ratio: 0.8 },
      { targetId: unitId('b'), ratio: 0.3 },
    ])).toEqual({
      ok: false,
      shares: [],
      reason: 'INVALID_DAMAGE_SHARES',
    })
  })
})
