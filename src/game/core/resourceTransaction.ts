import { ActionLifecycleStage, BattlePhase, PersonalTurnPhase } from './enums'
import type { BattleState } from './contexts'
import type { BattleEvent } from './events'
import type {
  ActionId,
  PersonalTurnId,
  ResourceTransactionId,
  SkillExecutionId,
  TurnSequenceId,
  UnitId,
} from './identifiers'
import type { SkillResolutionRequest } from './attacks'
import type { SkillResolutionErrorCode } from './resolutionTransaction'
import { resolveSkillTransaction } from './resolutionTransaction'
import { validateRandomState } from './rng'
import { validateBattleStateUnits } from './combatValidation'
import type {
  ResourceCost,
  ResourceErrorCode,
  ResourceType,
} from './resources'
import {
  getResourceConfig,
  readUnitResource,
  RESOURCE_TYPE_ORDER,
  spendResource,
  validateResourceConfiguration,
  unitResourcesMatchConfiguration,
} from './resources'

export interface ResourcePaymentRequest {
  readonly resourceTransactionId: ResourceTransactionId
  readonly actionId: ActionId
  readonly personalTurnId: PersonalTurnId
  readonly sequenceId: TurnSequenceId
  readonly skillExecutionId: SkillExecutionId
  readonly payerUnitId: UnitId
  readonly costs: readonly ResourceCost[]
}

export type ResourceTransactionErrorCode = ResourceErrorCode
  | 'RESOURCE_PAYMENT_ALREADY_COMPLETED'
  | 'RESOURCE_TRANSACTION_ID_ALREADY_USED'
  | 'NOT_AT_RESOURCE_PAYMENT_BOUNDARY'
  | 'RESOURCE_PAYMENT_NOT_COMPLETED'
  | 'RESOURCE_ACTION_ID_MISMATCH'
  | 'RESOURCE_PERSONAL_TURN_ID_MISMATCH'
  | 'RESOURCE_SEQUENCE_ID_MISMATCH'
  | 'RESOURCE_SKILL_EXECUTION_ID_MISMATCH'
  | 'RESOURCE_PAYER_ID_MISMATCH'
  | 'RESOURCE_NO_ACTIVE_ACTION'
  | 'RESOURCE_NO_ACTIVE_SKILL'
  | 'RESOURCE_PERSONAL_TURN_ENDED'
  | 'RESOURCE_COST_TOTAL_OVERFLOW'
  | 'ACTION_ROLLBACK_STATE_MISSING'

export interface ResourceSkillTransactionSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

export interface ResourceSkillTransactionFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: ResourceTransactionErrorCode | SkillResolutionErrorCode
}

export type ResourceSkillTransactionResult =
  | ResourceSkillTransactionSuccess
  | ResourceSkillTransactionFailure

interface PreparedPaymentSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

interface PreparedPaymentFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: ResourceTransactionErrorCode
}

type PreparedPaymentResult = PreparedPaymentSuccess | PreparedPaymentFailure

function paymentFailure(
  state: BattleState,
  reason: ResourceTransactionErrorCode,
): PreparedPaymentFailure {
  return { ok: false, state, events: [], reason }
}

function rollbackState(state: BattleState): BattleState {
  return state.actionRollbackState ?? state
}

function aggregateCosts(
  costs: readonly ResourceCost[],
): readonly ResourceCost[] | ResourceTransactionErrorCode {
  for (const cost of costs) {
    if (!Number.isSafeInteger(cost.amount) || cost.amount <= 0) {
      return 'INVALID_RESOURCE_AMOUNT'
    }
    if (!RESOURCE_TYPE_ORDER.includes(cost.resourceType)) {
      return 'RESOURCE_NOT_SUPPORTED'
    }
  }
  const aggregated: ResourceCost[] = []
  for (const resourceType of RESOURCE_TYPE_ORDER) {
    const amounts = costs
      .filter((cost) => cost.resourceType === resourceType)
      .map((cost) => cost.amount)
    if (amounts.length === 0) continue
    const amount = amounts.reduce((total, value) => total + value, 0)
    if (!Number.isSafeInteger(amount)) return 'RESOURCE_COST_TOTAL_OVERFLOW'
    aggregated.push({ resourceType, amount })
  }
  return aggregated
}

