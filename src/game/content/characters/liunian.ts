import type {
  NormalAttackRequest,
  SkillEffectRequest,
} from '../../core/attacks'
import {
  completeBattleAction,
  endCurrentPersonalTurn,
  startBattleAction,
  type BattleEngineExtensions,
  type BattleTransitionResult,
} from '../../core/battleEngine'
import type {
  BattleState,
  PersonalTurnState,
} from '../../core/contexts'
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
import type { BattleEvent, ResourceChangedEvent } from '../../core/events'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  ResourceTransactionId,
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
  loseResource,
  readUnitResource,
  ResourceType,
} from '../../core/resources'
import { rollProbabilityFromState } from '../../core/rng'
import {
  decreaseSpecialCounter,
  increaseSpecialCounter,
  readSpecialCounter,
} from '../../core/specialCounters'
import type { StatusBatch } from '../../core/statuses'
import { getLivingLegalTargetPool } from '../../core/targeting'
import {
  getEffectiveAttack,
  getEffectiveCriticalDamage,
  getEffectiveCriticalRate,
  isUnitAlive,
} from '../../core/unitQueries'
import type { MomentumReadRule, UnitState } from '../../core/units'
import { healUnit } from '../../core/vitality'

export const LIUNIAN_UNIT_ID = 'character:liunian' as UnitId
export const LIUNIAN_FIRST_SKILL_ID = 'skill:liunian:first' as SkillId
export const LIUNIAN_DOMAIN_SKILL_ID = 'skill:liunian:three-lives' as SkillId
export const LIUNIAN_FLOW_CHANGE_SKILL_ID = 'skill:liunian:flow-change' as SkillId
export const LIUNIAN_NORTH_WIND_SKILL_ID = 'skill:liunian:north-wind' as SkillId
export const LIUNIAN_SOUTH_WATER_SKILL_ID = 'skill:liunian:south-water' as SkillId
export const LIUNIAN_BORROWED_MOMENTUM_COUNTER_ID =
  'counter:liunian:borrowed-momentum' as SpecialCounterId
export const LIUNIAN_DOMAIN_COUNTER_ID =
  'counter:liunian:three-lives-domain' as SpecialCounterId
export const LIUNIAN_PROCESSED_MOMENTUM_EVENTS_COUNTER_ID =
  'counter:liunian:processed-momentum-events' as SpecialCounterId
export const LIUNIAN_FLOW_TRANSFER_STATUS_ID =
  'status:liunian:flow-transfer' as StatusId
export const LIUNIAN_HALVED_MOMENTUM_STATUS_ID =
  'status:liunian:halved-momentum' as StatusId

export const LIUNIAN_MOMENTUM_READ_RULES: readonly MomentumReadRule[] = [{
  maximumActualMomentum: null,
  attackLayersPerMomentum: 0.5,
  effectLayersPerMomentum: 1,
  pressureLayersPerMomentum: 1,
}]

interface LiunianActionIds {
  readonly actionId: ActionId
  readonly skillExecutionId: SkillExecutionId
  readonly resourceTransactionId: ResourceTransactionId
}

export interface LiunianTargetSkillRequest extends LiunianActionIds {
  readonly targetUnitId: UnitId
  readonly attackId: AttackId
  readonly damageEventId: DamageEventId
}

export interface LiunianEffectSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

export interface LiunianEffectFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: string
}

export type LiunianEffectResult = LiunianEffectSuccess | LiunianEffectFailure
export type LiunianExchangeChoice = 'otherLoses' | 'holderLoses'

function failure(state: BattleState, reason: string): LiunianEffectFailure {
  return { ok: false, state, events: [], reason }
}

function findLiunian(state: BattleState): UnitState | null {
  const unit = state.units.find((candidate) => candidate.id === LIUNIAN_UNIT_ID)
  return unit !== undefined && isUnitAlive(unit) ? unit : null
}

function context(turn: PersonalTurnState) {
  return {
    actionId: null,
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    skillExecutionId: null,
    resourceTransactionId: null,
  }
}

function nextStatusOrder(state: BattleState): number | null {
  const order = state.statusAcquisitionOrders.reduce(
    (maximum, value) => Math.max(maximum, value),
    -1,
  ) + 1
  return Number.isSafeInteger(order) ? order : null
}

function createStatus(
  state: BattleState,
  statusId: StatusId,
  ownerUnitId: UnitId,
  skillExecutionId: SkillExecutionId,
): StatusBatch | null {
  const order = nextStatusOrder(state)
  if (order === null) return null
  const flowTransfer = statusId === LIUNIAN_FLOW_TRANSFER_STATUS_ID
  return {
    batchId: `${statusId}:${skillExecutionId}:${ownerUnitId}:${order}` as StatusBatchId,
    statusId,
    ownerUnitId,
    sourceUnitId: LIUNIAN_UNIT_ID,
    stacks: 1,
    effect: { calculation: 'perStack', value: flowTransfer ? 1 : 0.5 },
    remainingOwnerTurns: flowTransfer ? null : 1,
    acquiredAt: StatusAcquisitionTiming.Action,
    acquisitionGroupId: `${statusId}:${ownerUnitId}`,
    acquisitionOrder: order,
    skipNextTurnEndDecrement: false,
    stackPolicy: flowTransfer
      ? StackPolicy.MergeEquivalent
      : StackPolicy.RefreshDuration,
    category: flowTransfer ? StatusCategory.Buff : StatusCategory.Debuff,
    canBeCleansed: !flowTransfer,
    canBeDispelled: false,
  }
}

