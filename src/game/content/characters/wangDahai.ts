import type {
  NormalAttackRequest,
  SkillEffectRequest,
  SkillResolutionRequest,
} from '../../core/attacks'
import {
  completeBattleAction,
  startBattleAction,
} from '../../core/battleEngine'
import type { BattleEngineExtensions, BattleTransitionResult } from '../../core/battleEngine'
import type {
  ActionContext,
  BattleState,
  PersonalTurnState,
} from '../../core/contexts'
import {
  BattlePhase,
  Camp,
  DamageType,
  PersonalTurnPhase,
  Position,
  StatusCategory,
  UnitSystem,
} from '../../core/enums'
import type { BattleEvent } from '../../core/events'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  ResourceTransactionId,
  SkillBranchId,
  SkillExecutionId,
  SkillId,
  SpecialCounterId,
  UnitId,
} from '../../core/identifiers'
import { resolveResourcePaidSkillTransaction } from '../../core/resourceTransaction'
import {
  resolveTriggeredSkillTransaction,
  resolveTurnEndTriggeredSkillTransaction,
} from '../../core/resolutionTransaction'
import { removeBattleStatus } from '../../core/statusEngine'
import {
  decreaseSpecialCounter,
  increaseSpecialCounter,
  readSpecialCounter,
} from '../../core/specialCounters'
import {
  gainResource,
  ResourceType,
  spendResource as decreaseResource,
} from '../../core/resources'
import {
  applyTemporaryAttributeModifier,
  TemporaryAttribute,
} from '../../core/temporaryModifiers'
import {
  getEffectiveAttack,
  getEffectiveCriticalDamage,
  getEffectiveCriticalRate,
  isUnitAlive,
} from '../../core/unitQueries'
import type { UnitState } from '../../core/units'
import { roundIntegerResult } from '../../core/rounding'

export const WANG_DAHAI_UNIT_ID = 'character:wang-dahai' as UnitId
export const WANG_DAHAI_TIDE_COUNTER_ID =
  'counter:wang-dahai:tide' as SpecialCounterId
export const WANG_DAHAI_FREE_MYRIAD_RIVERS_MARKER_ID =
  'counter:wang-dahai:free-myriad-rivers' as SpecialCounterId
export const WANG_DAHAI_STACKING_WAVE_USE_COUNT_ID =
  'counter:wang-dahai:stacking-wave-use-count' as SpecialCounterId
export const WANG_DAHAI_STACKING_WAVE_SKILL_LOCK_ID =
  'counter:wang-dahai:stacking-wave-skill-lock' as SpecialCounterId
export const WANG_DAHAI_FIRST_SKILL_ID =
  'skill:wang-dahai:first' as SkillId
export const WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID =
  'skill:wang-dahai:myriad-rivers' as SkillId
export const WANG_DAHAI_THIRD_SKILL_ID =
  'skill:wang-dahai:moonlit-tide' as SkillId
export const WANG_DAHAI_NEW_TIDE_BRANCH_ID =
  'skill-branch:wang-dahai:new-tide' as SkillBranchId
export const WANG_DAHAI_STACKING_WAVE_BRANCH_ID =
  'skill-branch:wang-dahai:stacking-wave' as SkillBranchId

const HIGH_MOMENTUM_THRESHOLD = 10
const LOW_MOMENTUM_ENERGY_GAIN = 2
const RISING_MOMENTUM_GAIN = 1
const RISING_ATTACK_GAIN = 2
const RISING_MOMENTUM_REASON = 'wangDahaiRisingMomentum'
const NEW_TIDE_ENERGY_GAIN = 2
const NEW_TIDE_MOMENTUM_GAIN = 1
export const STACKING_WAVE_ENERGY_COST = 1
const STACKING_WAVE_MAX_MOMENTUM_GAIN = 6
const MYRIAD_RIVERS_MOMENTUM_THRESHOLD = 10
const MYRIAD_RIVERS_MOMENTUM_REDUCTION = 10
export const MOONLIT_TIDE_ENERGY_COST = 5
const MOONLIT_TIDE_CRITICAL_RATE_GAIN = 0.2
const MOONLIT_TIDE_CRITICAL_DAMAGE_GAIN = 0.5
const MOONLIT_TIDE_DURATION_TURNS = 2
const MOONLIT_TIDE_TIDE_GAIN = 2

