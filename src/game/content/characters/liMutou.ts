import type {
  ExtraDamageRequest,
  NormalAttackRequest,
  SkillEffectRequest,
} from '../../core/attacks'
import {
  completeBattleAction,
  startBattleAction,
} from '../../core/battleEngine'
import type { BattleEngineExtensions, BattleTransitionResult } from '../../core/battleEngine'
import type { BattleState, PersonalTurnState } from '../../core/contexts'
import {
  BattlePhase,
  Camp,
  DamageType,
  PersonalTurnPhase,
  Position,
  StackPolicy,
  StatusAcquisitionTiming,
  StatusCategory,
  UnitSystem,
} from '../../core/enums'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  ResourceTransactionId,
  SkillBranchId,
  SkillExecutionId,
  SkillId,
  SpecialCounterId,
  StatusBatchId,
  StatusId,
  UnitId,
} from '../../core/identifiers'
import { resolveResourcePaidSkillTransaction } from '../../core/resourceTransaction'
import {
  gainResource,
  ResourceType,
  setResource,
  spendResource,
} from '../../core/resources'
import {
  decreaseSpecialCounter,
  readSpecialCounter,
} from '../../core/specialCounters'
import { getStatusBatchesForOwner, removeBattleStatus } from '../../core/statusEngine'
import type { StatusBatch } from '../../core/statuses'
import {
  getEffectiveAttack,
  getEffectiveCriticalDamage,
  getEffectiveCriticalRate,
  getMomentumEffectLayers,
  isUnitAlive,
} from '../../core/unitQueries'
import type { MomentumReadRule, UnitState } from '../../core/units'
import { healUnit } from '../../core/vitality'

export const LI_MUTOU_UNIT_ID = 'character:li-mutou' as UnitId
export const LI_MUTOU_FIRST_SKILL_ID = 'skill:li-mutou:first' as SkillId
export const LI_MUTOU_SECOND_SKILL_ID = 'skill:li-mutou:second' as SkillId
export const LI_MUTOU_THIRD_SKILL_ID = 'skill:li-mutou:third' as SkillId
export const LI_MUTOU_BLADE_DOMAIN_COUNTER_ID =
  'counter:li-mutou:blade-domain' as SpecialCounterId
export const LI_MUTOU_SPRING_BRANCH_ID =
  'skill-branch:li-mutou:spring' as SkillBranchId
export const LI_MUTOU_AUTUMN_BRANCH_ID =
  'skill-branch:li-mutou:autumn' as SkillBranchId
export const LI_MUTOU_SPRING_STATUS_ID =
  'status:li-mutou:spring-blossom' as StatusId
export const LI_MUTOU_AUTUMN_STATUS_ID =
  'status:li-mutou:autumn-fruit' as StatusId

export const LI_MUTOU_MOMENTUM_READ_RULES: readonly MomentumReadRule[] = [
  {
    maximumActualMomentum: 8,
    attackLayersPerMomentum: 1,
    effectLayersPerMomentum: 3,
    pressureLayersPerMomentum: 3,
  },
  {
    maximumActualMomentum: 15,
    attackLayersPerMomentum: 2,
    effectLayersPerMomentum: 1,
    pressureLayersPerMomentum: 1,
  },
  {
    maximumActualMomentum: null,
    attackLayersPerMomentum: 1,
    effectLayersPerMomentum: 1,
    pressureLayersPerMomentum: 1,
  },
]

const MICRO_MOMENTUM_REDUCTION = 2

export interface LiMutouFirstSkillRequest {
  readonly branchId: SkillBranchId
  readonly targetUnitId: UnitId
  readonly actionId: ActionId
  readonly skillExecutionId: SkillExecutionId
  readonly attackId: AttackId
  readonly damageEventId: DamageEventId
  readonly resourceTransactionId: ResourceTransactionId
}

export interface LiMutouSecondSkillRequest {
  readonly actionId: ActionId
  readonly skillExecutionId: SkillExecutionId
  readonly resourceTransactionId: ResourceTransactionId
}