function validatePaymentBoundary(
  state: BattleState,
  request: ResourcePaymentRequest,
): ResourceTransactionErrorCode | null {
  if (state.personalTurn?.phase === PersonalTurnPhase.Ended) {
    return 'RESOURCE_PERSONAL_TURN_ENDED'
  }
  if (state.phase !== BattlePhase.ResolvingAction
    || state.personalTurn?.phase !== PersonalTurnPhase.ResolvingAction) {
    return 'NOT_AT_RESOURCE_PAYMENT_BOUNDARY'
  }
  const action = state.activeAction
  if (action === null) return 'RESOURCE_NO_ACTIVE_ACTION'
  if (action.skillExecutionId === null) return 'RESOURCE_NO_ACTIVE_SKILL'
  if (action.stage !== ActionLifecycleStage.ResourceValidationAndPayment) {
    return state.completedResourcePayment === null
      ? 'NOT_AT_RESOURCE_PAYMENT_BOUNDARY'
      : 'RESOURCE_PAYMENT_ALREADY_COMPLETED'
  }
  if (state.completedResourcePayment !== null) {
    return 'RESOURCE_PAYMENT_ALREADY_COMPLETED'
  }
  if (state.completedSkillResolution !== null) {
    return 'RESOURCE_PAYMENT_ALREADY_COMPLETED'
  }
  if (state.resourcePaymentRegistry.resourceTransactionIds.includes(
    request.resourceTransactionId,
  )) return 'RESOURCE_TRANSACTION_ID_ALREADY_USED'
  if (state.resourcePaymentRegistry.paidSkillExecutionIds.includes(
    request.skillExecutionId,
  )) return 'RESOURCE_PAYMENT_ALREADY_COMPLETED'
  if (action.actionId !== request.actionId) return 'RESOURCE_ACTION_ID_MISMATCH'
  if (action.personalTurnId !== request.personalTurnId
    || state.personalTurn.personalTurnId !== request.personalTurnId) {
    return 'RESOURCE_PERSONAL_TURN_ID_MISMATCH'
  }
  if (action.sequenceId !== request.sequenceId) {
    return 'RESOURCE_SEQUENCE_ID_MISMATCH'
  }
  if (action.skillExecutionId !== request.skillExecutionId) {
    return 'RESOURCE_SKILL_EXECUTION_ID_MISMATCH'
  }
  if (action.actorId !== request.payerUnitId) {
    return 'RESOURCE_PAYER_ID_MISMATCH'
  }
  if (state.actionRollbackState === null) return 'ACTION_ROLLBACK_STATE_MISSING'
  return null
}