export function createLiunian(): UnitState {
  return {
    id: LIUNIAN_UNIT_ID,
    name: '流年',
    camp: Camp.Player,
    system: UnitSystem.Momentum,
    isBoss: false,
    position: Position.Back2,
    deploymentOrder: 3,
    currentHealth: 120,
    maximumHealth: 120,
    hasInfiniteHealth: false,
    baseAttackAtBattleEntry: 10,
    temporaryAttributeModifiers: [],
    speed: 120,
    shield: 0,
    criticalRate: 0,
    criticalDamage: 0.5,
    normalDamageIncrease: 0,
    normalDamageReductionSources: [],
    extraDamageIncrease: 0,
    extraDamageReduction: 0,
    energy: 0,
    momentum: 0,
    flow: 0,
    momentumReadRules: LIUNIAN_MOMENTUM_READ_RULES,
    resourceCounterContributions: [{
      resourceType: ResourceType.Momentum,
      counterId: LIUNIAN_BORROWED_MOMENTUM_COUNTER_ID,
      reductionPriority: 0,
    }],
    intent: 0,
    magic: 0,
    momentumPressure: 0,
    specialCounters: [],
    resourceReductionProtections: [],
    alive: true,
  }
}

export function getLiunianBorrowedMomentum(unit: UnitState): number {
  return readSpecialCounter(unit, LIUNIAN_BORROWED_MOMENTUM_COUNTER_ID)
}

export function getLiunianTotalMomentum(unit: UnitState): number {
  return readUnitResource(unit, ResourceType.Momentum)
}

export function isLiunianDomainActive(unit: UnitState): boolean {
  return readSpecialCounter(unit, LIUNIAN_DOMAIN_COUNTER_ID) > 0
}

export function getFlowTransferStacks(state: BattleState, unitId: UnitId): number {
  return state.statusBatches.reduce((total, batch) => (
    batch.ownerUnitId === unitId
      && batch.statusId === LIUNIAN_FLOW_TRANSFER_STATUS_ID
      ? total + batch.stacks
      : total
  ), 0)
}

export function getLiunianActualMomentum(
  state: BattleState,
  unit: UnitState,
): number {
  const total = unit.id === LIUNIAN_UNIT_ID
    ? getLiunianTotalMomentum(unit)
    : unit.momentum
  const halved = state.statusBatches.some((batch) => (
    batch.ownerUnitId === unit.id
    && batch.statusId === LIUNIAN_HALVED_MOMENTUM_STATUS_ID
  ))
  return halved ? Math.floor(total / 2) : total
}

export function getLiunianKanyuTargets(state: BattleState): readonly UnitState[] {
  const liunian = findLiunian(state)
  if (liunian === null) return []
  const teammates = getLivingLegalTargetPool(state, { camp: Camp.Player })
    .filter((unit) => unit.id !== LIUNIAN_UNIT_ID)
  const highestTeammateMomentum = teammates.reduce(
    (maximum, unit) => Math.max(maximum, getLiunianActualMomentum(state, unit)),
    Number.NEGATIVE_INFINITY,
  )
  const liunianMomentum = getLiunianTotalMomentum(liunian)
  return getLivingLegalTargetPool(state, { camp: Camp.Enemy }).filter((enemy) => {
    const momentum = getLiunianActualMomentum(state, enemy)
    return momentum > highestTeammateMomentum && momentum <= liunianMomentum
  })
}

function createAttack(
  unit: UnitState,
  request: LiunianTargetSkillRequest,
  multiplier: number,
  suffix = '',
): NormalAttackRequest {
  return {
    attackId: `${request.attackId}${suffix}` as AttackId,
    damageType: DamageType.Normal,
    effectiveAttack: getEffectiveAttack(unit),
    multiplier,
    fixedDamage: 0,
    criticalRate: getEffectiveCriticalRate(unit),
    criticalDamage: getEffectiveCriticalDamage(unit),
    normalDamageIncrease: unit.normalDamageIncrease,
    targets: [{
      targetId: request.targetUnitId,
      damageEventId: `${request.damageEventId}${suffix}` as DamageEventId,
    }],
  }
}

function validateTurn(state: BattleState): UnitState | null {
  const turn = state.personalTurn
  const unit = findLiunian(state)
  return state.phase === BattlePhase.AwaitingAction
    && turn?.phase === PersonalTurnPhase.AwaitingAction
    && turn.unitId === LIUNIAN_UNIT_ID
    ? unit
    : null
}

function runPaidSkill(
  originalState: BattleState,
  ids: LiunianActionIds,
  skillId: SkillId,
  effects: readonly SkillEffectRequest[],
  attacks: readonly NormalAttackRequest[],
  energyCost: number,
  endsTurn: boolean,
  extensions: BattleEngineExtensions,
  afterResolution?: (
    state: BattleState,
    turn: PersonalTurnState,
  ) => LiunianEffectResult,
): LiunianEffectResult {
  const unit = validateTurn(originalState)
  if (unit === null) return failure(originalState, 'LIUNIAN_NOT_READY_FOR_SKILL')
  const started = startBattleAction(originalState, {
    actionId: ids.actionId,
    actorId: unit.id,
    skillExecutionId: ids.skillExecutionId,
    countsAsAction: true,
    endsTurn,
  })
  if (!started.ok) return failure(originalState, started.reason)
  const action = started.state.activeAction
  const turn = started.state.personalTurn
  if (action === null || turn === null) return failure(originalState, 'LIUNIAN_SKILL_CONTEXT_MISSING')
  const resolved = resolveResourcePaidSkillTransaction(started.state, {
    resourceTransactionId: ids.resourceTransactionId,
    actionId: ids.actionId,
    personalTurnId: turn.personalTurnId,
    sequenceId: action.sequenceId,
    skillExecutionId: ids.skillExecutionId,
    payerUnitId: unit.id,
    costs: energyCost === 0 ? [] : [{
      resourceType: ResourceType.Energy,
      amount: energyCost,
    }],
  }, {
    skillExecutionId: ids.skillExecutionId,
    skillId,
    actionId: ids.actionId,
    personalTurnId: turn.personalTurnId,
    sequenceId: action.sequenceId,
    casterId: unit.id,
    attacks,
    effects,
  })
  if (!resolved.ok) return failure(originalState, resolved.reason)
  const triggered = resolveLiunianMomentumGainTriggers(resolved.state)
  if (!triggered.ok) return failure(originalState, triggered.reason)
  const afterEffect = afterResolution?.(triggered.state, turn) ?? triggered
  if (!afterEffect.ok) return failure(originalState, afterEffect.reason)
  const afterEffectTriggers = afterResolution === undefined
    ? afterEffect
    : resolveLiunianMomentumGainTriggers(afterEffect.state)
  if (!afterEffectTriggers.ok) return failure(originalState, afterEffectTriggers.reason)
  const completed = completeBattleAction(
    afterEffectTriggers.state,
    ids.actionId,
    extensions,
  )
  if (!completed.ok) return failure(originalState, completed.reason)
  return {
    ok: true,
    state: completed.state,
    events: completed.state.events.slice(originalState.events.length),
  }
}

