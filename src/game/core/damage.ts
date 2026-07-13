import { clampMinimum, roundDecimalResult } from './rounding'
import { rollProbabilityFromState, validateRandomState } from './rng'
import type { RandomState } from './rng'

export type DamageCalculationErrorCode =
  | 'INVALID_DAMAGE_CALCULATION_INPUT'
  | 'INVALID_DAMAGE_CALCULATION_RESULT'
  | 'INVALID_DAMAGE_RANDOM_STATE'

export interface DamageCalculationFailure {
  readonly ok: false
  readonly reason: DamageCalculationErrorCode
}

export interface NormalDamageInput {
  readonly effectiveAttack: number
  readonly multiplier: number
  readonly fixedDamage: number
  readonly criticalRate: number
  readonly criticalDamage: number
  readonly normalDamageIncrease: number
  readonly reductionSources: readonly number[]
}

export interface NormalDamageResult {
  readonly ok: true
  readonly baseDamage: number
  readonly critical: boolean
  readonly criticalRateForRoll: number
  readonly rngConsumed: boolean
  readonly randomValue: number | null
  readonly rawValue: number
  readonly resolvedValue: number
  readonly rngState: RandomState
}

export type NormalDamageCalculation =
  | NormalDamageResult
  | DamageCalculationFailure

export interface NonCriticalDamageInput {
  readonly baseValue: number
  readonly normalDamageIncrease: number
  readonly reductionSources: readonly number[]
}

export interface ScalarDamageResult {
  readonly ok: true
  readonly rawValue: number
  readonly resolvedValue: number
}

export type ScalarDamageCalculation =
  | ScalarDamageResult
  | DamageCalculationFailure

function finite(values: readonly number[]): boolean {
  return values.every(Number.isFinite)
}

function applyReductions(
  value: number,
  reductionSources: readonly number[],
): number {
  return reductionSources.reduce(
    (current, reduction) => current * (1 - reduction),
    value,
  )
}

export function calculateNormalDamage(
  input: NormalDamageInput,
  rngState: RandomState,
): NormalDamageCalculation {
  if (!finite([
    input.effectiveAttack,
    input.multiplier,
    input.fixedDamage,
    input.criticalRate,
    input.criticalDamage,
    input.normalDamageIncrease,
    ...input.reductionSources,
  ])) {
    return { ok: false, reason: 'INVALID_DAMAGE_CALCULATION_INPUT' }
  }
  if (validateRandomState(rngState) !== null) {
    return { ok: false, reason: 'INVALID_DAMAGE_RANDOM_STATE' }
  }

  const roll = rollProbabilityFromState(input.criticalRate, rngState)
  const baseDamage = input.effectiveAttack * input.multiplier
    + input.fixedDamage
  const afterCritical = roll.rolled
    ? baseDamage * (1 + input.criticalDamage)
    : baseDamage
  const afterIncrease = afterCritical * (1 + input.normalDamageIncrease)
  const rawValue = clampMinimum(
    applyReductions(afterIncrease, input.reductionSources),
    0,
  )
  if (!finite([baseDamage, afterCritical, afterIncrease, rawValue])) {
    return { ok: false, reason: 'INVALID_DAMAGE_CALCULATION_RESULT' }
  }

  return {
    ok: true,
    baseDamage,
    critical: roll.rolled,
    criticalRateForRoll: Math.min(1, clampMinimum(input.criticalRate, 0)),
    rngConsumed: roll.consumed,
    randomValue: roll.randomValue,
    rawValue,
    resolvedValue: roundDecimalResult(rawValue),
    rngState: roll.state,
  }
}

export function calculateShieldValueDamage(
  input: NonCriticalDamageInput,
): ScalarDamageCalculation {
  if (!finite([
    input.baseValue,
    input.normalDamageIncrease,
    ...input.reductionSources,
  ]) || input.baseValue < 0) {
    return { ok: false, reason: 'INVALID_DAMAGE_CALCULATION_INPUT' }
  }
  const afterIncrease = input.baseValue * (1 + input.normalDamageIncrease)
  const rawValue = clampMinimum(
    applyReductions(afterIncrease, input.reductionSources),
    0,
  )
  if (!finite([afterIncrease, rawValue])) {
    return { ok: false, reason: 'INVALID_DAMAGE_CALCULATION_RESULT' }
  }
  return {
    ok: true,
    rawValue,
    resolvedValue: roundDecimalResult(rawValue),
  }
}

export function calculateExtraDamage(value: number): ScalarDamageCalculation {
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, reason: 'INVALID_DAMAGE_CALCULATION_INPUT' }
  }
  const resolvedValue = roundDecimalResult(value)
  if (!Number.isFinite(resolvedValue)) {
    return { ok: false, reason: 'INVALID_DAMAGE_CALCULATION_RESULT' }
  }
  return { ok: true, rawValue: value, resolvedValue }
}
