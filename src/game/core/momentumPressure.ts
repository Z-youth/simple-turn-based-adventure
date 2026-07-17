import { PersonalTurnPhase, UnitSystem } from './enums'
import type { BattleState, PersonalTurnState } from './contexts'
import type { BattleEvent } from './events'
import type {
  DamageEventId,
  TriggerLockId,
  UnitId,
} from './identifiers'
import { gainShield } from './shields'
import {
  validateBattleEntryBaseAttack,
  validateBattleStateUnits,
} from './combatValidation'
import {
  getMomentumAttackBonus,
  getMomentumAttackCap,
  getMomentumAttackLayers,
  getMomentumPressureLayers,
} from './unitQueries'

export type MomentumPressureErrorCode =
  | 'MOMENTUM_PRESSURE_OWNER_NOT_FOUND'
  | 'MOMENTUM_PRESSURE_OWNER_DEAD'
  | 'INVALID_UNIT_BASE_ATTACK'
  | 'INVALID_MOMENTUM_PRESSURE_VALUE'
  | 'MOMENTUM_PRESSURE_SHIELD_OVERFLOW'
  | 'NOT_AT_MOMENTUM_PRESSURE_RECALCULATION_BOUNDARY'
  | 'NOT_AT_MOMENTUM_PRESSURE_CLEAR_BOUNDARY'

export interface MomentumPressureSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
  readonly changed: boolean
}

export interface MomentumPressureFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: MomentumPressureErrorCode
}

export type MomentumPressureResult =
  | MomentumPressureSuccess
  | MomentumPressureFailure

export const MOMENTUM_PRESSURE_TRIGGER_LOCK_ID =
  'system:momentum-pressure' as TriggerLockId

export function createMomentumPressureDamageEventId(
  baseDamageEventId: DamageEventId,
): DamageEventId {
  return `${baseDamageEventId}:momentum-pressure` as DamageEventId
}

export function getMomentumPressureExtraDamage(momentumPressure: number): number {
  if (!Number.isSafeInteger(momentumPressure) || momentumPressure < 0) {
    return Number.NaN
  }
  const result = momentumPressure * 3
  return Number.isSafeInteger(result) ? result : Number.NaN
}

function failure(
  state: BattleState,
  reason: MomentumPressureErrorCode,
): MomentumPressureFailure {
  return { ok: false, state, events: [], reason }
}

