import { clampMinimum, roundDecimalResult } from './rounding'
import type { BattleState } from './contexts'
import type { BattleEvent } from './events'
import type {
  PersonalTurnId,
  SkillExecutionId,
  TurnSequenceId,
  UnitId,
} from './identifiers'
import { resolveVitalityChange } from './vitality'

export type ShieldCalculationErrorCode =
  | 'INVALID_SHIELD_CALCULATION_INPUT'
  | 'INVALID_SHIELD_CALCULATION_RANGE'

export type ShieldGainErrorCode = ShieldCalculationErrorCode
  | 'SHIELD_OWNER_NOT_FOUND'
  | 'SHIELD_OWNER_DEAD'

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
  readonly alive: boolean
  readonly causedDeath: boolean
  readonly targetWasAlreadyDead: boolean
}

export interface DirectHealthDamageResult {
  readonly ok: true
  readonly healthLost: number
  readonly remainingHealth: number
  readonly alive: boolean
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

export interface ShieldGainRequest {
  readonly unitId: UnitId
  readonly amount: number
  readonly reason: string
  readonly personalTurnId: PersonalTurnId | null
  readonly sequenceId: TurnSequenceId | null
  readonly skillExecutionId: SkillExecutionId | null
}

export interface ShieldGainSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

export interface ShieldGainFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: ShieldGainErrorCode
}

export type ShieldGainResult = ShieldGainSuccess | ShieldGainFailure

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

export function gainShield(
  state: BattleState,
  request: ShieldGainRequest,
): ShieldGainResult {
  const unit = state.units.find((candidate) => candidate.id === request.unitId)
  if (unit === undefined) {
    return {
      ok: false,
      state,
      events: [],
      reason: 'SHIELD_OWNER_NOT_FOUND',
    }
  }
  if (!unit.alive || (!unit.hasInfiniteHealth && unit.currentHealth <= 0)) {
    return { ok: false, state, events: [], reason: 'SHIELD_OWNER_DEAD' }
  }
  if (!Number.isFinite(request.amount) || request.amount <= 0) {
    return {
      ok: false,
      state,
      events: [],
      reason: 'INVALID_SHIELD_CALCULATION_RANGE',
    }
  }
  const nextShield = calculateAddedShield(unit.shield, request.amount)
  if (typeof nextShield !== 'number') {
    return { ok: false, state, events: [], reason: nextShield.reason }
  }
  if (Math.abs(nextShield) > Number.MAX_SAFE_INTEGER) {
    return {
      ok: false,
      state,
      events: [],
      reason: 'INVALID_SHIELD_CALCULATION_RANGE',
    }
  }
  const event: BattleEvent = {
    type: 'SHIELD_GAINED',
    unitId: unit.id,
    amount: request.amount,
    before: unit.shield,
    after: nextShield,
    reason: request.reason,
    personalTurnId: request.personalTurnId,
    sequenceId: request.sequenceId,
    skillExecutionId: request.skillExecutionId,
  }
  return {
    ok: true,
    state: {
      ...state,
      units: state.units.map((candidate) => candidate.id === unit.id
        ? { ...candidate, shield: nextShield }
        : candidate),
      events: [...state.events, event],
    },
    events: [event],
  }
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
  const vitality = resolveVitalityChange(input, {
    kind: 'healthLoss',
    amount: unshieldedDamage,
  })
  if (!vitality.ok) {
    return { ok: false, reason: 'INVALID_SHIELD_CALCULATION_INPUT' }
  }

  return {
    ok: true,
    shieldAbsorbed,
    healthLost: vitality.healthLost,
    remainingShield,
    remainingHealth: vitality.remainingHealth,
    alive: vitality.alive,
    causedDeath: vitality.causedDeath,
    targetWasAlreadyDead: vitality.targetWasAlreadyDead,
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

  const vitality = resolveVitalityChange(input, {
    kind: 'healthLoss',
    amount: input.resolvedDamage,
  })
  if (!vitality.ok) {
    return { ok: false, reason: 'INVALID_SHIELD_CALCULATION_INPUT' }
  }

  return {
    ok: true,
    healthLost: vitality.healthLost,
    remainingHealth: vitality.remainingHealth,
    alive: vitality.alive,
    causedDeath: vitality.causedDeath,
    targetWasAlreadyDead: vitality.targetWasAlreadyDead,
  }
}
