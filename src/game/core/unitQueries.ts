import { Position } from './enums'
import type { UnitState } from './units'
import { clampMinimum, clampProbabilityForRoll } from './rounding'
import {
  TemporaryAttribute,
  type TemporaryAttribute as TemporaryAttributeValue,
} from './temporaryModifiers'

export function isUnitAlive(unit: UnitState): boolean {
  return unit.alive && (unit.hasInfiniteHealth || unit.currentHealth > 0)
}

export function getBaseAttackAtBattleEntry(unit: UnitState): number {
  return unit.baseAttackAtBattleEntry
}

export function getMomentumAttackCap(baseAttackAtBattleEntry: number): number {
  return clampMinimum(baseAttackAtBattleEntry * 2, 0)
}

export function getMomentumAttackBonus(
  baseAttackAtBattleEntry: number,
  momentum: number,
): number {
  const maximumBonus = getMomentumAttackCap(baseAttackAtBattleEntry)
  return Math.min(clampMinimum(momentum, 0), maximumBonus)
}

export function getEffectiveAttack(unit: UnitState): number {
  return getEffectiveAttribute(unit, TemporaryAttribute.Attack)
}

export function getEffectiveCriticalRate(unit: UnitState): number {
  return getEffectiveAttribute(unit, TemporaryAttribute.CriticalRate)
}

export function getEffectiveCriticalDamage(unit: UnitState): number {
  return getEffectiveAttribute(unit, TemporaryAttribute.CriticalDamage)
}

export function getEffectiveAttribute(
  unit: UnitState,
  attribute: TemporaryAttributeValue,
): number {
  const modifierTotal = unit.temporaryAttributeModifiers.reduce(
    (total, modifier) => (
      modifier.attribute === attribute ? total + modifier.value : total
    ),
    0,
  )
  switch (attribute) {
    case TemporaryAttribute.Attack:
      return unit.baseAttackAtBattleEntry
        + getMomentumAttackBonus(unit.baseAttackAtBattleEntry, unit.momentum)
        + modifierTotal
    case TemporaryAttribute.CriticalRate:
      return unit.criticalRate + modifierTotal
    case TemporaryAttribute.CriticalDamage:
      return unit.criticalDamage + modifierTotal
  }
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
