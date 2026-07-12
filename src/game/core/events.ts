import type {
  ActionLifecycleStage,
  TurnEndStage,
  TurnStartStage,
} from './enums'
import type {
  ActionId,
  PersonalTurnId,
  TurnSequenceId,
  UnitId,
} from './identifiers'

interface SequenceEventBase {
  readonly sequenceId: TurnSequenceId
  readonly sequenceNumber: number
}

interface TurnEventBase extends SequenceEventBase {
  readonly personalTurnId: PersonalTurnId
  readonly unitId: UnitId
}

interface ActionEventBase extends TurnEventBase {
  readonly actionId: ActionId
}

export interface SequenceStartedEvent extends SequenceEventBase {
  readonly type: 'SEQUENCE_STARTED'
  readonly orderedUnitIds: readonly UnitId[]
}

export interface SequenceCompletedEvent extends SequenceEventBase {
  readonly type: 'SEQUENCE_COMPLETED'
}

export interface BattleCannotContinueEvent extends SequenceEventBase {
  readonly type: 'BATTLE_CANNOT_CONTINUE'
  readonly reason: 'NO_ELIGIBLE_UNITS'
}

export interface UnitSkippedDeadEvent extends SequenceEventBase {
  readonly type: 'UNIT_SKIPPED_DEAD'
  readonly unitId: UnitId
}

export interface TurnStartedEvent extends TurnEventBase {
  readonly type: 'TURN_STARTED'
}

export interface TurnStartStageEnteredEvent extends TurnEventBase {
  readonly type: 'TURN_START_STAGE_ENTERED'
  readonly stage: TurnStartStage
}

export interface TurnStartStageCompletedEvent extends TurnEventBase {
  readonly type: 'TURN_START_STAGE_COMPLETED'
  readonly stage: TurnStartStage
}

export interface TurnEndRequestedEvent extends TurnEventBase {
  readonly type: 'TURN_END_REQUESTED'
}

export interface TurnEndStageEnteredEvent extends TurnEventBase {
  readonly type: 'TURN_END_STAGE_ENTERED'
  readonly stage: TurnEndStage
}

export interface TurnEndStageCompletedEvent extends TurnEventBase {
  readonly type: 'TURN_END_STAGE_COMPLETED'
  readonly stage: TurnEndStage
}

export interface TurnEndedEvent extends TurnEventBase {
  readonly type: 'TURN_ENDED'
  readonly skippedEndStagesBecauseDead: boolean
}

export interface ActionConfirmedEvent extends ActionEventBase {
  readonly type: 'ACTION_CONFIRMED'
}

export interface ActionStartedEvent extends ActionEventBase {
  readonly type: 'ACTION_STARTED'
  readonly countsAsAction: boolean
  readonly endsTurn: boolean
}

export interface ActionStageReachedEvent extends ActionEventBase {
  readonly type: 'ACTION_STAGE_REACHED'
  readonly stage: ActionLifecycleStage
}

export interface ActionCompletedEvent extends ActionEventBase {
  readonly type: 'ACTION_COMPLETED'
  readonly countedActionCount: number
}

export type BattleEvent =
  | SequenceStartedEvent
  | SequenceCompletedEvent
  | BattleCannotContinueEvent
  | UnitSkippedDeadEvent
  | TurnStartedEvent
  | TurnStartStageEnteredEvent
  | TurnStartStageCompletedEvent
  | TurnEndRequestedEvent
  | TurnEndStageEnteredEvent
  | TurnEndStageCompletedEvent
  | TurnEndedEvent
  | ActionConfirmedEvent
  | ActionStartedEvent
  | ActionStageReachedEvent
  | ActionCompletedEvent