export interface WangDahaiFirstSkillRequest {
  readonly branchId: SkillBranchId
  readonly targetUnitId: UnitId
  readonly actionId: ActionId
  readonly skillExecutionId: SkillExecutionId
  readonly attackId: AttackId
  readonly damageEventId: DamageEventId
  readonly resourceTransactionId: ResourceTransactionId
}

export interface WangDahaiThirdSkillRequest {
  readonly actionId: ActionId
  readonly skillExecutionId: SkillExecutionId
  readonly resourceTransactionId: ResourceTransactionId
}

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

function clearSpecialCounter(
  state: BattleState,
  turn: PersonalTurnState,
  counterId: SpecialCounterId,
): WangDahaiEffectResult {
  const unit = state.units.find((candidate) => (
    candidate.id === WANG_DAHAI_UNIT_ID
  ))
  if (unit === undefined) return failure(state, 'WANG_DAHAI_NOT_FOUND')
  const marker = readSpecialCounter(
    unit,
    counterId,
  )
  if (marker === 0) return { ok: true, state, events: [] }
  return decreaseSpecialCounter(state, {
    unitId: unit.id,
    counterId,
    amount: marker,
    sourceUnitId: unit.id,
    effectId: 'wangDahaiTidalBladeMomentum',
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
    resourceReductionProtections: [{
      resourceType: ResourceType.Momentum,
      counterId: WANG_DAHAI_TIDE_COUNTER_ID,
      minimumCounterValue: 1,
    }],
    alive: true,
  }
}

export function hasFreeMyriadRiversAtTurnEnd(unit: UnitState): boolean {
  return readSpecialCounter(
    unit,
    WANG_DAHAI_FREE_MYRIAD_RIVERS_MARKER_ID,
  ) > 0
}

export function resetWangDahaiTurnCounters(
  state: BattleState,
  turn: PersonalTurnState,
): WangDahaiEffectResult {
  if (turn.unitId !== WANG_DAHAI_UNIT_ID) {
    return { ok: true, state, events: [] }
  }
  if (
    state.phase !== BattlePhase.TurnStart
    || turn.phase !== PersonalTurnPhase.StartingTurnCounterReset
  ) return failure(state, 'WANG_DAHAI_NOT_AT_TURN_COUNTER_RESET_STAGE')

  let currentState = state
  const events: BattleEvent[] = []
  for (const counterId of [
    WANG_DAHAI_FREE_MYRIAD_RIVERS_MARKER_ID,
    WANG_DAHAI_STACKING_WAVE_USE_COUNT_ID,
    WANG_DAHAI_STACKING_WAVE_SKILL_LOCK_ID,
  ]) {
    const cleared = clearSpecialCounter(currentState, turn, counterId)
    if (!cleared.ok) return failure(state, cleared.reason)
    currentState = cleared.state
    events.push(...cleared.events)
  }
  return { ok: true, state: currentState, events }
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

  const passiveState = state
  const events: BattleEvent[] = []
  if (unit.momentum < HIGH_MOMENTUM_THRESHOLD) {
    const gained = gainResource(passiveState, {
      unitId: unit.id,
      resourceType: ResourceType.Energy,
      amount: LOW_MOMENTUM_ENERGY_GAIN,
      reason: 'wangDahaiTidalBladeMomentum',
      sourceId: String(unit.id),
      sourceUnitId: unit.id,
      effectId: 'wangDahaiTidalBladeMomentum',
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

  const marked = increaseSpecialCounter(passiveState, {
    unitId: unit.id,
    counterId: WANG_DAHAI_FREE_MYRIAD_RIVERS_MARKER_ID,
    amount: 1,
    sourceUnitId: unit.id,
    effectId: 'wangDahaiTidalBladeMomentum',
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

  const gained = gainResource(state, {
    unitId: unit.id,
    resourceType: ResourceType.Momentum,
    amount: RISING_MOMENTUM_GAIN,
    reason: RISING_MOMENTUM_REASON,
    sourceId: String(unit.id),
    sourceUnitId: unit.id,
    effectId: RISING_MOMENTUM_REASON,
    actionId: action.actionId,
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    skillExecutionId: action.skillExecutionId,
    resourceTransactionId: null,
  })
  if (!gained.ok) return failure(rollbackState, gained.reason)

  const cleansed = removeBattleStatus(gained.state, {
    ownerUnitId: unit.id,
    mode: 'cleanse',
    origin: {
      sourceUnitId: unit.id,
      skillExecutionId: action.skillExecutionId,
      effectId: RISING_MOMENTUM_REASON,
    },
  })
  if (!cleansed.ok) return failure(rollbackState, cleansed.reason)

  if (debuffStackCount(cleansed.state) > 0) {
    return {
      ok: true,
      state: cleansed.state,
      events: [...gained.events, ...cleansed.events],
    }
  }

  const modified = applyTemporaryAttributeModifier(cleansed.state, {
    unitId: unit.id,
    sourceUnitId: unit.id,
    effectId: unit.id,
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
    events: [...gained.events, ...cleansed.events, ...modified.events],
  }
}

export function getWangDahaiStackingWaveUseCount(unit: UnitState): number {
  return readSpecialCounter(unit, WANG_DAHAI_STACKING_WAVE_USE_COUNT_ID)
}

export function isWangDahaiActiveSkillAllowed(
  unit: UnitState,
  skillId: SkillId,
  branchId: SkillBranchId | null = null,
): boolean {
  if (unit.id !== WANG_DAHAI_UNIT_ID) return false
  const locked = readSpecialCounter(
    unit,
    WANG_DAHAI_STACKING_WAVE_SKILL_LOCK_ID,
  ) > 0
  return !locked || (
    skillId === WANG_DAHAI_FIRST_SKILL_ID
    && branchId === WANG_DAHAI_STACKING_WAVE_BRANCH_ID
  )
}

function myriadRiversExecutionPrefix(action: ActionContext): string {
  return `${action.personalTurnId}:${action.actionId}:wang-dahai:myriad-rivers`
}

function createMyriadRiversAttack(
  unit: UnitState,
  enemies: readonly UnitState[],
  prefix: string,
): NormalAttackRequest {
  return {
    attackId: `${prefix}:attack` as AttackId,
    damageType: DamageType.Normal,
    effectiveAttack: getEffectiveAttack(unit),
    multiplier: 1,
    fixedDamage: 0,
    criticalRate: getEffectiveCriticalRate(unit),
    criticalDamage: getEffectiveCriticalDamage(unit),
    normalDamageIncrease: unit.normalDamageIncrease,
    targets: enemies.map((target) => ({
      targetId: target.id,
      damageEventId: `${prefix}:damage:${target.id}` as DamageEventId,
    })),
  }
}

export function applyAutomaticWangDahaiMyriadRivers(
  state: BattleState,
  action: ActionContext,
): WangDahaiEffectResult {
  const turn = state.personalTurn
  const unit = findWangDahai(state)
  if (
    !action.countsAsAction
    || action.actorId !== WANG_DAHAI_UNIT_ID
    || turn === null
    || turn.personalTurnId !== action.personalTurnId
    || turn.phase !== PersonalTurnPhase.AwaitingAction
    || unit === null
  ) return { ok: true, state, events: [] }
  if (unit.momentum < MYRIAD_RIVERS_MOMENTUM_THRESHOLD) {
    return { ok: true, state, events: [] }
  }

  const enemies = state.units.filter((candidate) => (
    candidate.camp !== unit.camp && isUnitAlive(candidate)
  ))
  if (enemies.length === 0) return { ok: true, state, events: [] }

  const prefix = myriadRiversExecutionPrefix(action)
  const skillExecutionId = `${prefix}:skill-execution` as SkillExecutionId
  if (state.resolutionIds.skillExecutionIds.includes(skillExecutionId)) {
    return { ok: true, state, events: [] }
  }
  const attack = createMyriadRiversAttack(unit, enemies, prefix)
  const resolved = resolveTriggeredSkillTransaction(state, {
    skillExecutionId,
    skillId: WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID,
    actionId: action.actionId,
    personalTurnId: action.personalTurnId,
    sequenceId: action.sequenceId,
    casterId: unit.id,
    attacks: [attack],
    effects: [
      { kind: 'attack', attack },
      {
        kind: 'resource',
        operation: 'spend',
        unitId: unit.id,
        resourceType: ResourceType.Momentum,
        amount: MYRIAD_RIVERS_MOMENTUM_REDUCTION,
        reason: 'wangDahaiMyriadRivers',
      },
    ],
  })
  if (!resolved.ok) return failure(state, resolved.reason)
  return resolved
}

export function applyFreeWangDahaiMyriadRivers(
  state: BattleState,
  turn: PersonalTurnState,
): WangDahaiEffectResult {
  const unit = findWangDahai(state)
  if (
    state.phase !== BattlePhase.TurnEnd
    || turn.unitId !== WANG_DAHAI_UNIT_ID
    || turn.phase !== PersonalTurnPhase.EndingUnitSpecificEffects
    || unit === null
  ) return failure(state, 'WANG_DAHAI_NOT_READY_FOR_FREE_MYRIAD_RIVERS')
  if (!hasFreeMyriadRiversAtTurnEnd(unit)) {
    return { ok: true, state, events: [] }
  }

  const enemies = state.units.filter((candidate) => (
    candidate.camp !== unit.camp && isUnitAlive(candidate)
  ))
  if (enemies.length === 0) return { ok: true, state, events: [] }

  const prefix = `${turn.personalTurnId}:wang-dahai:myriad-rivers:free`
  const skillExecutionId = `${prefix}:skill-execution` as SkillExecutionId
  if (state.resolutionIds.skillExecutionIds.includes(skillExecutionId)) {
    return { ok: true, state, events: [] }
  }
  const attack = createMyriadRiversAttack(unit, enemies, prefix)
  const resolved = resolveTurnEndTriggeredSkillTransaction(state, {
    skillExecutionId,
    skillId: WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID,
    actionId: null,
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    casterId: unit.id,
    attacks: [attack],
    effects: [{ kind: 'attack', attack }],
  })
  if (!resolved.ok) return failure(state, resolved.reason)
  return resolved
}

export function applyWangDahaiTurnEndEffects(
  state: BattleState,
  turn: PersonalTurnState,
): WangDahaiEffectResult {
  if (
    turn.unitId !== WANG_DAHAI_UNIT_ID
    || turn.phase !== PersonalTurnPhase.EndingUnitSpecificEffects
  ) return { ok: true, state, events: [] }

  const freeMyriadRivers = applyFreeWangDahaiMyriadRivers(state, turn)
  if (!freeMyriadRivers.ok) return failure(state, freeMyriadRivers.reason)
  const unit = freeMyriadRivers.state.units.find((candidate) => (
    candidate.id === WANG_DAHAI_UNIT_ID
  ))
  if (unit === undefined) return failure(state, 'WANG_DAHAI_NOT_FOUND')
  const tide = readSpecialCounter(unit, WANG_DAHAI_TIDE_COUNTER_ID)
  if (tide === 0) return freeMyriadRivers

  const decreased = decreaseSpecialCounter(freeMyriadRivers.state, {
    unitId: unit.id,
    counterId: WANG_DAHAI_TIDE_COUNTER_ID,
    amount: 1,
    sourceUnitId: unit.id,
    effectId: WANG_DAHAI_THIRD_SKILL_ID,
    actionId: null,
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    skillExecutionId: null,
  })
  if (!decreased.ok) return failure(state, decreased.reason)
  return {
    ok: true,
    state: decreased.state,
    events: [...freeMyriadRivers.events, ...decreased.events],
  }
}

export function applyWangDahaiAfterActionEffects(
  state: BattleState,
  action: ActionContext,
): WangDahaiEffectResult {
  if (action.actorId !== WANG_DAHAI_UNIT_ID || !action.countsAsAction) {
    return { ok: true, state, events: [] }
  }
  const myriadRivers = applyAutomaticWangDahaiMyriadRivers(
    state,
    action,
  )
  if (!myriadRivers.ok) return failure(state, myriadRivers.reason)
  return {
    ok: true,
    state: myriadRivers.state,
    events: myriadRivers.events,
  }
}

function createFirstSkillAttack(
  unit: UnitState,
  request: WangDahaiFirstSkillRequest,
): NormalAttackRequest {
  const newTide = request.branchId === WANG_DAHAI_NEW_TIDE_BRANCH_ID
  const attackUnit = newTide
    ? { ...unit, momentum: unit.momentum + NEW_TIDE_MOMENTUM_GAIN }
    : unit
  return {
    attackId: request.attackId,
    damageType: DamageType.Normal,
    effectiveAttack: getEffectiveAttack(attackUnit),
    multiplier: newTide ? 1 : 0.5,
    fixedDamage: 0,
    criticalRate: getEffectiveCriticalRate(unit),
    criticalDamage: getEffectiveCriticalDamage(unit),
    normalDamageIncrease: unit.normalDamageIncrease,
    targets: [{
      targetId: request.targetUnitId,
      damageEventId: request.damageEventId,
    }],
  }
}

function firstSkillEffects(
  request: WangDahaiFirstSkillRequest,
  attack: NormalAttackRequest,
  stackingWaveUseCount: number,
  stackingWaveSkillAlreadyLocked: boolean,
): readonly SkillEffectRequest[] {
  if (request.branchId === WANG_DAHAI_STACKING_WAVE_BRANCH_ID) {
    const momentumGain = Math.min(
      2 * stackingWaveUseCount,
      STACKING_WAVE_MAX_MOMENTUM_GAIN,
    )
    return [
      { kind: 'attack', attack },
      {
        kind: 'specialCounter',
        operation: 'increase',
        unitId: WANG_DAHAI_UNIT_ID,
        counterId: WANG_DAHAI_STACKING_WAVE_USE_COUNT_ID,
        amount: 1,
      },
      {
        kind: 'resource',
        operation: 'gain',
        unitId: WANG_DAHAI_UNIT_ID,
        resourceType: ResourceType.Momentum,
        amount: momentumGain,
        reason: 'wangDahaiStackingWave',
        sourceId: String(WANG_DAHAI_FIRST_SKILL_ID),
      },
      ...(stackingWaveSkillAlreadyLocked ? [] : [{
        kind: 'specialCounter' as const,
        operation: 'increase' as const,
        unitId: WANG_DAHAI_UNIT_ID,
        counterId: WANG_DAHAI_STACKING_WAVE_SKILL_LOCK_ID,
        amount: 1,
      }]),
    ]
  }
  return [
    {
      kind: 'resource',
      operation: 'gain',
      unitId: WANG_DAHAI_UNIT_ID,
      resourceType: ResourceType.Energy,
      amount: NEW_TIDE_ENERGY_GAIN,
      reason: 'wangDahaiNewTide',
    },
    {
      kind: 'resource',
      operation: 'gain',
      unitId: WANG_DAHAI_UNIT_ID,
      resourceType: ResourceType.Momentum,
      amount: NEW_TIDE_MOMENTUM_GAIN,
      reason: 'wangDahaiNewTide',
    },
    { kind: 'attack', attack },
  ]
}

export function useWangDahaiFirstSkill(
  state: BattleState,
  request: WangDahaiFirstSkillRequest,
  extensions: BattleEngineExtensions = WANG_DAHAI_BATTLE_EXTENSIONS,
): WangDahaiEffectResult {
  const turn = state.personalTurn
  const unit = findWangDahai(state)
  if (
    state.phase !== BattlePhase.AwaitingAction
    || turn === null
    || turn.phase !== PersonalTurnPhase.AwaitingAction
    || turn.unitId !== WANG_DAHAI_UNIT_ID
    || unit === null
  ) return failure(state, 'WANG_DAHAI_NOT_READY_FOR_FIRST_SKILL')
  if (
    request.branchId !== WANG_DAHAI_NEW_TIDE_BRANCH_ID
    && request.branchId !== WANG_DAHAI_STACKING_WAVE_BRANCH_ID
  ) return failure(state, 'WANG_DAHAI_FIRST_SKILL_BRANCH_NOT_SUPPORTED')
  if (!isWangDahaiActiveSkillAllowed(
    unit,
    WANG_DAHAI_FIRST_SKILL_ID,
    request.branchId,
  )) return failure(state, 'WANG_DAHAI_ACTIVE_SKILL_LOCKED')
  const target = state.units.find((candidate) => (
    candidate.id === request.targetUnitId
  ))
  if (
    target === undefined
    || target.camp === unit.camp
    || !isUnitAlive(target)
  ) return failure(state, 'WANG_DAHAI_FIRST_SKILL_INVALID_TARGET')

  const momentumSnapshot = Math.floor(unit.momentum)
  const stackingWave = request.branchId === WANG_DAHAI_STACKING_WAVE_BRANCH_ID
  const stackingWaveUseCount = getWangDahaiStackingWaveUseCount(unit) + 1
  const stackingWaveSkillAlreadyLocked = readSpecialCounter(
    unit,
    WANG_DAHAI_STACKING_WAVE_SKILL_LOCK_ID,
  ) > 0
  const started = startBattleAction(state, {
    actionId: request.actionId,
    actorId: unit.id,
    skillExecutionId: request.skillExecutionId,
    countsAsAction: true,
    endsTurn: !stackingWave,
  })
  if (!started.ok) return failure(state, started.reason)
  const rising = applyWangDahaiRisingMomentum(started.state)
  if (!rising.ok) return failure(state, rising.reason)
  const currentUnit = rising.state.units.find((candidate) => (
    candidate.id === WANG_DAHAI_UNIT_ID
  ))
  const currentAction = rising.state.activeAction
  const currentTurn = rising.state.personalTurn
  if (currentUnit === undefined || currentAction === null || currentTurn === null) {
    return failure(state, 'WANG_DAHAI_FIRST_SKILL_CONTEXT_MISSING')
  }

  const attack = createFirstSkillAttack(currentUnit, request)
  const skill: SkillResolutionRequest = {
    skillExecutionId: request.skillExecutionId,
    skillId: WANG_DAHAI_FIRST_SKILL_ID,
    branchId: request.branchId,
    actionId: request.actionId,
    personalTurnId: currentTurn.personalTurnId,
    sequenceId: currentAction.sequenceId,
    casterId: currentUnit.id,
    attacks: [attack],
    effects: firstSkillEffects(
      request,
      attack,
      stackingWaveUseCount,
      stackingWaveSkillAlreadyLocked,
    ),
  }
  const resolved = resolveResourcePaidSkillTransaction(
    rising.state,
    {
      resourceTransactionId: request.resourceTransactionId,
      actionId: request.actionId,
      personalTurnId: currentTurn.personalTurnId,
      sequenceId: currentAction.sequenceId,
      skillExecutionId: request.skillExecutionId,
      payerUnitId: currentUnit.id,
      costs: stackingWave
        ? [{ resourceType: ResourceType.Energy, amount: STACKING_WAVE_ENERGY_COST }]
        : [],
    },
    skill,
  )
  if (!resolved.ok) return failure(state, resolved.reason)

  let resolvedState = resolved.state
  if (!stackingWave && momentumSnapshot <= 1) {
    const currentTarget = resolvedState.units.find((candidate) => (
      candidate.id === request.targetUnitId
    ))
    if (currentTarget !== undefined && isUnitAlive(currentTarget)) {
      const reducedMomentum = roundIntegerResult(currentTarget.momentum / 2)
      if (reducedMomentum !== currentTarget.momentum) {
        const reduced = decreaseResource(resolvedState, {
          unitId: currentTarget.id,
          resourceType: ResourceType.Momentum,
          amount: currentTarget.momentum - reducedMomentum,
          reason: 'wangDahaiNewTide',
          sourceId: String(WANG_DAHAI_FIRST_SKILL_ID),
          sourceUnitId: currentUnit.id,
          effectId: String(WANG_DAHAI_FIRST_SKILL_ID),
          actionId: request.actionId,
          personalTurnId: currentTurn.personalTurnId,
          sequenceId: currentAction.sequenceId,
          skillExecutionId: request.skillExecutionId,
          resourceTransactionId: request.resourceTransactionId,
        })
        if (!reduced.ok) return failure(state, reduced.reason)
        resolvedState = reduced.state
      }
    }
  }

  const completed = completeBattleAction(
    resolvedState,
    request.actionId,
    extensions,
  )
  if (!completed.ok) return failure(completed.state, completed.reason)
  return {
    ok: true,
    state: completed.state,
    events: completed.state.events.slice(state.events.length),
  }
}

export function useWangDahaiThirdSkill(
  state: BattleState,
  request: WangDahaiThirdSkillRequest,
  extensions: BattleEngineExtensions = WANG_DAHAI_BATTLE_EXTENSIONS,
): WangDahaiEffectResult {
  const turn = state.personalTurn
  const unit = findWangDahai(state)
  if (
    state.phase !== BattlePhase.AwaitingAction
    || turn === null
    || turn.phase !== PersonalTurnPhase.AwaitingAction
    || turn.unitId !== WANG_DAHAI_UNIT_ID
    || unit === null
  ) return failure(state, 'WANG_DAHAI_NOT_READY_FOR_THIRD_SKILL')
  if (!isWangDahaiActiveSkillAllowed(unit, WANG_DAHAI_THIRD_SKILL_ID)) {
    return failure(state, 'WANG_DAHAI_ACTIVE_SKILL_LOCKED')
  }

  const started = startBattleAction(state, {
    actionId: request.actionId,
    actorId: unit.id,
    skillExecutionId: request.skillExecutionId,
    countsAsAction: true,
    endsTurn: false,
  })
  if (!started.ok) return failure(state, started.reason)
  const rising = applyWangDahaiRisingMomentum(started.state)
  if (!rising.ok) return failure(state, rising.reason)
  const currentAction = rising.state.activeAction
  const currentTurn = rising.state.personalTurn
  if (currentAction === null || currentTurn === null) {
    return failure(state, 'WANG_DAHAI_THIRD_SKILL_CONTEXT_MISSING')
  }

  const resolved = resolveResourcePaidSkillTransaction(
    rising.state,
    {
      resourceTransactionId: request.resourceTransactionId,
      actionId: request.actionId,
      personalTurnId: currentTurn.personalTurnId,
      sequenceId: currentAction.sequenceId,
      skillExecutionId: request.skillExecutionId,
      payerUnitId: unit.id,
      costs: [{
        resourceType: ResourceType.Energy,
        amount: MOONLIT_TIDE_ENERGY_COST,
      }],
    },
    {
      skillExecutionId: request.skillExecutionId,
      skillId: WANG_DAHAI_THIRD_SKILL_ID,
      resolutionKind: 'manual',
      actionId: request.actionId,
      personalTurnId: currentTurn.personalTurnId,
      sequenceId: currentAction.sequenceId,
      casterId: unit.id,
      attacks: [],
      effects: [
        {
          kind: 'temporaryAttribute',
          attribute: TemporaryAttribute.CriticalRate,
          unitId: unit.id,
          sourceId: WANG_DAHAI_THIRD_SKILL_ID,
          value: MOONLIT_TIDE_CRITICAL_RATE_GAIN,
          duration: {
            kind: 'ownerTurns',
            turns: MOONLIT_TIDE_DURATION_TURNS,
          },
        },
        {
          kind: 'temporaryAttribute',
          attribute: TemporaryAttribute.CriticalDamage,
          unitId: unit.id,
          sourceId: WANG_DAHAI_THIRD_SKILL_ID,
          value: MOONLIT_TIDE_CRITICAL_DAMAGE_GAIN,
          duration: {
            kind: 'ownerTurns',
            turns: MOONLIT_TIDE_DURATION_TURNS,
          },
        },
        {
          kind: 'specialCounter',
          operation: 'increase',
          unitId: unit.id,
          counterId: WANG_DAHAI_TIDE_COUNTER_ID,
          amount: MOONLIT_TIDE_TIDE_GAIN,
        },
      ],
    },
  )
  if (!resolved.ok) return failure(state, resolved.reason)
  const completed = completeBattleAction(
    resolved.state,
    request.actionId,
    extensions,
  )
  if (!completed.ok) return failure(completed.state, completed.reason)
  return {
    ok: true,
    state: completed.state,
    events: completed.state.events.slice(state.events.length),
  }
}

export const WANG_DAHAI_BATTLE_EXTENSIONS: BattleEngineExtensions = {
  resetUnitTurnCounters(state, turn) {
    return resetWangDahaiTurnCounters(state, turn)
  },
  applyUnitPassiveEffects(state, turn): BattleTransitionResult {
    if (turn.unitId !== WANG_DAHAI_UNIT_ID) {
      return { ok: true, state, events: [] }
    }
    return applyWangDahaiTurnStartPassive(state)
  },
  applyAfterActionEffects(state, action) {
    return applyWangDahaiAfterActionEffects(state, action)
  },
  applyUnitTurnEndEffects(state, turn) {
    return applyWangDahaiTurnEndEffects(state, turn)
  },
}