function healWithFeedback(
  state: BattleState,
  request: Parameters<typeof healUnit>[1],
): LiunianEffectResult {
  const healed = healUnit(state, request)
  if (!healed.ok) return failure(state, healed.reason)
  if (healed.events.length > 0) return healed
  const unit = state.units.find((candidate) => candidate.id === request.unitId)
  if (unit === undefined) return failure(state, 'LIUNIAN_HEAL_TARGET_NOT_FOUND')
  const event: BattleEvent = {
    type: 'HEALTH_RESTORED',
    unitId: unit.id,
    amount: 0,
    before: unit.currentHealth,
    after: unit.currentHealth,
    reason: request.reason,
    sourceUnitId: request.sourceUnitId ?? null,
    effectId: request.effectId ?? null,
    actionId: request.actionId,
    personalTurnId: request.personalTurnId,
    sequenceId: request.sequenceId,
    skillExecutionId: request.skillExecutionId,
  }
  return {
    ok: true,
    state: { ...state, events: [...state.events, event] },
    events: [event],
  }
}

export function applyLiunianBorrowedMomentum(
  state: BattleState,
  unitId: UnitId,
): LiunianEffectResult {
  if (unitId !== LIUNIAN_UNIT_ID) return { ok: true, state, events: [] }
  const unit = state.units.find((candidate) => candidate.id === unitId)
  if (unit === undefined) return failure(state, 'LIUNIAN_NOT_FOUND')
  if (getLiunianBorrowedMomentum(unit) > 0) return { ok: true, state, events: [] }
  return increaseSpecialCounter(state, {
    unitId,
    counterId: LIUNIAN_BORROWED_MOMENTUM_COUNTER_ID,
    amount: 6,
    sourceUnitId: unitId,
    effectId: 'liunianBorrowMomentum',
    actionId: null,
    personalTurnId: null,
    sequenceId: null,
    skillExecutionId: null,
  })
}

function setProcessedMomentumEventCount(
  state: BattleState,
  unit: UnitState,
  value: number,
): BattleState {
  const counters = unit.specialCounters.some((counter) => (
    counter.counterId === LIUNIAN_PROCESSED_MOMENTUM_EVENTS_COUNTER_ID
  ))
    ? unit.specialCounters.map((counter) => (
        counter.counterId === LIUNIAN_PROCESSED_MOMENTUM_EVENTS_COUNTER_ID
          ? { ...counter, value }
          : counter
      ))
    : [...unit.specialCounters, {
        counterId: LIUNIAN_PROCESSED_MOMENTUM_EVENTS_COUNTER_ID,
        value,
      }]
  return {
    ...state,
    units: state.units.map((candidate) => candidate.id === unit.id
      ? { ...candidate, specialCounters: counters }
      : candidate),
  }
}

