import type { BattleState } from './contexts'
import type { UnitState } from './units'

export type CombatUnitValidationErrorCode =
  | 'INVALID_UNIT_NUMERIC_STATE'
  | 'INVALID_UNIT_BASE_ATTACK'
  | 'INVALID_UNIT_HEALTH'
  | 'INVALID_UNIT_SHIELD'
  | 'INVALID_UNIT_RESOURCE_STATE'

function allFinite(values: readonly number[]): boolean {
  return values.every(Number.isFinite)
}

export function validateBattleEntryBaseAttack(
  unit: UnitState,
): 'INVALID_UNIT_BASE_ATTACK' | null {
  return Number.isSafeInteger(unit.baseAttackAtBattleEntry)
    && unit.baseAttackAtBattleEntry > 0
    ? null
    : 'INVALID_UNIT_BASE_ATTACK'
}

export function validateBattleRuntimeUnits(
  units: readonly UnitState[],
): 'INVALID_UNIT_BASE_ATTACK' | null {
  for (const unit of units) {
    const invalidBaseAttack = validateBattleEntryBaseAttack(unit)
    if (invalidBaseAttack !== null) return invalidBaseAttack
  }
  return null
}

export function validateBattleStateUnits(
  state: BattleState,
): 'INVALID_UNIT_BASE_ATTACK' | null {
  return validateBattleRuntimeUnits(state.units)
}

export function validateCombatUnit(
  unit: UnitState,
): CombatUnitValidationErrorCode | null {
  const invalidBaseAttack = validateBattleEntryBaseAttack(unit)
  if (invalidBaseAttack !== null) return invalidBaseAttack
  if (!allFinite([
    unit.currentHealth,
    unit.maximumHealth,
    unit.baseAttackAtBattleEntry,
    unit.speed,
    unit.shield,
    unit.criticalRate,
    unit.criticalDamage,
    unit.normalDamageIncrease,
    unit.extraDamageIncrease,
    unit.extraDamageReduction,
    ...unit.attackModifiers.map((modifier) => modifier.value),
    ...unit.normalDamageReductionSources.map((source) => source.reduction),
  ])) {
    return 'INVALID_UNIT_NUMERIC_STATE'
  }
  if (unit.currentHealth < 0 || unit.maximumHealth < 0) {
    return 'INVALID_UNIT_HEALTH'
  }
  if (unit.shield < 0) return 'INVALID_UNIT_SHIELD'
  if (![
    unit.energy,
    unit.momentum,
    unit.momentumPressure,
    unit.intent,
    unit.magic,
  ].every(Number.isSafeInteger)) {
    return 'INVALID_UNIT_RESOURCE_STATE'
  }
  if (
    unit.momentum < 0
    || unit.momentumPressure < 0
    || unit.intent < 0
    || unit.magic < 0
  ) return 'INVALID_UNIT_RESOURCE_STATE'
  return null
}
