import { Position } from './enums'
import type { UnitState } from './units'
import type { MomentumReadRule } from './units'
import { clampMinimum, clampProbabilityForRoll } from './rounding'
import { readUnitResource, ResourceType } from './resources'
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

function validMomentumReadRules(
  rules: readonly MomentumReadRule[] | undefined,
): rules is readonly MomentumReadRule[] {
  if (rules === undefined || rules.length === 0) return false
  let previousMaximum = 0
  for (const [index, rule] of rules.entries()) {
    const maximumValid = rule.maximumActualMomentum === null
      ? index === rules.length - 1
      : Number.isSafeInteger(rule.maximumActualMomentum)
        && rule.maximumActualMomentum > previousMaximum
    if (!maximumValid || ![
      rule.attackLayersPerMomentum,
      rule.effectLayersPerMomentum,
      rule.pressureLayersPerMomentum,
    ].every((value) => Number.isFinite(value) && value > 0)) {
      return false
    }
    if (rule.maximumActualMomentum !== null) {
      previousMaximum = rule.maximumActualMomentum
    }
  }
  return true
}

function getMomentumReadRule(unit: UnitState): MomentumReadRule | null {
  const rules = unit.momentumReadRules
  if (!validMomentumReadRules(rules)) return null
  return rules.find((rule) => (
    rule.maximumActualMomentum === null
      || unit.momentum <= rule.maximumActualMomentum
  )) ?? null
}

function getMomentumReadValue(
  unit: UnitState,
  kind: 'attack' | 'effect' | 'pressure',
): number {
  const rule = getMomentumReadRule(unit)
  const multiplier = rule === null
    ? 1
    : kind === 'attack'
      ? rule.attackLayersPerMomentum
      : kind === 'effect'
        ? rule.effectLayersPerMomentum
        : rule.pressureLayersPerMomentum
  const momentum = kind === 'attack'
    ? unit.momentum
    : readUnitResource(unit, ResourceType.Momentum)
  return momentum * multiplier
}

export function getMomentumAttackLayers(unit: UnitState): number {
  return getMomentumReadValue(unit, 'attack')
}

export function getMomentumEffectLayers(unit: UnitState): number {
  return getMomentumReadValue(unit, 'effect')
}

export function getMomentumPressureLayers(unit: UnitState): number {
  return getMomentumReadValue(unit, 'pressure')
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
        + getMomentumAttackBonus(
          unit.baseAttackAtBattleEntry,
          getMomentumAttackLayers(unit),
        )
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
    case Position.EnemyCenter:
      return 0
    case Position.EnemyUpper:
      return 1
    case Position.EnemyLower:
      return 2
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