export function resolveLiunianMomentumGainTriggers(
  state: BattleState,
): LiunianEffectResult {
  let currentState = state
  const events: BattleEvent[] = []
  while (true) {
    const liunian = findLiunian(currentState)
    if (liunian === null) return { ok: true, state: currentState, events }
    const momentumEvents = currentState.events.filter((event): event is ResourceChangedEvent => (
      event.type === 'RESOURCE_GAINED'
      && event.resourceType === ResourceType.Momentum
    ))
    const processed = readSpecialCounter(
      liunian,
      LIUNIAN_PROCESSED_MOMENTUM_EVENTS_COUNTER_ID,
    )
    const event = momentumEvents[processed]
    if (event === undefined) {
      return { ok: true, state: currentState, events }
    }
    currentState = setProcessedMomentumEventCount(currentState, liunian, processed + 1)
    const freshLiunian = findLiunian(currentState)
    if (freshLiunian === null) return { ok: true, state: currentState, events }
    const totalMomentum = getLiunianTotalMomentum(freshLiunian)
    if (totalMomentum <= 18 && event.unitId !== LIUNIAN_UNIT_ID) {
      const source = currentState.units.find((unit) => unit.id === event.unitId)
      if (source?.camp !== Camp.Player) continue
      let roll
      try {
        roll = rollProbabilityFromState(0.5, currentState.rngState)
      } catch {
        return failure(state, 'RANDOM_SOURCE_EXHAUSTED')
      }
      currentState = { ...currentState, rngState: roll.state }
      if (!roll.rolled) continue
      const gained = gainResource(currentState, {
        unitId: LIUNIAN_UNIT_ID,
        resourceType: ResourceType.Momentum,
        amount: 1,
        reason: 'liunianFengshui',
        sourceId: String(LIUNIAN_UNIT_ID),
        sourceUnitId: LIUNIAN_UNIT_ID,
        effectId: 'liunianFengshui',
        actionId: event.actionId,
        personalTurnId: event.personalTurnId,
        sequenceId: event.sequenceId,
        skillExecutionId: null,
        resourceTransactionId: null,
      })
      if (!gained.ok) return failure(state, gained.reason)
      const triggered: BattleEvent = {
        type: 'PASSIVE_TRIGGERED',
        unitId: LIUNIAN_UNIT_ID,
        sourceUnitId: LIUNIAN_UNIT_ID,
        effectId: 'liunianFengshui',
        targetUnitIds: [LIUNIAN_UNIT_ID],
      }
      currentState = {
        ...gained.state,
        events: [...gained.state.events, triggered],
      }
      events.push(...gained.events, triggered)
      continue
    }
    if (totalMomentum > 18 && event.unitId === LIUNIAN_UNIT_ID) {
      const targets = currentState.units.filter((unit) => (
        unit.id !== LIUNIAN_UNIT_ID
        && unit.camp === Camp.Player
        && isUnitAlive(unit)
        && getFlowTransferStacks(currentState, unit.id) > 0
      ))
      for (const target of targets) {
        const gained = gainResource(currentState, {
          unitId: target.id,
          resourceType: ResourceType.Momentum,
          amount: 1,
          reason: 'liunianFengshuiHighMomentum',
          sourceId: String(LIUNIAN_UNIT_ID),
          sourceUnitId: LIUNIAN_UNIT_ID,
          effectId: 'liunianFengshui',
          actionId: event.actionId,
          personalTurnId: event.personalTurnId,
          sequenceId: event.sequenceId,
          skillExecutionId: null,
          resourceTransactionId: null,
        })
        if (!gained.ok) return failure(state, gained.reason)
        currentState = gained.state
        events.push(...gained.events)
      }
      if (targets.length > 0) {
        const triggered: BattleEvent = {
          type: 'PASSIVE_TRIGGERED',
          unitId: LIUNIAN_UNIT_ID,
          sourceUnitId: LIUNIAN_UNIT_ID,
          effectId: 'liunianFengshui',
          targetUnitIds: targets.map((target) => target.id),
        }
        currentState = { ...currentState, events: [...currentState.events, triggered] }
        events.push(triggered)
      }
    }
  }
}

export function resolveLiunianKanyu(
  state: BattleState,
  request: LiunianTargetSkillRequest,
  extensions: BattleEngineExtensions = LIUNIAN_BATTLE_EXTENSIONS,
): LiunianEffectResult {
  const unit = validateTurn(state)
  if (unit === null) return failure(state, 'LIUNIAN_NOT_READY_FOR_KANYU')
  if (!getLiunianKanyuTargets(state).some((target) => target.id === request.targetUnitId)) {
    return failure(state, 'LIUNIAN_KANYU_INVALID_TARGET')
  }
  const status = createStatus(
    state,
    LIUNIAN_HALVED_MOMENTUM_STATUS_ID,
    request.targetUnitId,
    request.skillExecutionId,
  )
  if (status === null) return failure(state, 'LIUNIAN_STATUS_ORDER_OVERFLOW')
  const attack = createAttack(unit, request, 0.4)
  return runPaidSkill(state, request, LIUNIAN_FIRST_SKILL_ID, [
    { kind: 'attack', attack },
    { kind: 'status', operation: 'add', status },
  ], [attack], 0, true, extensions)
}

export function resolveLiunianDingxue(
  state: BattleState,
  request: LiunianTargetSkillRequest,
  extensions: BattleEngineExtensions = LIUNIAN_BATTLE_EXTENSIONS,
): LiunianEffectResult {
  const unit = validateTurn(state)
  const target = state.units.find((candidate) => candidate.id === request.targetUnitId)
  if (unit === null || target === undefined || target.camp === unit.camp || !isUnitAlive(target)) {
    return failure(state, 'LIUNIAN_DINGXUE_INVALID_TARGET')
  }
  const attackUnit = { ...unit, momentum: unit.momentum + 2 }
  const attack = createAttack(attackUnit, request, 0.6)
  return runPaidSkill(state, request, LIUNIAN_FIRST_SKILL_ID, [
    { kind: 'resource', operation: 'gain', unitId: unit.id, resourceType: ResourceType.Energy, amount: 1, reason: 'liunianDingxue' },
    { kind: 'resource', operation: 'gain', unitId: unit.id, resourceType: ResourceType.Momentum, amount: 2, reason: 'liunianDingxue' },
    { kind: 'resource', operation: 'gain', unitId: unit.id, resourceType: ResourceType.Flow, amount: 1, reason: 'liunianDingxue' },
    { kind: 'attack', attack },
  ], [attack], 0, true, extensions)
}

export function resolveLiunianDomain(
  state: BattleState,
  ids: LiunianActionIds,
  extensions: BattleEngineExtensions = LIUNIAN_BATTLE_EXTENSIONS,
): LiunianEffectResult {
  const unit = validateTurn(state)
  if (unit === null) return failure(state, 'LIUNIAN_NOT_READY_FOR_DOMAIN')
  if (isLiunianDomainActive(unit)) return failure(state, 'LIUNIAN_DOMAIN_ALREADY_ACTIVE')
  return runPaidSkill(state, ids, LIUNIAN_DOMAIN_SKILL_ID, [{
    kind: 'specialCounter',
    operation: 'increase',
    unitId: LIUNIAN_UNIT_ID,
    counterId: LIUNIAN_DOMAIN_COUNTER_ID,
    amount: 1,
  }], [], 1, false, extensions)
}

