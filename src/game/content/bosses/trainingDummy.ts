import type { NormalAttackRequest, SkillResolutionRequest } from '../../core/attacks'
import {
  completeCurrentBattleAction,
  startBattleAction,
} from '../../core/battleEngine'
import type { BattleEngineExtensions } from '../../core/battleEngine'
import type { BattleState } from '../../core/contexts'
import {
  BattlePhase,
  Camp,
  DamageType,
  PersonalTurnPhase,
  UnitSystem,
} from '../../core/enums'
import type { BattleEvent } from '../../core/events'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  ResourceTransactionId,
  SkillExecutionId,
  SkillId,
  UnitId,
} from '../../core/identifiers'
import {
  readRandomValue,
  validateRandomState,
} from '../../core/rng'
import { resolveResourcePaidSkillTransaction } from '../../core/resourceTransaction'
import { gainResource, ResourceType } from '../../core/resources'
import { gainShield } from '../../core/shields'
import { getEffectiveAttack, isUnitAlive } from '../../core/unitQueries'
import type { UnitState } from '../../core/units'

export const TRAINING_DUMMY_UNIT_ID = 'boss:training-dummy' as UnitId
export const TRAINING_DUMMY_REVENGE_SKILL_ID =
  'skill:training-dummy:revenge' as SkillId

const TRAINING_DUMMY_SHIELD_GAIN = 20
const TRAINING_DUMMY_MOMENTUM_GAIN = 5

export interface TrainingDummyTurnSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
  readonly targetUnitId: UnitId | null
}

export interface TrainingDummyTurnFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: string
}

export type TrainingDummyTurnResult =
  | TrainingDummyTurnSuccess
  | TrainingDummyTurnFailure

interface TrainingDummyActionIds {
  readonly actionId: ActionId
  readonly skillExecutionId: SkillExecutionId
  readonly attackId: AttackId
  readonly damageEventId: DamageEventId
  readonly resourceTransactionId: ResourceTransactionId
}

interface TargetSelectionSuccess {
  readonly ok: true
  readonly targetUnitId: UnitId
  readonly rngState: BattleState['rngState']
}

interface TargetSelectionFailure {
  readonly ok: false
  readonly reason: string
}

type TargetSelectionResult = TargetSelectionSuccess | TargetSelectionFailure

function failure(
  state: BattleState,
  reason: string,
): TrainingDummyTurnFailure {
  return { ok: false, state, events: [], reason }
}

function getActiveTrainingDummy(state: BattleState): UnitState | null {
  const turn = state.personalTurn
  if (
    state.phase !== BattlePhase.AwaitingAction
    || turn === null
    || turn.phase !== PersonalTurnPhase.AwaitingAction
    || turn.unitId !== TRAINING_DUMMY_UNIT_ID
    || state.activeAction !== null
  ) return null

  const unit = state.units.find((candidate) => (
    candidate.id === TRAINING_DUMMY_UNIT_ID
  ))
  return unit !== undefined && isUnitAlive(unit) ? unit : null
}

function getTrainingDummyTurnUnit(state: BattleState): UnitState | null {
  const turn = state.personalTurn
  if (turn === null || turn.unitId !== TRAINING_DUMMY_UNIT_ID) return null
  const unit = state.units.find((candidate) => (
    candidate.id === TRAINING_DUMMY_UNIT_ID
  ))
  return unit !== undefined && isUnitAlive(unit) ? unit : null
}

function createActionIds(state: BattleState): TrainingDummyActionIds | null {
  const turn = state.personalTurn
  if (turn === null) return null
  const prefix = `${turn.personalTurnId}:training-dummy-revenge`
  return {
    actionId: `${prefix}:action` as ActionId,
    skillExecutionId: `${prefix}:skill-execution` as SkillExecutionId,
    attackId: `${prefix}:attack` as AttackId,
    damageEventId: `${prefix}:damage` as DamageEventId,
    resourceTransactionId: `${prefix}:resource` as ResourceTransactionId,
  }
}

function selectLivingPlayerTarget(state: BattleState): TargetSelectionResult {
  const candidates = state.units.filter((unit) => (
    unit.camp === Camp.Player && isUnitAlive(unit)
  ))
  if (candidates.length === 0) {
    return { ok: false, reason: 'TRAINING_DUMMY_NO_LIVING_PLAYER_TARGET' }
  }
  if (validateRandomState(state.rngState) !== null) {
    return { ok: false, reason: 'INVALID_RANDOM_STATE' }
  }
  if (candidates.length === 1) {
    return {
      ok: true,
      targetUnitId: candidates[0].id,
      rngState: state.rngState,
    }
  }

  try {
    const random = readRandomValue(state.rngState)
    const targetIndex = Math.floor(random.value * candidates.length)
    return {
      ok: true,
      targetUnitId: candidates[targetIndex].id,
      rngState: random.state,
    }
  } catch (error) {
    if (error instanceof RangeError) {
      return { ok: false, reason: 'RANDOM_SOURCE_EXHAUSTED' }
    }
    throw error
  }
}

function createRevengeAttack(
  dummy: UnitState,
  targetUnitId: UnitId,
  ids: TrainingDummyActionIds,
): NormalAttackRequest {
  return {
    attackId: ids.attackId,
    damageType: DamageType.Normal,
    effectiveAttack: getEffectiveAttack(dummy),
    multiplier: 1,
    fixedDamage: 0,
    criticalRate: dummy.criticalRate,
    criticalDamage: dummy.criticalDamage,
    normalDamageIncrease: dummy.normalDamageIncrease,
    targets: [{
      targetId: targetUnitId,
      damageEventId: ids.damageEventId,
    }],
  }
}

