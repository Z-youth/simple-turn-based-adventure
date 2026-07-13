import type { BattleState } from './contexts'
import type { BattleEvent } from './events'
import type {
  AttackId,
  DamageEventId,
  SkillExecutionId,
  UnitId,
} from './identifiers'
import { clampMinimum, roundDecimalResult } from './rounding'

export interface VitalityState {
  readonly currentHealth: number
  readonly hasInfiniteHealth: boolean
  readonly alive: boolean
}

export type VitalityChange =
  | { readonly kind: 'healthLoss'; readonly amount: number }
  | {
      readonly kind: 'percentageMaximumHealthDamage'
      readonly maximumHealth: number
      readonly percentage: number
    }
  | { readonly kind: 'defeat'; readonly cause: 'execute' | 'directDeath' }
  | {
      readonly kind: 'setState'
      readonly currentHealth: number
      readonly alive: boolean
    }

export interface VitalityChangeSuccess {
  readonly ok: true
  readonly healthLost: number
  readonly remainingHealth: number
  readonly alive: boolean
  readonly causedDeath: boolean
  readonly targetWasAlreadyDead: boolean
}

export interface VitalityChangeFailure {
  readonly ok: false
  readonly reason: 'INVALID_VITALITY_CHANGE'
}

export type VitalityChangeResult =
  | VitalityChangeSuccess
  | VitalityChangeFailure

export interface UnitDefeatRequest {
  readonly unitId: UnitId
  readonly cause: 'execute' | 'directDeath'
  readonly skillExecutionId: SkillExecutionId
  readonly attackId: AttackId
  readonly damageEventId: DamageEventId
}

export interface UnitPercentageMaximumHealthDamageRequest {
  readonly unitId: UnitId
  readonly percentage: number
  readonly skillExecutionId: SkillExecutionId
  readonly attackId: AttackId
  readonly damageEventId: DamageEventId
}

export interface UnitVitalStateRequest {
  readonly unitId: UnitId
  readonly currentHealth: number
  readonly alive: boolean
  readonly skillExecutionId: SkillExecutionId
  readonly attackId: AttackId
  readonly damageEventId: DamageEventId
}

export interface VitalityBattleSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
  readonly changed: boolean
}

export interface VitalityBattleFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: 'VITALITY_UNIT_NOT_FOUND' | 'INVALID_VITALITY_CHANGE'
}

export type VitalityBattleResult = VitalityBattleSuccess | VitalityBattleFailure

function changeIsValid(change: VitalityChange): boolean {
  switch (change.kind) {
    case 'healthLoss':
      return Number.isFinite(change.amount) && change.amount >= 0
    case 'percentageMaximumHealthDamage':
      return Number.isFinite(change.maximumHealth)
        && change.maximumHealth >= 0
        && Number.isFinite(change.percentage)
        && change.percentage >= 0
    case 'defeat':
      return true
    case 'setState':
      return Number.isFinite(change.currentHealth) && change.currentHealth >= 0
  }
}

export function resolveVitalityChange(
  state: VitalityState,
  change: VitalityChange,
): VitalityChangeResult {
  if (
    !Number.isFinite(state.currentHealth)
    || state.currentHealth < 0
    || !changeIsValid(change)
  ) return { ok: false, reason: 'INVALID_VITALITY_CHANGE' }

  if (state.hasInfiniteHealth) {
    return {
      ok: true,
      healthLost: 0,
      remainingHealth: state.currentHealth,
      alive: true,
      causedDeath: false,
      targetWasAlreadyDead: false,
    }
  }

  const targetWasAlreadyDead = !state.alive || state.currentHealth <= 0
  if (targetWasAlreadyDead) {
    return {
      ok: true,
      healthLost: 0,
      remainingHealth: state.currentHealth,
      alive: false,
      causedDeath: false,
      targetWasAlreadyDead: true,
    }
  }

  let requestedHealth: number
  let requestedAlive = true
  switch (change.kind) {
    case 'healthLoss':
      requestedHealth = state.currentHealth - change.amount
      break
    case 'percentageMaximumHealthDamage':
      requestedHealth = state.currentHealth
        - change.maximumHealth * change.percentage
      break
    case 'defeat':
      requestedHealth = 0
      requestedAlive = false
      break
    case 'setState':
      requestedHealth = change.currentHealth
      requestedAlive = change.alive
      break
  }
  const remainingHealth = roundDecimalResult(clampMinimum(requestedHealth, 0))
  const alive = requestedAlive && remainingHealth > 0
  const healthLost = roundDecimalResult(
    clampMinimum(state.currentHealth - remainingHealth, 0),
  )
  return {
    ok: true,
    healthLost,
    remainingHealth,
    alive,
    causedDeath: !alive,
    targetWasAlreadyDead: false,
  }
}