function clearFlowTransfers(state: BattleState): LiunianEffectResult {
  const removed = state.statusBatches.filter((batch) => (
    batch.statusId === LIUNIAN_FLOW_TRANSFER_STATUS_ID
  ))
  const events: BattleEvent[] = removed.map((batch) => ({
    type: 'STATUS_REMOVED',
    ownerUnitId: batch.ownerUnitId,
    statusId: batch.statusId,
    category: batch.category,
    batchId: batch.batchId,
    previousBatchId: null,
    stacks: batch.stacks,
    remainingOwnerTurns: batch.remainingOwnerTurns,
    sourceUnitId: LIUNIAN_UNIT_ID,
    skillExecutionId: null,
    effectId: LIUNIAN_DOMAIN_SKILL_ID,
  }))
  return {
    ok: true,
    state: {
      ...state,
      statusBatches: state.statusBatches.filter((batch) => (
        batch.statusId !== LIUNIAN_FLOW_TRANSFER_STATUS_ID
      )),
      events: [...state.events, ...events],
    },
    events,
  }
}

export function closeLiunianDomain(state: BattleState): LiunianEffectResult {
  const unit = state.units.find((candidate) => candidate.id === LIUNIAN_UNIT_ID)
  if (unit === undefined) return clearFlowTransfers(state)
  const count = readSpecialCounter(unit, LIUNIAN_DOMAIN_COUNTER_ID)
  let currentState = state
  const events: BattleEvent[] = []
  if (count > 0) {
    const closed = decreaseSpecialCounter(currentState, {
      unitId: LIUNIAN_UNIT_ID,
      counterId: LIUNIAN_DOMAIN_COUNTER_ID,
      amount: count,
      sourceUnitId: LIUNIAN_UNIT_ID,
      effectId: LIUNIAN_DOMAIN_SKILL_ID,
      actionId: null,
      personalTurnId: currentState.personalTurn?.personalTurnId ?? null,
      sequenceId: currentState.personalTurn?.sequenceId ?? null,
      skillExecutionId: null,
    })
    if (!closed.ok) return failure(state, closed.reason)
    currentState = closed.state
    events.push(...closed.events)
  }
  const cleared = clearFlowTransfers(currentState)
  if (!cleared.ok) return failure(state, cleared.reason)
  return { ok: true, state: cleared.state, events: [...events, ...cleared.events] }
}

export function cleanupLiunianOnDeathOrLeave(state: BattleState): LiunianEffectResult {
  const closed = closeLiunianDomain(state)
  if (!closed.ok) return closed
  return {
    ok: true,
    state: {
      ...closed.state,
      pendingEffects: (closed.state.pendingEffects ?? []).filter((effect) => (
        effect.effectId !== 'liunianNorthWindNextAllyTurn'
      )),
      pendingForcedChoice: closed.state.pendingForcedChoice?.kind === 'liunianFlowExchange'
        ? null
        : closed.state.pendingForcedChoice,
    },
    events: closed.events,
  }
}

export function hasLiunianUsedFlowChangeThisTurn(state: BattleState): boolean {
  const turn = state.personalTurn
  if (turn === null || turn.unitId !== LIUNIAN_UNIT_ID) return false
  return state.events.some((event) => (
    event.type === 'SKILL_RESOLUTION_STARTED'
    && event.skillId === LIUNIAN_FLOW_CHANGE_SKILL_ID
    && event.actionId !== null
    && turn.completedActionIds.includes(event.actionId)
  ))
}

export function resolveLiunianFlowChange(
  state: BattleState,
  ids: LiunianActionIds & { readonly targetUnitId: UnitId },
  extensions: BattleEngineExtensions = LIUNIAN_BATTLE_EXTENSIONS,
): LiunianEffectResult {
  const unit = validateTurn(state)
  const target = state.units.find((candidate) => candidate.id === ids.targetUnitId)
  if (unit === null || !isLiunianDomainActive(unit)) {
    return failure(state, 'LIUNIAN_FLOW_CHANGE_DOMAIN_REQUIRED')
  }
  if (hasLiunianUsedFlowChangeThisTurn(state)) {
    return failure(state, 'LIUNIAN_FLOW_CHANGE_ALREADY_USED_THIS_TURN')
  }
  if (target === undefined || target.camp !== Camp.Player
    || target.id === LIUNIAN_UNIT_ID || !isUnitAlive(target)) {
    return failure(state, 'LIUNIAN_FLOW_CHANGE_INVALID_TARGET')
  }
  const existingTarget = state.statusBatches.find((batch) => (
    batch.statusId === LIUNIAN_FLOW_TRANSFER_STATUS_ID
    && batch.ownerUnitId !== LIUNIAN_UNIT_ID
  ))?.ownerUnitId ?? null
  let prepared = state
  if (existingTarget !== null && existingTarget !== target.id) {
    const removed = state.statusBatches.filter((batch) => (
      batch.statusId === LIUNIAN_FLOW_TRANSFER_STATUS_ID
      && batch.ownerUnitId === existingTarget
    ))
    const removalEvents: BattleEvent[] = removed.map((batch) => ({
      type: 'STATUS_REMOVED',
      ownerUnitId: batch.ownerUnitId,
      statusId: batch.statusId,
      category: batch.category,
      batchId: batch.batchId,
      previousBatchId: null,
      stacks: batch.stacks,
      remainingOwnerTurns: batch.remainingOwnerTurns,
      sourceUnitId: LIUNIAN_UNIT_ID,
      skillExecutionId: ids.skillExecutionId,
      effectId: LIUNIAN_FLOW_CHANGE_SKILL_ID,
    }))
    prepared = {
      ...state,
      statusBatches: state.statusBatches.filter((batch) => !(
        batch.statusId === LIUNIAN_FLOW_TRANSFER_STATUS_ID
        && batch.ownerUnitId === existingTarget
      )),
      events: [...state.events, ...removalEvents],
    }
  }
  const selfStatus = createStatus(
    prepared,
    LIUNIAN_FLOW_TRANSFER_STATUS_ID,
    LIUNIAN_UNIT_ID,
    ids.skillExecutionId,
  )
  if (selfStatus === null) return failure(state, 'LIUNIAN_STATUS_ORDER_OVERFLOW')
  const withSelfOrder = {
    ...prepared,
    statusAcquisitionOrders: [
      ...prepared.statusAcquisitionOrders,
      selfStatus.acquisitionOrder,
    ],
  }
  const targetStatus = createStatus(
    withSelfOrder,
    LIUNIAN_FLOW_TRANSFER_STATUS_ID,
    target.id,
    ids.skillExecutionId,
  )
  if (targetStatus === null) return failure(state, 'LIUNIAN_STATUS_ORDER_OVERFLOW')
  const resolved = runPaidSkill(prepared, ids, LIUNIAN_FLOW_CHANGE_SKILL_ID, [
    { kind: 'status', operation: 'add', status: selfStatus },
    { kind: 'status', operation: 'add', status: targetStatus },
  ], [], 1, false, extensions)
  if (!resolved.ok) return failure(state, resolved.reason)
  return {
    ok: true,
    state: resolved.state,
    events: resolved.state.events.slice(state.events.length),
  }
}