export function createTrainingDummy(): UnitState {
  return {
    id: TRAINING_DUMMY_UNIT_ID,
    name: '训练假人',
    camp: Camp.Enemy,
    system: UnitSystem.Momentum,
    isBoss: true,
    position: null,
    deploymentOrder: 0,
    currentHealth: 1,
    maximumHealth: 1,
    hasInfiniteHealth: true,
    baseAttackAtBattleEntry: 5,
    attackModifiers: [],
    speed: 1,
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

export function applyTrainingDummyTurnStartPassives(
  state: BattleState,
): TrainingDummyTurnResult {
  const turn = state.personalTurn
  const dummy = getTrainingDummyTurnUnit(state)
  if (dummy === null || turn === null) {
    return failure(state, 'TRAINING_DUMMY_NOT_READY_FOR_TURN_PASSIVES')
  }
  if (
    turn.unitPassiveEffectsApplied
  ) {
    return {
      ok: true,
      state,
      events: [],
      targetUnitId: null,
    }
  }
  if (
    state.phase !== BattlePhase.TurnStart
    || turn.phase !== PersonalTurnPhase.StartingUnitPassives
  ) return failure(state, 'TRAINING_DUMMY_NOT_AT_UNIT_PASSIVE_STAGE')

  const shield = gainShield(state, {
    unitId: dummy.id,
    amount: TRAINING_DUMMY_SHIELD_GAIN,
    reason: 'trainingDummySteadfast',
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    skillExecutionId: null,
  })
  if (!shield.ok) return failure(state, shield.reason)
  const momentum = gainResource(shield.state, {
    unitId: dummy.id,
    resourceType: ResourceType.Momentum,
    amount: TRAINING_DUMMY_MOMENTUM_GAIN,
    reason: 'trainingDummyMomentum',
    sourceId: String(dummy.id),
    actionId: null,
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    skillExecutionId: null,
    resourceTransactionId: null,
  })
  if (!momentum.ok) return failure(state, momentum.reason)

  return {
    ok: true,
    state: {
      ...momentum.state,
      personalTurn: {
        ...turn,
        unitPassiveEffectsApplied: true,
      },
    },
    events: [...shield.events, ...momentum.events],
    targetUnitId: null,
  }
}

export function runTrainingDummyAutomaticTurn(
  state: BattleState,
): TrainingDummyTurnResult {
  const dummy = getActiveTrainingDummy(state)
  const turn = state.personalTurn
  const ids = createActionIds(state)
  if (dummy === null || turn === null || ids === null) {
    return failure(state, 'TRAINING_DUMMY_NOT_READY_FOR_ACTION')
  }

  const started = startBattleAction(state, {
    actionId: ids.actionId,
    actorId: dummy.id,
    skillExecutionId: ids.skillExecutionId,
    countsAsAction: true,
    endsTurn: true,
  })
  if (!started.ok) return failure(state, started.reason)

  const selected = selectLivingPlayerTarget(started.state)
  if (!selected.ok) return failure(state, selected.reason)
  const selectedState: BattleState = selected.rngState === started.state.rngState
    ? started.state
    : { ...started.state, rngState: selected.rngState }
  const activeAction = selectedState.activeAction
  const personalTurn = selectedState.personalTurn
  const currentDummy = selectedState.units.find((unit) => unit.id === dummy.id)
  if (activeAction === null || personalTurn === null || currentDummy === undefined) {
    return failure(state, 'TRAINING_DUMMY_ACTION_CONTEXT_MISSING')
  }

  const skill: SkillResolutionRequest = {
    skillExecutionId: ids.skillExecutionId,
    skillId: TRAINING_DUMMY_REVENGE_SKILL_ID,
    actionId: ids.actionId,
    personalTurnId: personalTurn.personalTurnId,
    sequenceId: activeAction.sequenceId,
    casterId: currentDummy.id,
    attacks: [createRevengeAttack(
      currentDummy,
      selected.targetUnitId,
      ids,
    )],
  }
  const resolved = resolveResourcePaidSkillTransaction(
    selectedState,
    {
      resourceTransactionId: ids.resourceTransactionId,
      actionId: ids.actionId,
      personalTurnId: personalTurn.personalTurnId,
      sequenceId: activeAction.sequenceId,
      skillExecutionId: ids.skillExecutionId,
      payerUnitId: currentDummy.id,
      costs: [],
    },
    skill,
  )
  if (!resolved.ok) return failure(state, resolved.reason)

  const completed = completeCurrentBattleAction(
    resolved.state,
    ids.actionId,
  )
  if (!completed.ok) return failure(state, completed.reason)
  return {
    ok: true,
    state: completed.state,
    events: completed.state.events.slice(state.events.length),
    targetUnitId: selected.targetUnitId,
  }
}

export const TRAINING_DUMMY_BATTLE_EXTENSIONS: BattleEngineExtensions = {
  applyUnitPassiveEffects(state, turn) {
    if (turn.unitId !== TRAINING_DUMMY_UNIT_ID) {
      return { ok: true, state, events: [] }
    }
    return applyTrainingDummyTurnStartPassives(state)
  },
  runAutomaticAction(state) {
    if (state.personalTurn?.unitId !== TRAINING_DUMMY_UNIT_ID) return null
    return runTrainingDummyAutomaticTurn(state)
  },
}
