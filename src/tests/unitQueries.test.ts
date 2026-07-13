import { describe, expect, it } from 'vitest'
import { Camp, Position, UnitSystem } from '../game/core/enums'
import type { SkillId, UnitId } from '../game/core/identifiers'
import type { UnitState } from '../game/core/units'
import {
  getBaseAttackAtBattleEntry,
  getCriticalProbabilitySummary,
  getEffectiveAttack,
  getMomentumAttackCap,
  getMomentumAttackBonus,
  getPositionOrderWeight,
  isBackPosition,
  isFrontPosition,
  isUnitAlive,
} from '../game/core/unitQueries'

function createUnit(overrides: Partial<UnitState> = {}): UnitState {
  return {
    id: 'unit' as UnitId,
    name: 'Test unit',
    camp: Camp.Player,
    system: UnitSystem.Momentum,
    isBoss: false,
    position: Position.Front1,
    deploymentOrder: 0,
    currentHealth: 100,
    maximumHealth: 100,
    hasInfiniteHealth: false,
    baseAttackAtBattleEntry: 20,
    temporaryAttributeModifiers: [],
    speed: 100,
    shield: 0,
    criticalRate: 0,
    criticalDamage: 0.5,
    normalDamageIncrease: 0,
    normalDamageReductionSources: [],
    extraDamageIncrease: 0,
    extraDamageReduction: 0,
    energy: 0,
    momentum: 0,
    intent: 0,
    magic: 0,
    momentumPressure: 0,
    specialCounters: [],
    resourceReductionProtections: [],
    alive: true,
    ...overrides,
  }
}

describe('unit attack queries', () => {
  it.each([
    [10, 20],
    [20, 40],
  ])('uses twice base attack %s as momentum attack cap %s', (base, cap) => {
    expect(getMomentumAttackCap(base)).toBe(cap)
  })

  it.each([
    [0, 0],
    [20, 20],
    [40, 40],
    [100, 40],
  ])('gives +%s momentum attack with base attack 20 as %s', (momentum, expected) => {
    expect(getMomentumAttackBonus(20, momentum)).toBe(expected)
  })

  it('does not let a temporary attack buff raise the momentum cap', () => {
    const unit = createUnit({
      momentum: 100,
      temporaryAttributeModifiers: [{
        sourceId: 'temporary-buff' as SkillId,
        attribute: 'attack',
        value: 50,
        duration: { kind: 'ownerTurns', remainingTurns: 1 },
      }],
    })

    expect(getBaseAttackAtBattleEntry(unit)).toBe(20)
    expect(getMomentumAttackBonus(unit.baseAttackAtBattleEntry, unit.momentum)).toBe(40)
    expect(getEffectiveAttack(unit)).toBe(110)
  })
})

describe('critical probability query', () => {
  it('preserves a 130% attribute while exposing 100% roll chance and 30% overflow', () => {
    const summary = getCriticalProbabilitySummary(1.3)

    expect(summary.attribute).toBe(1.3)
    expect(summary.probabilityForRoll).toBe(1)
    expect(summary.overflow).toBeCloseTo(0.3)
  })
})

describe('unit and position queries', () => {
  it('requires both alive state and usable health for a finite unit', () => {
    expect(isUnitAlive(createUnit())).toBe(true)
    expect(isUnitAlive(createUnit({ currentHealth: 0 }))).toBe(false)
    expect(isUnitAlive(createUnit({ alive: false }))).toBe(false)
  })

  it('treats an alive infinite-health unit as alive regardless of numeric health', () => {
    expect(isUnitAlive(createUnit({
      currentHealth: 0,
      maximumHealth: Number.POSITIVE_INFINITY,
      hasInfiniteHealth: true,
    }))).toBe(true)
  })

  it('orders player positions from front1 through back2', () => {
    expect([
      Position.Front1,
      Position.Front2,
      Position.Back1,
      Position.Back2,
    ].map(getPositionOrderWeight)).toEqual([0, 1, 2, 3])
  })

  it('identifies front and back positions', () => {
    expect(isFrontPosition(Position.Front1)).toBe(true)
    expect(isFrontPosition(Position.Back1)).toBe(false)
    expect(isBackPosition(Position.Back2)).toBe(true)
    expect(isBackPosition(null)).toBe(false)
  })
})
