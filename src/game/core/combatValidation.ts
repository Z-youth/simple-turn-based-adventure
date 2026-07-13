import type { UnitState } from './units'

export type CombatUnitValidationErrorCode =
  | 'INVALID_UNIT_NUMERIC_STATE'
  | 'INVALID_UNIT_HEALTH'
  | 'INVALID_UNIT_SHIELD'

function allFinite(values: readonly number[]): boolean {
  return values.every(Number.isFinite)
}

export function validateCombatUnit(
  unit: UnitState,
): CombatUnitValidationErrorCode | null {
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
  return null
}
