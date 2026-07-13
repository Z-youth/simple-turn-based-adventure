import type { BattleEngineExtensions, BattleTransitionResult } from '../../core/battleEngine'
import type { BattleState, PersonalTurnState } from '../../core/contexts'
import {
  BattlePhase,
  Camp,
  PersonalTurnPhase,
  Position,
  StatusCategory,
  UnitSystem,
} from '../../core/enums'
import type { BattleEvent } from '../../core/events'
import type { SpecialCounterId, UnitId } from '../../core/identifiers'
import { removeBattleStatus } from '../../core/statusEngine'
import {
  decreaseSpecialCounter,
  increaseSpecialCounter,
  readSpecialCounter,
} from '../../core/specialCounters'
import { gainResource, ResourceType } from '../../core/resources'
import {
  applyTemporaryAttributeModifier,
  TemporaryAttribute,
} from '../../core/temporaryModifiers'
import { isUnitAlive } from '../../core/unitQueries'
import type { UnitState } from '../../core/units'

export const WANG_DAHAI_UNIT_ID = 'character:wang-dahai' as UnitId
export const WANG_DAHAI_TIDE_COUNTER_ID =
  'counter:wang-dahai:tide' as SpecialCounterId
export const WANG_DAHAI_FREE_MYRIAD_RIVERS_MARKER_ID =
  'counter:wang-dahai:free-myriad-rivers' as SpecialCounterId

const HIGH_MOMENTUM_THRESHOLD = 10
const LOW_MOMENTUM_ENERGY_GAIN = 2
const RISING_MOMENTUM_GAIN = 1
const RISING_ATTACK_GAIN = 2
const RISING_MOMENTUM_REASON = 'wangDahaiRisingMomentum'

export interface WangDahaiEffectSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

export interface WangDahaiEffectFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: string
}

export type WangDahaiEffectResult =
  | WangDahaiEffectSuccess
  | WangDahaiEffectFailure

function failure(
  state: BattleState,
  reason: string,
): WangDahaiEffectFailure {
  return { ok: false, state, events: [], reason }
}

function findWangDahai(state: BattleState): UnitState | null {
  const unit = state.units.find((candidate) => candidate.id === WANG_DAHAI_UNIT_ID)
  return unit !== undefined && isUnitAlive(unit) ? unit : null
}

function withPassiveApplied(
  state: BattleState,
  turn: PersonalTurnState,
): BattleState {
  return {
    ...state,
    personalTurn: {
      ...turn,
      unitPassiveEffectsApplied: true,
    },
  }
}

function clearFreeMyriadRiversMarker(
  state: BattleState,
  unit: UnitState,
  turn: PersonalTurnState,
): WangDahaiEffectResult {
  const marker = readSpecialCounter(
    unit,
    WANG_DAHAI_FREE_MYRIAD_RIVERS_MARKER_ID,
  )
  if (marker === 0) return { ok: true, state, events: [] }
  return decreaseSpecialCounter(state, {
    unitId: unit.id,
    counterId: WANG_DAHAI_FREE_MYRIAD_RIVERS_MARKER_ID,
    amount: marker,
    actionId: null,
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    skillExecutionId: null,
  })
}

export function createWangDahai(): UnitState {
  return {
    id: WANG_DAHAI_UNIT_ID,
    name: '王大海',
    camp: Camp.Player,
    system: UnitSystem.Momentum,
    isBoss: false,
    position: Position.Front1,
    deploymentOrder: 0,
    currentHealth: 160,
    maximumHealth: 160,
    hasInfiniteHealth: false,
    baseAttackAtBattleEntry: 20,
    temporaryAttributeModifiers: [],
    speed: 100,
    shield: 0,
    criticalRate: 0,
    criticalDamage: 0.5,
    normalDamageIncrease: 0,
    normalDamageReductionSources: [],
    extraDamageIncrease: 0,
    extraDamageReduction: 0,
    energy: 0,
    momentum: 0,
    intent: 0,
    magic: 0,
    momentumPressure: 0,
    specialCounters: [],
    resourceReductionProtections: [],
    alive: true,
  }
}

export function hasFreeMyriadRiversAtTurnEnd(unit: UnitState): boolean {
  return readSpecialCounter(
    unit,
    WANG_DAHAI_FREE_MYRIAD_RIVERS_MARKER_ID,
  ) > 0
}