export function recalculateMomentumPressure(
  state: BattleState,
  ownerUnitId: UnitId,
  turn: PersonalTurnState,
): MomentumPressureResult {
  const invalidUnits = validateBattleStateUnits(state)
  if (invalidUnits !== null) return failure(state, invalidUnits)
  if (
    state.personalTurn?.personalTurnId !== turn.personalTurnId
    || turn.phase !== PersonalTurnPhase.StartingSystemRules
  ) {
    return failure(state, 'NOT_AT_MOMENTUM_PRESSURE_RECALCULATION_BOUNDARY')
  }
  const unit = state.units.find((candidate) => candidate.id === ownerUnitId)
  if (unit === undefined) {
    return failure(state, 'MOMENTUM_PRESSURE_OWNER_NOT_FOUND')
  }
  if (!unit.alive || (!unit.hasInfiniteHealth && unit.currentHealth <= 0)) {
    return failure(state, 'MOMENTUM_PRESSURE_OWNER_DEAD')
  }
  const invalidBaseAttack = validateBattleEntryBaseAttack(unit)
  if (invalidBaseAttack !== null) return failure(state, invalidBaseAttack)
  if (unit.system !== UnitSystem.Momentum) {
    return { ok: true, state, events: [], changed: false }
  }
  if (!Number.isSafeInteger(unit.momentum) || unit.momentum < 0
    || !Number.isSafeInteger(unit.momentumPressure)
    || unit.momentumPressure < 0) {
    return failure(state, 'INVALID_MOMENTUM_PRESSURE_VALUE')
  }
  const momentumAttackCap = getMomentumAttackCap(unit.baseAttackAtBattleEntry)
  if (!Number.isFinite(momentumAttackCap) || momentumAttackCap <= 0) {
    return failure(state, 'INVALID_UNIT_BASE_ATTACK')
  }
  const momentumAttackBonus = getMomentumAttackBonus(
    unit.baseAttackAtBattleEntry,
    getMomentumAttackLayers(unit),
  )
  const pressureLayers = getMomentumPressureLayers(unit)
  if (!Number.isFinite(momentumAttackBonus)
    || !Number.isSafeInteger(pressureLayers)
    || pressureLayers < 0) {
    return failure(state, 'INVALID_MOMENTUM_PRESSURE_VALUE')
  }
  const nextPressure = momentumAttackBonus < momentumAttackCap
    ? 0
    : Math.floor(pressureLayers / 10)
  if (!Number.isSafeInteger(nextPressure)) {
    return failure(state, 'INVALID_MOMENTUM_PRESSURE_VALUE')
  }
  const shieldGain = nextPressure * 5
  if (!Number.isSafeInteger(shieldGain)) {
    return failure(state, 'MOMENTUM_PRESSURE_SHIELD_OVERFLOW')
  }
  const recalculatedEvent: BattleEvent = {
    type: 'MOMENTUM_PRESSURE_RECALCULATED',
    unitId: unit.id,
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    momentum: unit.momentum,
    before: unit.momentumPressure,
    after: nextPressure,
  }
  const pressureState: BattleState = {
    ...state,
    units: state.units.map((candidate) => candidate.id === unit.id
      ? { ...candidate, momentumPressure: nextPressure }
      : candidate),
  }
  const shieldResult = shieldGain === 0
    ? null
    : gainShield(pressureState, {
        unitId: unit.id,
        amount: shieldGain,
        reason: 'momentumPressure',
        sourceUnitId: unit.id,
        effectId: 'momentumPressure',
        personalTurnId: turn.personalTurnId,
        sequenceId: turn.sequenceId,
        skillExecutionId: null,
      })
  if (shieldResult !== null && !shieldResult.ok) {
    return failure(state, 'MOMENTUM_PRESSURE_SHIELD_OVERFLOW')
  }
  const events = shieldResult === null
    ? [recalculatedEvent]
    : [recalculatedEvent, ...shieldResult.events]
  const nextState = shieldResult === null
    ? pressureState
    : { ...shieldResult.state, events: state.events }
  return {
    ok: true,
    state: nextState,
    events,
    changed: nextPressure !== unit.momentumPressure || shieldGain > 0,
  }
}

export function clearMomentumPressure(
  state: BattleState,
  ownerUnitId: UnitId,
  turn: PersonalTurnState,
): MomentumPressureResult {
  const invalidUnits = validateBattleStateUnits(state)
  if (invalidUnits !== null) return failure(state, invalidUnits)
  if (
    state.personalTurn?.personalTurnId !== turn.personalTurnId
    || turn.phase !== PersonalTurnPhase.EndingSpecialVariables
  ) {
    return failure(state, 'NOT_AT_MOMENTUM_PRESSURE_CLEAR_BOUNDARY')
  }
  const unit = state.units.find((candidate) => candidate.id === ownerUnitId)
  if (unit === undefined) {
    return failure(state, 'MOMENTUM_PRESSURE_OWNER_NOT_FOUND')
  }
  if (!Number.isSafeInteger(unit.momentumPressure)
    || unit.momentumPressure < 0) {
    return failure(state, 'INVALID_MOMENTUM_PRESSURE_VALUE')
  }
  if (unit.momentumPressure === 0) {
    return { ok: true, state, events: [], changed: false }
  }
  const event: BattleEvent = {
    type: 'MOMENTUM_PRESSURE_CLEARED',
    unitId: unit.id,
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    before: unit.momentumPressure,
    after: 0,
  }
  return {
    ok: true,
    state: {
      ...state,
      units: state.units.map((candidate) => candidate.id === unit.id
        ? { ...candidate, momentumPressure: 0 }
        : candidate),
    },
    events: [event],
    changed: true,
  }
}
