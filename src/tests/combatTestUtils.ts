import type {
  AttackId,
  DamageEventId,
  PersonalTurnId,
  SkillExecutionId,
  SkillId,
  StatusBatchId,
  StatusId,
  TriggerLockId,
  TurnSequenceId,
  ResourceTransactionId,
} from '../game/core/identifiers'
import type { AttackRequest, SkillResolutionRequest } from '../game/core/attacks'
import type { BattleState } from '../game/core/contexts'
import type { RandomState } from '../game/core/rng'
import { startBattleAction, startBattleSequence } from '../game/core/battleEngine'
import { createBattleState } from './battleTestUtils'
import type { UnitState } from '../game/core/units'
import { ActionLifecycleStage } from '../game/core/enums'

export const ids = {
  action: 'action:skill' as import('../game/core/identifiers').ActionId,
  skillExecution: 'skill-execution:1' as SkillExecutionId,
  skill: 'skill:test' as SkillId,
  attack(value: string): AttackId {
    return value as AttackId
  },
  damage(value: string): DamageEventId {
    return value as DamageEventId
  },
  status(value: string): StatusId {
    return value as StatusId
  },
  batch(value: string): StatusBatchId {
    return value as StatusBatchId
  },
  lock(value: string): TriggerLockId {
    return value as TriggerLockId
  },
}

export function createResolvingState(
  units: readonly UnitState[],
  rngState?: RandomState,
): BattleState {
  const initial = createBattleState(units)
  const withRng = rngState === undefined ? initial : { ...initial, rngState }
  const sequence = startBattleSequence(withRng)
  if (!sequence.ok || sequence.state.personalTurn === null) {
    throw new Error('Could not start test turn')
  }
  const action = startBattleAction(sequence.state, {
    actionId: ids.action,
    actorId: sequence.state.personalTurn.unitId,
    skillExecutionId: ids.skillExecution,
    endsTurn: false,
  })
  if (!action.ok || action.state.personalTurn === null) {
    throw new Error('Could not start test action')
  }
  const activeAction = action.state.activeAction
  if (activeAction === null) throw new Error('Could not stage test payment')
  const resourceTransactionId = 'resource:test:paid' as ResourceTransactionId
  return {
    ...action.state,
    activeAction: {
      ...activeAction,
      stage: ActionLifecycleStage.SkillResolution,
    },
    completedResourcePayment: {
      resourceTransactionId,
      skillExecutionId: ids.skillExecution,
      actionId: ids.action,
      personalTurnId: action.state.personalTurn.personalTurnId,
      sequenceId: activeAction.sequenceId,
      payerUnitId: activeAction.actorId,
      reservedCosts: [],
    },
    resourcePaymentRegistry: {
      resourceTransactionIds: [resourceTransactionId],
      paidSkillExecutionIds: [ids.skillExecution],
    },
  }
}

export function skillRequest(
  state: BattleState,
  attacks: readonly AttackRequest[],
): SkillResolutionRequest {
  if (state.activeAction === null || state.personalTurn === null) {
    throw new Error('Test state has no active action')
  }
  return {
    skillExecutionId: ids.skillExecution,
    skillId: ids.skill,
    actionId: ids.action,
    personalTurnId: state.personalTurn.personalTurnId as PersonalTurnId,
    sequenceId: state.activeAction.sequenceId as TurnSequenceId,
    casterId: state.activeAction.actorId,
    attacks,
  }
}