export function applyWangDahaiTurnStartPassive(
  state: BattleState,
): WangDahaiEffectResult {
  const turn = state.personalTurn
  const unit = findWangDahai(state)
  if (turn === null || unit === null || turn.unitId !== WANG_DAHAI_UNIT_ID) {
    return failure(state, 'WANG_DAHAI_NOT_READY_FOR_TURN_PASSIVE')
  }
  if (turn.unitPassiveEffectsApplied) {
    return { ok: true, state, events: [] }
  }
  if (
    state.phase !== BattlePhase.TurnStart
    || turn.phase !== PersonalTurnPhase.StartingUnitPassives
  ) return failure(state, 'WANG_DAHAI_NOT_AT_UNIT_PASSIVE_STAGE')

  const cleared = clearFreeMyriadRiversMarker(state, unit, turn)
  if (!cleared.ok) return failure(state, cleared.reason)
  const events = [...cleared.events]
  if (unit.momentum < HIGH_MOMENTUM_THRESHOLD) {
    const gained = gainResource(cleared.state, {
      unitId: unit.id,
      resourceType: ResourceType.Energy,
      amount: LOW_MOMENTUM_ENERGY_GAIN,
      reason: 'wangDahaiTidalBladeMomentum',
      sourceId: String(unit.id),
      actionId: null,
      personalTurnId: turn.personalTurnId,
      sequenceId: turn.sequenceId,
      skillExecutionId: null,
      resourceTransactionId: null,
    })
    if (!gained.ok) return failure(state, gained.reason)
    events.push(...gained.events)
    return {
      ok: true,
      state: withPassiveApplied(gained.state, turn),
      events,
    }
  }

  const marked = increaseSpecialCounter(cleared.state, {
    unitId: unit.id,
    counterId: WANG_DAHAI_FREE_MYRIAD_RIVERS_MARKER_ID,
    amount: 1,
    actionId: null,
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    skillExecutionId: null,
  })
  if (!marked.ok) return failure(state, marked.reason)
  events.push(...marked.events)
  return {
    ok: true,
    state: withPassiveApplied(marked.state, turn),
    events,
  }
}

function debuffStackCount(state: BattleState): number {
  return state.statusBatches.reduce((total, batch) => (
    batch.ownerUnitId === WANG_DAHAI_UNIT_ID
      && batch.category === StatusCategory.Debuff
      ? total + batch.stacks
      : total
  ), 0)
}

function risingMomentumAlreadyApplied(state: BattleState): boolean {
  const actionId = state.activeAction?.actionId
  return actionId !== undefined && actionId !== null && state.events.some((event) => (
    event.type === 'RESOURCE_GAINED'
    && event.actionId === actionId
    && event.reason === RISING_MOMENTUM_REASON
  ))
}

export function applyWangDahaiRisingMomentum(
  state: BattleState,
): WangDahaiEffectResult {
  const rollbackState = state.actionRollbackState ?? state
  const turn = state.personalTurn
  const action = state.activeAction
  const unit = findWangDahai(state)
  if (
    state.phase !== BattlePhase.ResolvingAction
    || turn === null
    || turn.phase !== PersonalTurnPhase.ResolvingAction
    || action === null
    || action.actorId !== WANG_DAHAI_UNIT_ID
    || turn.unitId !== WANG_DAHAI_UNIT_ID
    || !action.countsAsAction
    || unit === null
  ) return failure(rollbackState, 'WANG_DAHAI_NOT_READY_FOR_RISING_MOMENTUM')
  if (risingMomentumAlreadyApplied(state)) {
    return { ok: true, state, events: [] }
  }

  const hadDebuff = debuffStackCount(state) > 0
  const gained = gainResource(state, {
    unitId: unit.id,
    resourceType: ResourceType.Momentum,
    amount: RISING_MOMENTUM_GAIN,
    reason: RISING_MOMENTUM_REASON,
    sourceId: String(unit.id),
    actionId: action.actionId,
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    skillExecutionId: action.skillExecutionId,
    resourceTransactionId: null,
  })
  if (!gained.ok) return failure(rollbackState, gained.reason)

  if (hadDebuff) {
    const removed = removeBattleStatus(gained.state, {
      ownerUnitId: unit.id,
      mode: 'remove',
      category: StatusCategory.Debuff,
    })
    if (!removed.ok) return failure(rollbackState, removed.reason)
    if (debuffStackCount(removed.state) !== debuffStackCount(state) - 1) {
      return failure(rollbackState, 'WANG_DAHAI_DEBUFF_REMOVAL_FAILED')
    }
    return {
      ok: true,
      state: removed.state,
      events: [...gained.events, ...removed.events],
    }
  }

  const modified = applyTemporaryAttributeModifier(gained.state, {
    unitId: unit.id,
    sourceId: unit.id,
    attribute: TemporaryAttribute.Attack,
    value: RISING_ATTACK_GAIN,
    duration: { kind: 'currentPersonalTurn' },
    actionId: action.actionId,
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    skillExecutionId: action.skillExecutionId,
  })
  if (!modified.ok) return failure(rollbackState, modified.reason)
  return {
    ok: true,
    state: modified.state,
    events: [...gained.events, ...modified.events],
  }
}

export const WANG_DAHAI_BATTLE_EXTENSIONS: BattleEngineExtensions = {
  applyUnitPassiveEffects(state, turn): BattleTransitionResult {
    if (turn.unitId !== WANG_DAHAI_UNIT_ID) {
      return { ok: true, state, events: [] }
    }
    return applyWangDahaiTurnStartPassive(state)
  },
}
