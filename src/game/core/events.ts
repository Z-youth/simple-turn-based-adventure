import type {
  ActionLifecycleStage,
  StatusCategory,
  TurnEndStage,
  TurnStartStage,
} from './enums'
import type { AttackContext, DamageEvent } from './contexts'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  PersonalTurnId,
  SkillExecutionId,
  SkillId,
  StatusBatchId,
  StatusId,
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

interface SkillResolutionEventBase {
  readonly skillExecutionId: SkillExecutionId
  readonly actionId: ActionId
  readonly skillId: SkillId
  readonly casterId: UnitId
}

export interface SkillResolutionStartedEvent extends SkillResolutionEventBase {
  readonly type: 'SKILL_RESOLUTION_STARTED'
}

export interface SkillResolutionCompletedEvent extends SkillResolutionEventBase {
  readonly type: 'SKILL_RESOLUTION_COMPLETED'
}

export interface AttackStartedEvent {
  readonly type: 'ATTACK_STARTED'
  readonly context: AttackContext
}

export interface CriticalRolledEvent {
  readonly type: 'CRITICAL_ROLLED'
  readonly skillExecutionId: SkillExecutionId
  readonly attackId: AttackId
  readonly targetId: UnitId
  readonly originalRate: number
  readonly probability: number
  readonly critical: boolean
  readonly rngConsumed: boolean
}

export interface DamageCalculatedEvent {
  readonly type: 'DAMAGE_CALCULATED'
  readonly damage: DamageEvent
}

export interface ShieldAbsorbedEvent {
  readonly type: 'SHIELD_ABSORBED'
  readonly skillExecutionId: SkillExecutionId
  readonly attackId: AttackId
  readonly damageEventId: DamageEventId
  readonly targetId: UnitId
  readonly amount: number
  readonly remainingShield: number
}

export interface HealthLostEvent {
  readonly type: 'HEALTH_LOST'
  readonly skillExecutionId: SkillExecutionId
  readonly attackId: AttackId
  readonly damageEventId: DamageEventId
  readonly targetId: UnitId
  readonly amount: number
  readonly remainingHealth: number
  readonly targetWasAlreadyDead: boolean
}

export interface UnitDiedEvent {
  readonly type: 'UNIT_DIED'
  readonly skillExecutionId: SkillExecutionId
  readonly attackId: AttackId
  readonly damageEventId: DamageEventId
  readonly unitId: UnitId
}

export interface ExtraDamageAppliedEvent {
  readonly type: 'EXTRA_DAMAGE_APPLIED'
  readonly damage: DamageEvent
}

export interface AttackCompletedEvent {
  readonly type: 'ATTACK_COMPLETED'
  readonly skillExecutionId: SkillExecutionId
  readonly attackId: AttackId
}

export type StatusChangeKind =
  | 'STATUS_ACQUIRED'
  | 'STATUS_BATCH_MERGED'
  | 'STATUS_DURATION_REFRESHED'
  | 'STATUS_BATCH_REPLACED'
  | 'STATUS_REJECTED'
  | 'STATUS_STACK_REMOVED'
  | 'STATUS_BATCH_REMOVED'
  | 'STATUS_DURATION_DECREMENTED'
  | 'STATUS_CLEANSED'
  | 'STATUS_DISPELLED'

export interface StatusChangedEvent {
  readonly type: StatusChangeKind
  readonly ownerUnitId: UnitId
  readonly statusId: StatusId
  readonly category: StatusCategory
  readonly batchId: StatusBatchId
  readonly previousBatchId: StatusBatchId | null
  readonly stacks: number
  readonly remainingOwnerTurns: number | null
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
  | SkillResolutionStartedEvent
  | SkillResolutionCompletedEvent
  | AttackStartedEvent
  | CriticalRolledEvent
  | DamageCalculatedEvent
  | ShieldAbsorbedEvent
  | HealthLostEvent
  | UnitDiedEvent
  | ExtraDamageAppliedEvent
  | AttackCompletedEvent
  | StatusChangedEvent