export interface LiMutouThirdSkillRequest {
  readonly targetUnitId: UnitId
  readonly actionId: ActionId
  readonly skillExecutionId: SkillExecutionId
  readonly attackId: AttackId
  readonly damageEventId: DamageEventId
  readonly resourceTransactionId: ResourceTransactionId
}

export interface LiMutouEffectSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly import('../../core/events').BattleEvent[]
}

export interface LiMutouEffectFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: string
}

export type LiMutouEffectResult = LiMutouEffectSuccess | LiMutouEffectFailure

function failure(state: BattleState, reason: string): LiMutouEffectFailure {
  return { ok: false, state, events: [], reason }
}

function findLiMutou(state: BattleState): UnitState | null {
  const unit = state.units.find((candidate) => candidate.id === LI_MUTOU_UNIT_ID)
  return unit !== undefined && isUnitAlive(unit) ? unit : null
}

function statusOrder(state: BattleState): number | null {
  const order = state.statusAcquisitionOrders.reduce(
    (maximum, value) => Math.max(maximum, value),
    -1,
  ) + 1
  return Number.isSafeInteger(order) ? order : null
}

function createStatus(
  state: BattleState,
  statusId: StatusId,
  skillExecutionId: SkillExecutionId,
): StatusBatch | null {
  const acquisitionOrder = statusOrder(state)
  if (acquisitionOrder === null) return null
  return {
    batchId: `${skillExecutionId}:${statusId}` as StatusBatchId,
    statusId,
    ownerUnitId: LI_MUTOU_UNIT_ID,
    sourceUnitId: LI_MUTOU_UNIT_ID,
    stacks: 1,
    effect: { calculation: 'total', value: 0 },
    remainingOwnerTurns: null,
    acquiredAt: StatusAcquisitionTiming.Action,
    acquisitionGroupId: String(skillExecutionId),
    acquisitionOrder,
    skipNextTurnEndDecrement: false,
    stackPolicy: StackPolicy.Independent,
    category: StatusCategory.Buff,
    canBeCleansed: false,
    canBeDispelled: false,
  }
}

function earliestStatus(
  state: BattleState,
  statusId: StatusId,
): StatusBatch | null {
  return getStatusBatchesForOwner(
    state.statusBatches,
    LI_MUTOU_UNIT_ID,
    statusId,
  ).reduce<StatusBatch | null>((earliest, batch) => (
    earliest === null || batch.acquisitionOrder < earliest.acquisitionOrder
      ? batch
      : earliest
  ), null)
}

function createAttack(
  unit: UnitState,
  request: LiMutouFirstSkillRequest,
  multiplier: number,
  second: boolean,
): NormalAttackRequest {
  const damageEventId = second
    ? `${request.damageEventId}:second` as DamageEventId
    : request.damageEventId
  return {
    attackId: second
      ? `${request.attackId}:second` as AttackId
      : request.attackId,
    damageType: DamageType.Normal,
    effectiveAttack: getEffectiveAttack(unit),
    multiplier,
    fixedDamage: 0,
    criticalRate: getEffectiveCriticalRate(unit),
    criticalDamage: getEffectiveCriticalDamage(unit),
    normalDamageIncrease: unit.normalDamageIncrease,
    targets: [{
      targetId: request.targetUnitId,
      damageEventId,
      extraDamage: createBladeDomainExtraDamage(unit, damageEventId, true),
    }],
  }
}

function hasLiMutouBladeDomain(unit: UnitState): boolean {
  return readSpecialCounter(unit, LI_MUTOU_BLADE_DOMAIN_COUNTER_ID) > 0
}

function createBladeDomainExtraDamage(
  unit: UnitState,
  damageEventId: DamageEventId,
  consumesEnergy: boolean,
): ExtraDamageRequest | undefined {
  if (!hasLiMutouBladeDomain(unit)) return undefined
  return {
    damageEventId: `${damageEventId}:blade-domain` as DamageEventId,
    value: getMomentumEffectLayers(unit),
    ...(consumesEnergy
      ? {
          resourceCostAfterDamage: {
            unitId: LI_MUTOU_UNIT_ID,
            resourceType: ResourceType.Energy,
            amount: 1,
            reason: 'liMutouBladeDomain',
            sourceId: String(LI_MUTOU_BLADE_DOMAIN_COUNTER_ID),
          },
        }
      : {}),
  }
}

