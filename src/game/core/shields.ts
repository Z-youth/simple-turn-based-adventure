import { clampMinimum, roundDecimalResult } from './rounding'

export type ShieldCalculationErrorCode =
  | 'INVALID_SHIELD_CALCULATION_INPUT'
  | 'INVALID_SHIELD_CALCULATION_RANGE'

export interface ShieldCalculationFailure {
  readonly ok: false
  readonly reason: ShieldCalculationErrorCode
}

export interface ShieldedDamageResult {
  readonly ok: true
  readonly shieldAbsorbed: number
  readonly healthLost: number
  readonly remainingShield: number
  readonly remainingHealth: number
  readonly causedDeath: boolean
  readonly targetWasAlreadyDead: boolean
}

export interface DirectHealthDamageResult {
  readonly ok: true
  readonly healthLost: number
  readonly remainingHealth: number
  readonly causedDeath: boolean
  readonly targetWasAlreadyDead: boolean
}

export type ShieldedDamageCalculation =
  | ShieldedDamageResult
  | ShieldCalculationFailure

export type DirectHealthDamageCalculation =
  | DirectHealthDamageResult
  | ShieldCalculationFailure

export interface ShieldedDamageInput {
  readonly currentHealth: number
  readonly currentShield: number
  readonly hasInfiniteHealth: boolean
  readonly alive: boolean
  readonly resolvedDamage: number
}

export interface DirectHealthDamageInput {
  readonly currentHealth: number
  readonly hasInfiniteHealth: boolean
  readonly alive: boolean
  readonly resolvedDamage: number
}

function finite(values: readonly number[]): boolean {
  return values.every(Number.isFinite)
}

export function calculateAddedShield(
  currentShield: number,
  amount: number,
): number | ShieldCalculationFailure {
  if (!finite([currentShield, amount])) {
    return { ok: false, reason: 'INVALID_SHIELD_CALCULATION_INPUT' }
  }
  if (currentShield < 0) {
    return { ok: false, reason: 'INVALID_SHIELD_CALCULATION_RANGE' }
  }
  const nextShield = currentShield + amount
  if (!Number.isFinite(nextShield)) {
    return { ok: false, reason: 'INVALID_SHIELD_CALCULATION_RANGE' }
  }
  return roundDecimalResult(clampMinimum(nextShield, 0))
}

export function calculateShieldedDamage(
  input: ShieldedDamageInput,
): ShieldedDamageCalculation {
  if (!finite([
    input.currentHealth,
    input.currentShield,
    input.resolvedDamage,
  ])) {
    return { ok: false, reason: 'INVALID_SHIELD_CALCULATION_INPUT' }
  }
  if (
    input.currentHealth < 0
    || input.currentShield < 0
    || input.resolvedDamage < 0
  ) {
    return { ok: false, reason: 'INVALID_SHIELD_CALCULATION_RANGE' }
  }

  const shieldAbsorbed = Math.min(input.currentShield, input.resolvedDamage)
  const remainingShield = roundDecimalResult(
    clampMinimum(input.currentShield - shieldAbsorbed, 0),
  )
  const unshieldedDamage = input.resolvedDamage - shieldAbsorbed
  const targetWasAlreadyDead = !input.alive || (
    !input.hasInfiniteHealth && input.currentHealth <= 0
  )
  const healthLost = input.hasInfiniteHealth
    ? 0
    : roundDecimalResult(Math.min(input.currentHealth, unshieldedDamage))
  const remainingHealth = input.hasInfiniteHealth
    ? input.currentHealth
    : roundDecimalResult(clampMinimum(input.currentHealth - healthLost, 0))
  const causedDeath = !targetWasAlreadyDead
    && !input.hasInfiniteHealth
    && remainingHealth === 0

  return {
    ok: true,
    shieldAbsorbed,
    healthLost,
    remainingShield,
    remainingHealth,
    causedDeath,
    targetWasAlreadyDead,
  }
}

export function calculateDirectHealthDamage(
  input: DirectHealthDamageInput,
): DirectHealthDamageCalculation {
  if (!finite([input.currentHealth, input.resolvedDamage])) {
    return { ok: false, reason: 'INVALID_SHIELD_CALCULATION_INPUT' }
  }
  if (input.currentHealth < 0 || input.resolvedDamage < 0) {
    return { ok: false, reason: 'INVALID_SHIELD_CALCULATION_RANGE' }
  }

  const targetWasAlreadyDead = !input.alive || (
    !input.hasInfiniteHealth && input.currentHealth <= 0
  )
  const healthLost = input.hasInfiniteHealth
    ? 0
    : roundDecimalResult(Math.min(input.currentHealth, input.resolvedDamage))
  const remainingHealth = input.hasInfiniteHealth
    ? input.currentHealth
    : roundDecimalResult(clampMinimum(input.currentHealth - healthLost, 0))
  const causedDeath = !targetWasAlreadyDead
    && !input.hasInfiniteHealth
    && remainingHealth === 0

  return {
    ok: true,
    healthLost,
    remainingHealth,
    causedDeath,
    targetWasAlreadyDead,
  }
}