export function prepareLiunianFlowExchange(
  state: BattleState,
  turn: PersonalTurnState,
): LiunianEffectResult {
  const holderStacks = getFlowTransferStacks(state, turn.unitId)
  if (holderStacks === 0) return { ok: true, state, events: [] }
  const other = state.units.find((unit) => (
    unit.id !== turn.unitId
    && isUnitAlive(unit)
    && getFlowTransferStacks(state, unit.id) > 0
  ))
  if (other === undefined) return { ok: true, state, events: [] }
  const choiceId = `${turn.personalTurnId}:liunian-flow-exchange`
  const event: BattleEvent = {
    type: 'FORCED_CHOICE_REQUIRED',
    choiceId,
    unitId: turn.unitId,
    sourceUnitId: LIUNIAN_UNIT_ID,
    effectId: LIUNIAN_FLOW_CHANGE_SKILL_ID,
  }
  return {
    ok: true,
    state: {
      ...state,
      pendingForcedChoice: {
        choiceId,
        unitId: turn.unitId,
        kind: 'liunianFlowExchange',
      },
      events: [...state.events, event],
    },
    events: [event],
  }
}

export function resolveLiunianFlowExchange(
  state: BattleState,
  choice: LiunianExchangeChoice,
): LiunianEffectResult {
  const pending = state.pendingForcedChoice
  if (pending?.kind !== 'liunianFlowExchange') {
    return failure(state, 'LIUNIAN_FLOW_EXCHANGE_NOT_PENDING')
  }
  const holder = state.units.find((unit) => unit.id === pending.unitId)
  const other = state.units.find((unit) => (
    unit.id !== pending.unitId
    && isUnitAlive(unit)
    && getFlowTransferStacks(state, unit.id) > 0
  ))
  if (holder === undefined || other === undefined) {
    return failure(state, 'LIUNIAN_FLOW_EXCHANGE_HOLDER_MISSING')
  }
  const loser = choice === 'otherLoses' ? other : holder
  const receiver = choice === 'otherLoses' ? holder : other
  const requested = getFlowTransferStacks(state, loser.id)
  const amount = Math.min(readUnitResource(loser, ResourceType.Momentum), requested)
  let currentState = state
  const events: BattleEvent[] = []
  if (amount > 0) {
    const lost = loseResource(currentState, {
      unitId: loser.id,
      resourceType: ResourceType.Momentum,
      amount,
      reason: 'liunianFlowExchange',
      sourceId: String(LIUNIAN_UNIT_ID),
      sourceUnitId: LIUNIAN_UNIT_ID,
      effectId: LIUNIAN_FLOW_CHANGE_SKILL_ID,
      actionId: null,
      personalTurnId: currentState.personalTurn?.personalTurnId ?? null,
      sequenceId: currentState.personalTurn?.sequenceId ?? null,
      skillExecutionId: null,
      resourceTransactionId: null,
    })
    if (!lost.ok) return failure(state, lost.reason)
    const gained = gainResource(lost.state, {
      unitId: receiver.id,
      resourceType: ResourceType.Momentum,
      amount,
      reason: 'liunianFlowExchange',
      sourceId: String(LIUNIAN_UNIT_ID),
      sourceUnitId: LIUNIAN_UNIT_ID,
      effectId: LIUNIAN_FLOW_CHANGE_SKILL_ID,
      actionId: null,
      personalTurnId: currentState.personalTurn?.personalTurnId ?? null,
      sequenceId: currentState.personalTurn?.sequenceId ?? null,
      skillExecutionId: null,
      resourceTransactionId: null,
    })
    if (!gained.ok) return failure(state, gained.reason)
    currentState = gained.state
    events.push(...lost.events, ...gained.events)
  }
  const resolvedEvent: BattleEvent = {
    type: 'FORCED_CHOICE_RESOLVED',
    choiceId: pending.choiceId,
    unitId: pending.unitId,
    sourceUnitId: LIUNIAN_UNIT_ID,
    effectId: LIUNIAN_FLOW_CHANGE_SKILL_ID,
  }
  currentState = {
    ...currentState,
    pendingForcedChoice: null,
    events: [...currentState.events, resolvedEvent],
  }
  const triggered = resolveLiunianMomentumGainTriggers(currentState)
  if (!triggered.ok) return failure(state, triggered.reason)
  return {
    ok: true,
    state: triggered.state,
    events: [...events, resolvedEvent, ...triggered.events],
  }
}

