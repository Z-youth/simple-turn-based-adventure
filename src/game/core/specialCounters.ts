import type { BattleState } from './contexts'
import type { BattleEvent } from './events'
import type {
  ActionId,
  PersonalTurnId,
  SkillExecutionId,
  SpecialCounterId,
  TurnSequenceId,
  UnitId,
} from './identifiers'
import type { ResourceType } from './resources'
import type { UnitState } from './units'

export interface SpecialCounter {
  readonly counterId: SpecialCounterId
  readonly value: number
}

export interface ResourceReductionProtection {
  readonly resourceType: ResourceType
  readonly counterId: SpecialCounterId
  readonly minimumCounterValue: number
}

export type SpecialCounterErrorCode =
  | 'SPECIAL_COUNTER_OWNER_NOT_FOUND'
  | 'INVALID_SPECIAL_COUNTER_AMOUNT'
  | 'SPECIAL_COUNTER_VALUE_OUT_OF_RANGE'
  | 'INVALID_SPECIAL_COUNTER_STATE'

export interface SpecialCounterChangeRequest {
  readonly unitId: UnitId
  readonly counterId: SpecialCounterId
  readonly amount: number
  readonly sourceUnitId?: UnitId | null
  readonly effectId?: string | null
  readonly actionId: ActionId | null
  readonly personalTurnId: PersonalTurnId | null
  readonly sequenceId: TurnSequenceId | null
  readonly skillExecutionId: SkillExecutionId | null
}

export interface SpecialCounterChangeSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

export interface SpecialCounterChangeFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: SpecialCounterErrorCode
}

export type SpecialCounterChangeResult =
  | SpecialCounterChangeSuccess
  | SpecialCounterChangeFailure

export function readSpecialCounter(
  unit: UnitState,
  counterId: SpecialCounterId,
): number {
  return unit.specialCounters.find((counter) => (
    counter.counterId === counterId
  ))?.value ?? 0
}

export function validateSpecialCounters(
  unit: UnitState,
): SpecialCounterErrorCode | null {
  if (!Array.isArray(unit.specialCounters)) return 'INVALID_SPECIAL_COUNTER_STATE'
  const ids = unit.specialCounters.map((counter) => counter.counterId)
  if (new Set(ids).size !== ids.length) return 'INVALID_SPECIAL_COUNTER_STATE'
  if (unit.specialCounters.some((counter) => (
    typeof counter.counterId !== 'string'
    || counter.counterId.length === 0
    || !Number.isSafeInteger(counter.value)
    || counter.value < 0
  ))) return 'INVALID_SPECIAL_COUNTER_STATE'
  return null
}

export function findActiveResourceReductionProtection(
  unit: UnitState,
  resourceType: ResourceType,
): ResourceReductionProtection | null {
  return unit.resourceReductionProtections.find((protection) => (
    protection.resourceType === resourceType
    && readSpecialCounter(unit, protection.counterId)
      >= protection.minimumCounterValue
  )) ?? null
}

function failure(
  state: BattleState,
  reason: SpecialCounterErrorCode,
): SpecialCounterChangeFailure {
  return { ok: false, state, events: [], reason }
}

function replaceCounter(
  unit: UnitState,
  counterId: SpecialCounterId,
  value: number,
): UnitState {
  const existing = unit.specialCounters.some((counter) => (
    counter.counterId === counterId
  ))
  const specialCounters = value === 0
    ? unit.specialCounters.filter((counter) => counter.counterId !== counterId)
    : existing
      ? unit.specialCounters.map((counter) => (
          counter.counterId === counterId ? { ...counter, value } : counter
        ))
      : [...unit.specialCounters, { counterId, value }]
  return { ...unit, specialCounters }
}

function changeSpecialCounter(
  state: BattleState,
  request: SpecialCounterChangeRequest,
  operation: 'increase' | 'decrease',
): SpecialCounterChangeResult {
  if (!Number.isSafeInteger(request.amount) || request.amount <= 0) {
    return failure(state, 'INVALID_SPECIAL_COUNTER_AMOUNT')
  }
  const unit = state.units.find((candidate) => candidate.id === request.unitId)
  if (unit === undefined) return failure(state, 'SPECIAL_COUNTER_OWNER_NOT_FOUND')
  const invalid = validateSpecialCounters(unit)
  if (invalid !== null) return failure(state, invalid)
  const before = readSpecialCounter(unit, request.counterId)
  const after = operation === 'increase'
    ? before + request.amount
    : Math.max(0, before - request.amount)
  if (!Number.isSafeInteger(after)) {
    return failure(state, 'SPECIAL_COUNTER_VALUE_OUT_OF_RANGE')
  }
  const amount = Math.abs(after - before)
  if (amount === 0) return { ok: true, state, events: [] }
  const replacement = replaceCounter(unit, request.counterId, after)
  const event: BattleEvent = {
    type: 'SPECIAL_COUNTER_CHANGED',
    unitId: request.unitId,
    counterId: request.counterId,
    operation,
    amount,
    before,
    after,
    sourceUnitId: request.sourceUnitId ?? null,
    effectId: request.effectId ?? null,
    actionId: request.actionId,
    personalTurnId: request.personalTurnId,
    sequenceId: request.sequenceId,
    skillExecutionId: request.skillExecutionId,
  }
  return {
    ok: true,
    state: {
      ...state,
      units: state.units.map((candidate) => (
        candidate.id === replacement.id ? replacement : candidate
      )),
      events: [...state.events, event],
    },
    events: [event],
  }
}

export function increaseSpecialCounter(
  state: BattleState,
  request: SpecialCounterChangeRequest,
): SpecialCounterChangeResult {
  return changeSpecialCounter(state, request, 'increase')
}

export function decreaseSpecialCounter(
  state: BattleState,
  request: SpecialCounterChangeRequest,
): SpecialCounterChangeResult {
  return changeSpecialCounter(state, request, 'decrease')
}