function prepareResourcePayment(
  state: BattleState,
  request: ResourcePaymentRequest,
): PreparedPaymentResult {
  const boundaryError = validatePaymentBoundary(state, request)
  if (boundaryError !== null) return paymentFailure(state, boundaryError)
  const configurationError = validateResourceConfiguration(
    state.resourceConfiguration,
  )
  if (configurationError !== null) {
    return paymentFailure(state, configurationError)
  }
  const payer = state.units.find((unit) => unit.id === request.payerUnitId)
  if (payer === undefined) return paymentFailure(state, 'RESOURCE_OWNER_NOT_FOUND')
  if (!payer.alive || (!payer.hasInfiniteHealth && payer.currentHealth <= 0)) {
    return paymentFailure(state, 'RESOURCE_OWNER_DEAD')
  }
  if (!unitResourcesMatchConfiguration(payer, state.resourceConfiguration)) {
    return paymentFailure(state, 'RESOURCE_VALUE_OUT_OF_RANGE')
  }
  const aggregated = aggregateCosts(request.costs)
  if (typeof aggregated === 'string') return paymentFailure(state, aggregated)
  for (const cost of aggregated) {
    const config = getResourceConfig(state.resourceConfiguration, cost.resourceType)
    if (config === undefined) return paymentFailure(state, 'RESOURCE_NOT_SUPPORTED')
    if (!config.allowSpend) {
      return paymentFailure(state, 'RESOURCE_OPERATION_NOT_ALLOWED')
    }
    const current = readUnitResource(payer, cost.resourceType)
    if (!Number.isSafeInteger(current)) {
      return paymentFailure(state, 'RESOURCE_VALUE_OUT_OF_RANGE')
    }
    if (current - cost.amount < config.minimum) {
      return paymentFailure(state, 'INSUFFICIENT_RESOURCE')
    }
  }

  let temporaryState = state
  const events: BattleEvent[] = []
  for (const cost of aggregated) {
    const result = spendResource(temporaryState, {
      unitId: request.payerUnitId,
      resourceType: cost.resourceType as ResourceType,
      amount: cost.amount,
      reason: 'skillPayment',
      sourceId: String(request.skillExecutionId),
      actionId: request.actionId,
      personalTurnId: request.personalTurnId,
      sequenceId: request.sequenceId,
      skillExecutionId: request.skillExecutionId,
      resourceTransactionId: request.resourceTransactionId,
    })
    if (!result.ok) return paymentFailure(state, result.reason)
    temporaryState = result.state
    events.push(...result.events)
  }
  const action = temporaryState.activeAction
  if (action === null) return paymentFailure(state, 'RESOURCE_NO_ACTIVE_ACTION')
  const stageEvent: BattleEvent = {
    type: 'ACTION_STAGE_REACHED',
    sequenceId: request.sequenceId,
    sequenceNumber: temporaryState.personalTurn?.sequenceNumber ?? 0,
    personalTurnId: request.personalTurnId,
    unitId: request.payerUnitId,
    actionId: request.actionId,
    stage: ActionLifecycleStage.SkillResolution,
  }
  return {
    ok: true,
    state: {
      ...temporaryState,
      activeAction: { ...action, stage: ActionLifecycleStage.SkillResolution },
      completedResourcePayment: {
        resourceTransactionId: request.resourceTransactionId,
        skillExecutionId: request.skillExecutionId,
        actionId: request.actionId,
        personalTurnId: request.personalTurnId,
        sequenceId: request.sequenceId,
        payerUnitId: request.payerUnitId,
      },
      resourcePaymentRegistry: {
        resourceTransactionIds: [
          ...state.resourcePaymentRegistry.resourceTransactionIds,
          request.resourceTransactionId,
        ],
        paidSkillExecutionIds: [
          ...state.resourcePaymentRegistry.paidSkillExecutionIds,
          request.skillExecutionId,
        ],
      },
      events: [...temporaryState.events, stageEvent],
    },
    events: [...events, stageEvent],
  }
}

export function resolveResourcePaidSkillTransaction(
  state: BattleState,
  payment: ResourcePaymentRequest,
  skill: SkillResolutionRequest,
): ResourceSkillTransactionResult {
  const invalidUnits = validateBattleStateUnits(state)
  if (invalidUnits !== null) {
    return { ok: false, state, events: [], reason: invalidUnits }
  }
  const rolledBack = rollbackState(state)
  if (validateRandomState(state.rngState) !== null) {
    return { ok: false, state: rolledBack, events: [], reason: 'INVALID_RANDOM_STATE' }
  }
  const prepared = prepareResourcePayment(state, payment)
  if (!prepared.ok) {
    return { ok: false, state, events: [], reason: prepared.reason }
  }
  const resolved = resolveSkillTransaction(prepared.state, skill)
  if (!resolved.ok) {
    return { ok: false, state: rolledBack, events: [], reason: resolved.reason }
  }
  return {
    ok: true,
    state: resolved.state,
    events: [...prepared.events, ...resolved.events],
  }
}