function createThirdSkillAttack(
  unit: UnitState,
  request: LiMutouThirdSkillRequest,
  index: number,
): NormalAttackRequest {
  const suffix = index === 0 ? '' : `:${index + 1}`
  const attackId = `${request.attackId}${suffix}` as AttackId
  const damageEventId = `${request.damageEventId}${suffix}` as DamageEventId
  return {
    attackId,
    damageType: DamageType.Normal,
    effectiveAttack: getEffectiveAttack(unit),
    multiplier: 0.5,
    fixedDamage: 0,
    criticalRate: getEffectiveCriticalRate(unit),
    criticalDamage: getEffectiveCriticalDamage(unit),
    normalDamageIncrease: unit.normalDamageIncrease,
    targets: [{
      targetId: request.targetUnitId,
      damageEventId,
      extraDamage: index < 6
        ? createBladeDomainExtraDamage(unit, damageEventId, false)
        : undefined,
    }],
  }
}

function contextIds(turn: PersonalTurnState) {
  return {
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    skillExecutionId: null,
  }
}

function healthLostSinceLastLiMutouTurnEnd(state: BattleState): number | null {
  let lastTurnEnd = -1
  for (const [index, event] of state.events.entries()) {
    if (event.type === 'TURN_ENDED' && event.unitId === LI_MUTOU_UNIT_ID) {
      lastTurnEnd = index
    }
  }
  if (lastTurnEnd < 0) return null
  return state.events.slice(lastTurnEnd + 1).reduce((total, event) => (
    event.type === 'HEALTH_LOST' && event.targetId === LI_MUTOU_UNIT_ID
      ? total + event.amount
      : total
  ), 0)
}

export function createLiMutou(): UnitState {
  return {
    id: LI_MUTOU_UNIT_ID,
    name: '李木头',
    camp: Camp.Player,
    system: UnitSystem.Momentum,
    isBoss: false,
    position: Position.Back1,
    deploymentOrder: 2,
    currentHealth: 150,
    maximumHealth: 150,
    hasInfiniteHealth: false,
    baseAttackAtBattleEntry: 20,
    temporaryAttributeModifiers: [],
    speed: 95,
    shield: 0,
    criticalRate: 0,
    criticalDamage: 0.5,
    normalDamageIncrease: 0,
    normalDamageReductionSources: [],
    extraDamageIncrease: 0,
    extraDamageReduction: 0,
    energy: 0,
    momentum: 0,
    momentumReadRules: LI_MUTOU_MOMENTUM_READ_RULES,
    intent: 0,
    magic: 0,
    momentumPressure: 0,
    specialCounters: [],
    resourceReductionProtections: [],
    alive: true,
  }
}

export function applyLiMutouMicroMomentum(
  state: BattleState,
  turn: PersonalTurnState,
): LiMutouEffectResult {
  if (turn.unitId !== LI_MUTOU_UNIT_ID) return { ok: true, state, events: [] }
  const unit = findLiMutou(state)
  if (unit === null) return failure(state, 'LI_MUTOU_NOT_FOUND')
  const amount = Math.min(unit.momentum, MICRO_MOMENTUM_REDUCTION)
  if (amount === 0) return { ok: true, state, events: [] }
  const reduced = spendResource(state, {
    unitId: unit.id,
    resourceType: ResourceType.Momentum,
    amount,
    reason: 'liMutouMicroMomentum',
    sourceId: String(LI_MUTOU_UNIT_ID),
    sourceUnitId: LI_MUTOU_UNIT_ID,
    effectId: 'liMutouMicroMomentum',
    actionId: null,
    ...contextIds(turn),
    resourceTransactionId: null,
  })
  return reduced.ok ? reduced : failure(state, reduced.reason)
}