function applyVitalityChangeToBattle(
  state: BattleState,
  unitId: UnitId,
  change: VitalityChange,
  context: Pick<
    UnitDefeatRequest,
    'skillExecutionId' | 'attackId' | 'damageEventId'
  >,
  recordHealthLoss = false,
): VitalityBattleResult {
  const unit = state.units.find((candidate) => candidate.id === unitId)
  if (unit === undefined) {
    return {
      ok: false,
      state,
      events: [],
      reason: 'VITALITY_UNIT_NOT_FOUND',
    }
  }
  const result = resolveVitalityChange(unit, change)
  if (!result.ok) {
    return { ok: false, state, events: [], reason: result.reason }
  }
  const changed = result.remainingHealth !== unit.currentHealth
    || result.alive !== unit.alive
  if (!changed) return { ok: true, state, events: [], changed: false }

  const healthEvent: BattleEvent | null = recordHealthLoss
    && result.healthLost > 0
    ? {
        type: 'HEALTH_LOST',
        skillExecutionId: context.skillExecutionId,
        attackId: context.attackId,
        damageEventId: context.damageEventId,
        targetId: unitId,
        amount: result.healthLost,
        remainingHealth: result.remainingHealth,
        targetWasAlreadyDead: result.targetWasAlreadyDead,
      }
    : null
  const deathEvent: BattleEvent | null = result.causedDeath
    ? {
        type: 'UNIT_DIED',
        skillExecutionId: context.skillExecutionId,
        attackId: context.attackId,
        damageEventId: context.damageEventId,
        unitId,
      }
    : null
  const events: BattleEvent[] = []
  if (healthEvent !== null) events.push(healthEvent)
  if (deathEvent !== null) events.push(deathEvent)
  return {
    ok: true,
    state: {
      ...state,
      units: state.units.map((candidate) => candidate.id === unitId
        ? {
            ...candidate,
            currentHealth: result.remainingHealth,
            alive: result.alive,
          }
        : candidate),
      events: [...state.events, ...events],
    },
    events,
    changed: true,
  }
}

export function requestUnitDefeat(
  state: BattleState,
  request: UnitDefeatRequest,
): VitalityBattleResult {
  return applyVitalityChangeToBattle(
    state,
    request.unitId,
    { kind: 'defeat', cause: request.cause },
    request,
  )
}

export function requestUnitPercentageMaximumHealthDamage(
  state: BattleState,
  request: UnitPercentageMaximumHealthDamageRequest,
): VitalityBattleResult {
  const unit = state.units.find((candidate) => candidate.id === request.unitId)
  if (unit === undefined) {
    return {
      ok: false,
      state,
      events: [],
      reason: 'VITALITY_UNIT_NOT_FOUND',
    }
  }
  return applyVitalityChangeToBattle(
    state,
    request.unitId,
    {
      kind: 'percentageMaximumHealthDamage',
      maximumHealth: unit.maximumHealth,
      percentage: request.percentage,
    },
    request,
    true,
  )
}

export function requestUnitVitalState(
  state: BattleState,
  request: UnitVitalStateRequest,
): VitalityBattleResult {
  return applyVitalityChangeToBattle(
    state,
    request.unitId,
    {
      kind: 'setState',
      currentHealth: request.currentHealth,
      alive: request.alive,
    },
    request,
  )
}
