import { clampMinimum, roundDecimalResult } from './rounding'
import { rollProbabilityFromState, validateRandomState } from './rng'
import type { RandomState } from './rng'
import type { NormalDamageModifierSource } from './units'

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
  readonly normalDamageIncreaseSources?: readonly NormalDamageModifierSource[]
  readonly reductionModifierSources?: readonly NormalDamageModifierSource[]
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
  readonly normalDamageIncreaseSources?: readonly NormalDamageModifierSource[]
  readonly reductionModifierSources?: readonly NormalDamageModifierSource[]
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

function applyModifierSources(
  value: number,
  sources: readonly NormalDamageModifierSource[],
  direction: 'increase' | 'reduction',
): number {
  const totals = new Map<string, number>()
  for (const source of sources) {
    totals.set(source.sourceId, (totals.get(source.sourceId) ?? 0) + source.modifier)
  }
  return [...totals.values()].reduce((current, modifier) => (
    direction === 'increase'
      ? current * (1 + modifier)
      : current * Math.max(1 - modifier, 0)
  ), value)
}

function legacyModifierSources(
  modifiers: readonly number[],
  prefix: string,
): readonly NormalDamageModifierSource[] {
  return modifiers.map((modifier, index) => ({
    sourceId: `${prefix}:${index}`,
    modifier,
  }))
}

function modifierSourcesAreFinite(
  sources: readonly NormalDamageModifierSource[],
): boolean {
  return sources.every((source) => Number.isFinite(source.modifier))
}

export function calculateNormalDamage(
  input: NormalDamageInput,
  rngState: RandomState,
): NormalDamageCalculation {
  const increaseSources = [
    { sourceId: 'legacy:normal-damage-increase', modifier: input.normalDamageIncrease },
    ...(input.normalDamageIncreaseSources ?? []),
  ]
  const reductionSources = [
    ...legacyModifierSources(input.reductionSources, 'legacy:normal-damage-reduction'),
    ...(input.reductionModifierSources ?? []),
  ]
  if (!finite([
    input.effectiveAttack,
    input.multiplier,
    input.fixedDamage,
    input.criticalRate,
    input.criticalDamage,
    input.normalDamageIncrease,
  ]) || !modifierSourcesAreFinite(increaseSources)
    || !modifierSourcesAreFinite(reductionSources)) {
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
  const afterIncrease = applyModifierSources(afterCritical, increaseSources, 'increase')
  const rawValue = clampMinimum(
    applyModifierSources(afterIncrease, reductionSources, 'reduction'),
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
  const increaseSources = [
    { sourceId: 'legacy:normal-damage-increase', modifier: input.normalDamageIncrease },
    ...(input.normalDamageIncreaseSources ?? []),
  ]
  const reductionSources = [
    ...legacyModifierSources(input.reductionSources, 'legacy:normal-damage-reduction'),
    ...(input.reductionModifierSources ?? []),
  ]
  if (!finite([
    input.baseValue,
    input.normalDamageIncrease,
  ]) || input.baseValue < 0
    || !modifierSourcesAreFinite(increaseSources)
    || !modifierSourcesAreFinite(reductionSources)) {
    return { ok: false, reason: 'INVALID_DAMAGE_CALCULATION_INPUT' }
  }
  const afterIncrease = applyModifierSources(
    input.baseValue,
    increaseSources,
    'increase',
  )
  const rawValue = clampMinimum(
    applyModifierSources(afterIncrease, reductionSources, 'reduction'),
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