export function applyLiMutouSpringBlossom(
  state: BattleState,
  turn: PersonalTurnState,
): LiMutouEffectResult {
  if (turn.unitId !== LI_MUTOU_UNIT_ID) return { ok: true, state, events: [] }
  if (findLiMutou(state) === null) return failure(state, 'LI_MUTOU_NOT_FOUND')
  if (earliestStatus(state, LI_MUTOU_SPRING_STATUS_ID) === null) {
    return { ok: true, state, events: [] }
  }
  const lostHealth = healthLostSinceLastLiMutouTurnEnd(state)
  if (lostHealth === null) return { ok: true, state, events: [] }
  let currentState = state
  const events: import('../../core/events').BattleEvent[] = []
  if (lostHealth > 0) {
    const healed = healUnit(currentState, {
      unitId: LI_MUTOU_UNIT_ID,
      amount: lostHealth * 0.5,
      reason: 'liMutouSpringBlossom',
      sourceUnitId: LI_MUTOU_UNIT_ID,
      effectId: String(LI_MUTOU_SPRING_STATUS_ID),
      actionId: null,
      ...contextIds(turn),
    })
    if (!healed.ok) return failure(state, healed.reason)
    currentState = healed.state
    events.push(...healed.events)
  }
  const removed = removeBattleStatus(currentState, {
    ownerUnitId: LI_MUTOU_UNIT_ID,
    mode: 'remove',
    category: StatusCategory.Buff,
    statusId: LI_MUTOU_SPRING_STATUS_ID,
    origin: {
      sourceUnitId: LI_MUTOU_UNIT_ID,
      skillExecutionId: null,
      effectId: String(LI_MUTOU_SPRING_STATUS_ID),
    },
  })
  if (!removed.ok) return failure(state, removed.reason)
  return {
    ok: true,
    state: removed.state,
    events: [...events, ...removed.events],
  }
}

export function applyLiMutouAutumnFruit(
  state: BattleState,
): LiMutouEffectResult {
  const unit = findLiMutou(state)
  if (unit === null || earliestStatus(state, LI_MUTOU_AUTUMN_STATUS_ID) === null) {
    return { ok: true, state, events: [] }
  }
  const gained = gainResource(state, {
    unitId: unit.id,
    resourceType: ResourceType.Energy,
    amount: 3,
    reason: 'liMutouAutumnFruit',
    sourceId: String(LI_MUTOU_AUTUMN_STATUS_ID),
    sourceUnitId: LI_MUTOU_UNIT_ID,
    effectId: 'liMutouAutumnFruit',
    actionId: null,
    personalTurnId: null,
    sequenceId: null,
    skillExecutionId: null,
    resourceTransactionId: null,
  })
  if (!gained.ok) return failure(state, gained.reason)
  const removed = removeBattleStatus(gained.state, {
    ownerUnitId: LI_MUTOU_UNIT_ID,
    mode: 'remove',
    category: StatusCategory.Buff,
    statusId: LI_MUTOU_AUTUMN_STATUS_ID,
    origin: {
      sourceUnitId: LI_MUTOU_UNIT_ID,
      skillExecutionId: null,
      effectId: String(LI_MUTOU_AUTUMN_STATUS_ID),
    },
  })
  if (!removed.ok) return failure(state, removed.reason)
  return {
    ok: true,
    state: removed.state,
    events: [...gained.events, ...removed.events],
  }
}

