import { ActionLifecycleStage, PersonalTurnPhase } from './enums'
import type { ActionContext, PersonalTurnState } from './contexts'
import type { BattleEvent } from './events'
import type {
  ActionId,
  SkillExecutionId,
  UnitId,
} from './identifiers'

export interface StartActionInput {
  readonly actionId: ActionId
  readonly actorId: UnitId
  readonly skillExecutionId?: SkillExecutionId | null
  readonly countsAsAction?: boolean
  readonly endsTurn?: boolean
}

export interface StartActionSuccess {
  readonly ok: true
  readonly turn: PersonalTurnState
  readonly action: ActionContext
  readonly events: readonly BattleEvent[]
}

export interface CompleteActionSuccess {
  readonly ok: true
  readonly turn: PersonalTurnState
  readonly events: readonly BattleEvent[]
}

export interface ActionLifecycleFailure {
  readonly ok: false
  readonly reason: string
}

export type StartActionResult = StartActionSuccess | ActionLifecycleFailure
export type CompleteActionResult = CompleteActionSuccess | ActionLifecycleFailure

function getActionEventBase(
  turn: PersonalTurnState,
  actionId: ActionId,
) {
  return {
    sequenceId: turn.sequenceId,
    sequenceNumber: turn.sequenceNumber,
    personalTurnId: turn.personalTurnId,
    unitId: turn.unitId,
    actionId,
  }
}

export function beginAction(
  turn: PersonalTurnState,
  input: StartActionInput,
): StartActionResult {
  if (turn.phase !== PersonalTurnPhase.AwaitingAction) {
    return { ok: false, reason: 'PERSONAL_TURN_NOT_AWAITING_ACTION' }
  }
  if (turn.unitId !== input.actorId) {
    return { ok: false, reason: 'ACTION_ACTOR_IS_NOT_CURRENT_UNIT' }
  }
  if (turn.startedActionIds.includes(input.actionId)) {
    return { ok: false, reason: 'ACTION_ID_ALREADY_USED_IN_PERSONAL_TURN' }
  }

  const countsAsAction = input.countsAsAction ?? true
  const endsTurn = input.endsTurn ?? true
  const action: ActionContext = {
    actionId: input.actionId,
    actorId: input.actorId,
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    skillExecutionId: input.skillExecutionId ?? null,
    countsAsAction,
    endsTurn,
  }
  const baseEvent = getActionEventBase(turn, action.actionId)
  const events: BattleEvent[] = [
    { type: 'ACTION_CONFIRMED', ...baseEvent },
    {
      type: 'ACTION_STARTED',
      ...baseEvent,
      countsAsAction,
      endsTurn,
    },
  ]

  if (countsAsAction) {
    events.push({
      type: 'ACTION_STAGE_REACHED',
      ...baseEvent,
      stage: ActionLifecycleStage.OnAction,
    })
  }
  events.push(
    {
      type: 'ACTION_STAGE_REACHED',
      ...baseEvent,
      stage: ActionLifecycleStage.ResourceValidationAndPayment,
    },
    {
      type: 'ACTION_STAGE_REACHED',
      ...baseEvent,
      stage: ActionLifecycleStage.SkillResolution,
    },
  )

  return {
    ok: true,
    turn: {
      ...turn,
      phase: PersonalTurnPhase.ResolvingAction,
      startedActionIds: [...turn.startedActionIds, action.actionId],
    },
    action,
    events,
  }
}

export function finishAction(
  turn: PersonalTurnState,
  action: ActionContext,
  actionId: ActionId,
): CompleteActionResult {
  if (turn.phase !== PersonalTurnPhase.ResolvingAction) {
    return { ok: false, reason: 'NO_ACTION_IS_RESOLVING' }
  }
  if (action.actionId !== actionId) {
    return { ok: false, reason: 'ACTION_ID_DOES_NOT_MATCH_ACTIVE_ACTION' }
  }
  if (turn.completedActionIds.includes(actionId)) {
    return { ok: false, reason: 'ACTION_ALREADY_COMPLETED' }
  }

  const countedActionCount = turn.countedActionCount
    + (action.countsAsAction ? 1 : 0)
  const baseEvent = getActionEventBase(turn, actionId)
  const events: BattleEvent[] = []

  if (action.countsAsAction) {
    events.push({
      type: 'ACTION_STAGE_REACHED',
      ...baseEvent,
      stage: ActionLifecycleStage.AfterAction,
    })
  }
  events.push({
    type: 'ACTION_COMPLETED',
    ...baseEvent,
    countedActionCount,
  })

  return {
    ok: true,
    turn: {
      ...turn,
      phase: action.endsTurn
        ? PersonalTurnPhase.Ending
        : PersonalTurnPhase.AwaitingAction,
      completedActionIds: [...turn.completedActionIds, actionId],
      countedActionCount,
    },
    events,
  }
}