function enqueueNorthWindEffect(
  state: BattleState,
  acquisitionOrder: number,
): BattleState {
  return {
    ...state,
    pendingEffects: [...(state.pendingEffects ?? []), {
      effectId: 'liunianNorthWindNextAllyTurn',
      timing: 'playerPersonalTurnAbsoluteStart',
      ownerUnitId: LIUNIAN_UNIT_ID,
      acquisitionOrder,
      payload: { momentum: 2 },
    }],
  }
}

export function resolveLiunianNorthWind(
  state: BattleState,
  request: LiunianTargetSkillRequest,
  extensions: BattleEngineExtensions = LIUNIAN_BATTLE_EXTENSIONS,
): LiunianEffectResult {
  const original = state
  let currentState = state
  let release = 0
  while (release < 3) {
    const unit = validateTurn(currentState)
    const target = currentState.units.find((candidate) => (
      candidate.id === request.targetUnitId
    ))
    if (unit === null || !isLiunianDomainActive(unit)) {
      return failure(original, 'LIUNIAN_NORTH_WIND_DOMAIN_REQUIRED')
    }
    if (target === undefined || target.camp === unit.camp || !isUnitAlive(target)) {
      if (release === 0) return failure(original, 'LIUNIAN_NORTH_WIND_INVALID_TARGET')
      break
    }
    const suffix = release === 0 ? '' : `:repeat:${release}`
    const ids = {
      actionId: `${request.actionId}${suffix}` as ActionId,
      skillExecutionId: `${request.skillExecutionId}${suffix}` as SkillExecutionId,
      resourceTransactionId: `${request.resourceTransactionId}${suffix}` as ResourceTransactionId,
    }
    const repeatRequest = {
      ...request,
      ...ids,
      attackId: `${request.attackId}${suffix}` as AttackId,
      damageEventId: `${request.damageEventId}${suffix}` as DamageEventId,
    }
    const attackUnit = { ...unit, momentum: unit.momentum + 3 }
    const attack = createAttack(attackUnit, repeatRequest, 0.6)
    const effects: SkillEffectRequest[] = [
      { kind: 'resource', operation: 'gain', unitId: unit.id, resourceType: ResourceType.Energy, amount: 1, reason: 'liunianNorthWind' },
      { kind: 'resource', operation: 'gain', unitId: unit.id, resourceType: ResourceType.Momentum, amount: 3, reason: 'liunianNorthWind' },
      { kind: 'resource', operation: 'gain', unitId: unit.id, resourceType: ResourceType.Flow, amount: 3, reason: 'liunianNorthWind' },
      { kind: 'attack', attack },
    ]
    if (getLiunianKanyuTargets(currentState).some((candidate) => candidate.id === target.id)) {
      const status = createStatus(
        currentState,
        LIUNIAN_HALVED_MOMENTUM_STATUS_ID,
        target.id,
        ids.skillExecutionId,
      )
      if (status === null) return failure(original, 'LIUNIAN_STATUS_ORDER_OVERFLOW')
      effects.push({ kind: 'status', operation: 'add', status })
    }
    const resolved = runPaidSkill(
      currentState,
      ids,
      LIUNIAN_NORTH_WIND_SKILL_ID,
      effects,
      [attack],
      0,
      false,
      extensions,
    )
    if (!resolved.ok) return failure(original, resolved.reason)
    const order = (resolved.state.pendingEffects ?? []).reduce(
      (maximum, effect) => Math.max(maximum, effect.acquisitionOrder),
      -1,
    ) + 1
    currentState = enqueueNorthWindEffect(resolved.state, order)
    release += 1
    if (currentState.phase === BattlePhase.Finished
      || currentState.phase === BattlePhase.Paused) break
    if (release >= 3) break
    const currentLiunian = findLiunian(currentState)
    if (currentLiunian === null) break
    const probability = Math.min(
      1,
      0.2 + getFlowTransferStacks(currentState, LIUNIAN_UNIT_ID) * 0.1,
    )
    let roll
    try {
      roll = rollProbabilityFromState(probability, currentState.rngState)
    } catch {
      return failure(original, 'RANDOM_SOURCE_EXHAUSTED')
    }
    currentState = { ...currentState, rngState: roll.state }
    if (!roll.rolled) break
  }
  const turn = currentState.personalTurn
  if (currentState.phase === BattlePhase.Finished
    || currentState.phase === BattlePhase.Paused) {
    return {
      ok: true,
      state: currentState,
      events: currentState.events.slice(original.events.length),
    }
  }
  if (turn === null) return failure(original, 'LIUNIAN_NORTH_WIND_TURN_MISSING')
  const ended = endCurrentPersonalTurn(
    currentState,
    turn.personalTurnId,
    extensions,
  )
  if (!ended.ok) return failure(original, ended.reason)
  return {
    ok: true,
    state: ended.state,
    events: ended.state.events.slice(original.events.length),
  }
}