export function useLiMutouFirstSkill(
  state: BattleState,
  request: LiMutouFirstSkillRequest,
  extensions: BattleEngineExtensions = LI_MUTOU_BATTLE_EXTENSIONS,
): LiMutouEffectResult {
  const turn = state.personalTurn
  const unit = findLiMutou(state)
  if (
    state.phase !== BattlePhase.AwaitingAction
    || turn === null
    || turn.phase !== PersonalTurnPhase.AwaitingAction
    || turn.unitId !== LI_MUTOU_UNIT_ID
    || unit === null
  ) return failure(state, 'LI_MUTOU_NOT_READY_FOR_FIRST_SKILL')
  if (
    request.branchId !== LI_MUTOU_SPRING_BRANCH_ID
    && request.branchId !== LI_MUTOU_AUTUMN_BRANCH_ID
  ) return failure(state, 'LI_MUTOU_FIRST_SKILL_BRANCH_NOT_SUPPORTED')
  const target = state.units.find((candidate) => candidate.id === request.targetUnitId)
  if (target === undefined || target.camp === unit.camp || !isUnitAlive(target)) {
    return failure(state, 'LI_MUTOU_FIRST_SKILL_INVALID_TARGET')
  }
  const spring = request.branchId === LI_MUTOU_SPRING_BRANCH_ID
  const energyGain = spring ? 2 : 1
  const momentumGain = spring ? 3 : 4
  const started = startBattleAction(state, {
    actionId: request.actionId,
    actorId: unit.id,
    skillExecutionId: request.skillExecutionId,
    countsAsAction: true,
    endsTurn: true,
  })
  if (!started.ok) return failure(state, started.reason)
  const action = started.state.activeAction
  const activeTurn = started.state.personalTurn
  if (action === null || activeTurn === null) {
    return failure(state, 'LI_MUTOU_FIRST_SKILL_CONTEXT_MISSING')
  }
  const attackingUnit = { ...unit, momentum: unit.momentum + momentumGain }
  const firstAttack = createAttack(
    attackingUnit,
    request,
    spring ? 0.8 : 0.5,
    false,
  )
  const attacks = spring
    ? [firstAttack]
    : [firstAttack, createAttack(attackingUnit, request, 0.5, true)]
  const status = createStatus(
    started.state,
    spring ? LI_MUTOU_SPRING_STATUS_ID : LI_MUTOU_AUTUMN_STATUS_ID,
    request.skillExecutionId,
  )
  if (status === null) return failure(state, 'LI_MUTOU_STATUS_ORDER_OVERFLOW')
  const effects: readonly SkillEffectRequest[] = [
    {
      kind: 'resource', operation: 'gain', unitId: unit.id,
      resourceType: ResourceType.Energy, amount: energyGain, reason: 'liMutouFirstSkill',
    },
    {
      kind: 'resource', operation: 'gain', unitId: unit.id,
      resourceType: ResourceType.Momentum, amount: momentumGain, reason: 'liMutouFirstSkill',
    },
    ...attacks.map((attack) => ({ kind: 'attack' as const, attack })),
    { kind: 'status', operation: 'add', status },
  ]
  const resolved = resolveResourcePaidSkillTransaction(started.state, {
    resourceTransactionId: request.resourceTransactionId,
    actionId: request.actionId,
    personalTurnId: activeTurn.personalTurnId,
    sequenceId: action.sequenceId,
    skillExecutionId: request.skillExecutionId,
    payerUnitId: unit.id,
    costs: [],
  }, {
    skillExecutionId: request.skillExecutionId,
    skillId: LI_MUTOU_FIRST_SKILL_ID,
    branchId: request.branchId,
    actionId: request.actionId,
    personalTurnId: activeTurn.personalTurnId,
    sequenceId: action.sequenceId,
    casterId: unit.id,
    attacks,
    effects,
  })
  if (!resolved.ok) return failure(state, resolved.reason)
  const completed = completeBattleAction(resolved.state, request.actionId, extensions)
  if (!completed.ok) return failure(completed.state, completed.reason)
  return {
    ok: true,
    state: completed.state,
    events: completed.state.events.slice(state.events.length),
  }
}

