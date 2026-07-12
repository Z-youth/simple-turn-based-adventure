import { Position } from './enums'
import type { UnitState } from './units'
import { clampMinimum, clampProbabilityForRoll } from './rounding'

export function isUnitAlive(unit: UnitState): boolean {
  return unit.alive && (unit.hasInfiniteHealth || unit.currentHealth > 0)
}

export function getBaseAttackAtBattleEntry(unit: UnitState): number {
  return unit.baseAttackAtBattleEntry
}

export function getMomentumAttackBonus(
  baseAttackAtBattleEntry: number,
  momentum: number,
): number {
  const maximumBonus = clampMinimum(baseAttackAtBattleEntry * 2, 0)
  return Math.min(clampMinimum(momentum, 0), maximumBonus)
}

export function getEffectiveAttack(unit: UnitState): number {
  const modifierTotal = unit.attackModifiers.reduce(
    (total, modifier) => total + modifier.value,
    0,
  )

  return unit.baseAttackAtBattleEntry
    + getMomentumAttackBonus(unit.baseAttackAtBattleEntry, unit.momentum)
    + modifierTotal
}

export interface CriticalProbabilitySummary {
  attribute: number
  probabilityForRoll: number
  overflow: number
}

export function getCriticalProbabilitySummary(
  criticalRate: number,
): CriticalProbabilitySummary {
  return {
    attribute: criticalRate,
    probabilityForRoll: clampProbabilityForRoll(criticalRate),
    overflow: clampMinimum(criticalRate - 1, 0),
  }
}

export function getPositionOrderWeight(position: UnitState['position']): number {
  switch (position) {
    case Position.Front1:
      return 0
    case Position.Front2:
      return 1
    case Position.Back1:
      return 2
    case Position.Back2:
      return 3
    case null:
      return Number.POSITIVE_INFINITY
  }
}

export function isFrontPosition(position: UnitState['position']): boolean {
  return position === Position.Front1 || position === Position.Front2
}

export function isBackPosition(position: UnitState['position']): boolean {
  return position === Position.Back1 || position === Position.Back2
}