export function resolveLiunianSouthWater(
  state: BattleState,
  ids: LiunianActionIds & { readonly targetUnitId: UnitId },
  extensions: BattleEngineExtensions = LIUNIAN_BATTLE_EXTENSIONS,
): LiunianEffectResult {
  const unit = validateTurn(state)
  const target = state.units.find((candidate) => candidate.id === ids.targetUnitId)
  if (unit === null || !isLiunianDomainActive(unit)) {
    return failure(state, 'LIUNIAN_SOUTH_WATER_DOMAIN_REQUIRED')
  }
  if (target === undefined || target.camp !== Camp.Player
    || target.id === LIUNIAN_UNIT_ID || !isUnitAlive(target)) {
    return failure(state, 'LIUNIAN_SOUTH_WATER_INVALID_TARGET')
  }
  const healing = getEffectiveAttack(unit) * 0.5
  return runPaidSkill(
    state,
    ids,
    LIUNIAN_SOUTH_WATER_SKILL_ID,
    [],
    [],
    1,
    true,
    extensions,
    (effectState, turn) => {
      const healedTarget = healWithFeedback(effectState, {
        unitId: target.id,
        amount: healing,
        reason: 'liunianSouthWater',
        sourceUnitId: LIUNIAN_UNIT_ID,
        effectId: LIUNIAN_SOUTH_WATER_SKILL_ID,
        actionId: ids.actionId,
        personalTurnId: turn.personalTurnId,
        sequenceId: turn.sequenceId,
        skillExecutionId: ids.skillExecutionId,
      })
      if (!healedTarget.ok) return healedTarget
      const stacks = getFlowTransferStacks(healedTarget.state, target.id)
      if (stacks === 0) return healedTarget
      const healedSelf = healWithFeedback(healedTarget.state, {
        unitId: LIUNIAN_UNIT_ID,
        amount: healing,
        reason: 'liunianSouthWaterFlowTransfer',
        sourceUnitId: LIUNIAN_UNIT_ID,
        effectId: LIUNIAN_SOUTH_WATER_SKILL_ID,
        actionId: ids.actionId,
        personalTurnId: turn.personalTurnId,
        sequenceId: turn.sequenceId,
        skillExecutionId: ids.skillExecutionId,
      })
      if (!healedSelf.ok) return healedSelf
      const gained = gainResource(healedSelf.state, {
        unitId: target.id,
        resourceType: ResourceType.Momentum,
        amount: stacks,
        reason: 'liunianSouthWaterFlowTransfer',
        sourceId: String(LIUNIAN_UNIT_ID),
        sourceUnitId: LIUNIAN_UNIT_ID,
        effectId: LIUNIAN_SOUTH_WATER_SKILL_ID,
        actionId: ids.actionId,
        personalTurnId: turn.personalTurnId,
        sequenceId: turn.sequenceId,
        skillExecutionId: ids.skillExecutionId,
        resourceTransactionId: null,
      })
      return gained.ok ? gained : failure(effectState, gained.reason)
    },
  )
}

export function applyLiunianAbsoluteTurnStartEffect(
  state: BattleState,
  turn: PersonalTurnState,
): LiunianEffectResult {
  const unit = state.units.find((candidate) => candidate.id === turn.unitId)
  if (unit?.camp !== Camp.Player) return { ok: true, state, events: [] }
  const queue = state.pendingEffects ?? []
  const index = queue.findIndex((effect) => (
    effect.effectId === 'liunianNorthWindNextAllyTurn'
  ))
  if (index < 0) return { ok: true, state, events: [] }
  const gained = gainResource(state, {
    unitId: turn.unitId,
    resourceType: ResourceType.Momentum,
    amount: 2,
    reason: 'liunianNorthWindNextAllyTurn',
    sourceId: String(LIUNIAN_UNIT_ID),
    sourceUnitId: LIUNIAN_UNIT_ID,
    effectId: 'liunianNorthWindNextAllyTurn',
    ...context(turn),
  })
  if (!gained.ok) return failure(state, gained.reason)
  const pendingEffects = [...queue]
  pendingEffects.splice(index, 1)
  const nextState = { ...gained.state, pendingEffects }
  const triggered = resolveLiunianMomentumGainTriggers(nextState)
  if (!triggered.ok) return failure(state, triggered.reason)
  return {
    ok: true,
    state: triggered.state,
    events: [...gained.events, ...triggered.events],
  }
}

export function applyLiunianTurnEnd(
  state: BattleState,
  turn: PersonalTurnState,
): LiunianEffectResult {
  if (turn.unitId !== LIUNIAN_UNIT_ID
    || turn.phase !== PersonalTurnPhase.EndingUnitSpecificEffects) {
    return { ok: true, state, events: [] }
  }
  const unit = findLiunian(state)
  if (unit === null || !isLiunianDomainActive(unit)) {
    return { ok: true, state, events: [] }
  }
  const flow = readUnitResource(unit, ResourceType.Flow)
  const reduction = Math.min(flow, getFlowTransferStacks(state, LIUNIAN_UNIT_ID))
  let currentState = state
  const events: BattleEvent[] = []
  if (reduction > 0) {
    const lost = loseResource(currentState, {
      unitId: LIUNIAN_UNIT_ID,
      resourceType: ResourceType.Flow,
      amount: reduction,
      reason: 'liunianDomainTurnEnd',
      sourceId: String(LIUNIAN_UNIT_ID),
      sourceUnitId: LIUNIAN_UNIT_ID,
      effectId: LIUNIAN_DOMAIN_SKILL_ID,
      ...context(turn),
    })
    if (!lost.ok) return failure(state, lost.reason)
    currentState = lost.state
    events.push(...lost.events)
  }
  const current = findLiunian(currentState)
  if (current !== null && readUnitResource(current, ResourceType.Flow) > 0) {
    return { ok: true, state: currentState, events }
  }
  const closed = closeLiunianDomain(currentState)
  if (!closed.ok) return failure(state, closed.reason)
  return { ok: true, state: closed.state, events: [...events, ...closed.events] }
}

export const LIUNIAN_BATTLE_EXTENSIONS: BattleEngineExtensions = {
  applyUnitBattleStartEffects: applyLiunianBorrowedMomentum,
  applyTurnStartAbsoluteEffects: applyLiunianAbsoluteTurnStartEffect,
  applyTurnStartForcedChoices: prepareLiunianFlowExchange,
  applyAfterActionEffects(state): BattleTransitionResult {
    const liunian = state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)
    if (liunian === undefined || !isUnitAlive(liunian)) {
      return cleanupLiunianOnDeathOrLeave(state)
    }
    return resolveLiunianMomentumGainTriggers(state)
  },
  applyUnitTurnEndEffects: applyLiunianTurnEnd,
}