export function useLiMutouSecondSkill(
  state: BattleState,
  request: LiMutouSecondSkillRequest,
  extensions: BattleEngineExtensions = LI_MUTOU_BATTLE_EXTENSIONS,
): LiMutouEffectResult {
  const turn = state.personalTurn
  const unit = findLiMutou(state)
  if (
    state.phase !== BattlePhase.AwaitingAction
    || turn === null
    || turn.phase !== PersonalTurnPhase.AwaitingAction
    || turn.unitId !== LI_MUTOU_UNIT_ID
    || unit === null
  ) return failure(state, 'LI_MUTOU_NOT_READY_FOR_SECOND_SKILL')
  if (hasLiMutouBladeDomain(unit)) {
    return failure(state, 'LI_MUTOU_BLADE_DOMAIN_ALREADY_ACTIVE')
  }
  if (unit.energy < 2) return failure(state, 'LI_MUTOU_SECOND_SKILL_INSUFFICIENT_ENERGY')
  const started = startBattleAction(state, {
    actionId: request.actionId,
    actorId: unit.id,
    skillExecutionId: request.skillExecutionId,
    countsAsAction: true,
    endsTurn: false,
  })
  if (!started.ok) return failure(state, started.reason)
  const action = started.state.activeAction
  const activeTurn = started.state.personalTurn
  if (action === null || activeTurn === null) {
    return failure(state, 'LI_MUTOU_SECOND_SKILL_CONTEXT_MISSING')
  }
  const effects: readonly SkillEffectRequest[] = [{
    kind: 'specialCounter',
    operation: 'increase',
    unitId: unit.id,
    counterId: LI_MUTOU_BLADE_DOMAIN_COUNTER_ID,
    amount: 1,
  }]
  const resolved = resolveResourcePaidSkillTransaction(started.state, {
    resourceTransactionId: request.resourceTransactionId,
    actionId: request.actionId,
    personalTurnId: activeTurn.personalTurnId,
    sequenceId: action.sequenceId,
    skillExecutionId: request.skillExecutionId,
    payerUnitId: unit.id,
    costs: [{ resourceType: ResourceType.Energy, amount: 2 }],
  }, {
    skillExecutionId: request.skillExecutionId,
    skillId: LI_MUTOU_SECOND_SKILL_ID,
    actionId: request.actionId,
    personalTurnId: activeTurn.personalTurnId,
    sequenceId: action.sequenceId,
    casterId: unit.id,
    attacks: [],
    effects,
  })
  if (!resolved.ok) return failure(state, resolved.reason)
  const completed = completeBattleAction(resolved.state, request.actionId, extensions)
  if (!completed.ok) return failure(completed.state, completed.reason)
  return {
    ok: true,
    state: completed.state,
    events: completed.state.events.slice(state.events.length),
  }
}

export function useLiMutouThirdSkill(
  state: BattleState,
  request: LiMutouThirdSkillRequest,
  extensions: BattleEngineExtensions = LI_MUTOU_BATTLE_EXTENSIONS,
): LiMutouEffectResult {
  const turn = state.personalTurn
  const unit = findLiMutou(state)
  if (
    state.phase !== BattlePhase.AwaitingAction
    || turn === null
    || turn.phase !== PersonalTurnPhase.AwaitingAction
    || turn.unitId !== LI_MUTOU_UNIT_ID
    || unit === null
  ) return failure(state, 'LI_MUTOU_NOT_READY_FOR_THIRD_SKILL')
  if (!hasLiMutouBladeDomain(unit)) {
    return failure(state, 'LI_MUTOU_THIRD_SKILL_REQUIRES_BLADE_DOMAIN')
  }
  if (unit.energy < 1) return failure(state, 'LI_MUTOU_THIRD_SKILL_INSUFFICIENT_ENERGY')
  const target = state.units.find((candidate) => candidate.id === request.targetUnitId)
  if (target === undefined || target.camp === unit.camp || !isUnitAlive(target)) {
    return failure(state, 'LI_MUTOU_THIRD_SKILL_INVALID_TARGET')
  }
  const attacks = Array.from({ length: unit.energy }, (_, index) => (
    createThirdSkillAttack(unit, request, index)
  ))
  const started = startBattleAction(state, {
    actionId: request.actionId,
    actorId: unit.id,
    skillExecutionId: request.skillExecutionId,
    countsAsAction: true,
    endsTurn: true,
  })
  if (!started.ok) return failure(state, started.reason)
  const action = started.state.activeAction
  const activeTurn = started.state.personalTurn
  if (action === null || activeTurn === null) {
    return failure(state, 'LI_MUTOU_THIRD_SKILL_CONTEXT_MISSING')
  }
  const resolved = resolveResourcePaidSkillTransaction(started.state, {
    resourceTransactionId: request.resourceTransactionId,
    actionId: request.actionId,
    personalTurnId: activeTurn.personalTurnId,
    sequenceId: action.sequenceId,
    skillExecutionId: request.skillExecutionId,
    payerUnitId: unit.id,
    costs: [],
  }, {
    skillExecutionId: request.skillExecutionId,
    skillId: LI_MUTOU_THIRD_SKILL_ID,
    actionId: request.actionId,
    personalTurnId: activeTurn.personalTurnId,
    sequenceId: action.sequenceId,
    casterId: unit.id,
    attacks,
  })
  if (!resolved.ok) return failure(state, resolved.reason)
  const momentumSet = setResource(resolved.state, {
    unitId: unit.id,
    resourceType: ResourceType.Momentum,
    value: 6,
    reason: 'liMutouThirdSkill',
    sourceId: String(LI_MUTOU_THIRD_SKILL_ID),
    actionId: request.actionId,
    personalTurnId: activeTurn.personalTurnId,
    sequenceId: action.sequenceId,
    skillExecutionId: request.skillExecutionId,
    resourceTransactionId: request.resourceTransactionId,
  })
  if (!momentumSet.ok) return failure(state, momentumSet.reason)
  const energySet = setResource(momentumSet.state, {
    unitId: unit.id,
    resourceType: ResourceType.Energy,
    value: 2,
    reason: 'liMutouThirdSkill',
    sourceId: String(LI_MUTOU_THIRD_SKILL_ID),
    actionId: request.actionId,
    personalTurnId: activeTurn.personalTurnId,
    sequenceId: action.sequenceId,
    skillExecutionId: request.skillExecutionId,
    resourceTransactionId: request.resourceTransactionId,
  })
  if (!energySet.ok) return failure(state, energySet.reason)
  const completed = completeBattleAction(energySet.state, request.actionId, extensions)
  if (!completed.ok) return failure(completed.state, completed.reason)
  return {
    ok: true,
    state: completed.state,
    events: completed.state.events.slice(state.events.length),
  }
}

export function applyLiMutouTurnEndEffects(
  state: BattleState,
  turn: PersonalTurnState,
): LiMutouEffectResult {
  if (
    turn.unitId !== LI_MUTOU_UNIT_ID
    || turn.phase !== PersonalTurnPhase.EndingUnitSpecificEffects
  ) return { ok: true, state, events: [] }
  const unit = findLiMutou(state)
  if (unit === null || unit.energy > 0 || !hasLiMutouBladeDomain(unit)) {
    return { ok: true, state, events: [] }
  }
  const closed = decreaseSpecialCounter(state, {
    unitId: unit.id,
    counterId: LI_MUTOU_BLADE_DOMAIN_COUNTER_ID,
    amount: readSpecialCounter(unit, LI_MUTOU_BLADE_DOMAIN_COUNTER_ID),
    sourceUnitId: unit.id,
    effectId: LI_MUTOU_SECOND_SKILL_ID,
    actionId: null,
    ...contextIds(turn),
  })
  return closed.ok ? closed : failure(state, closed.reason)
}

export const LI_MUTOU_BATTLE_EXTENSIONS: BattleEngineExtensions = {
  applySequenceStartEffects(state): BattleTransitionResult {
    return applyLiMutouAutumnFruit(state)
  },
  applyTurnStartPreSystemEffects(state, turn) {
    return applyLiMutouMicroMomentum(state, turn)
  },
  applyTurnStartPostSystemEffects(state, turn) {
    return applyLiMutouSpringBlossom(state, turn)
  },
  applyUnitTurnEndEffects(state, turn) {
    return applyLiMutouTurnEndEffects(state, turn)
  },
}
