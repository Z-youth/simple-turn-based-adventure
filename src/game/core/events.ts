import type {
  ActionLifecycleStage,
  StatusCategory,
  TurnEndStage,
  TurnStartStage,
} from './enums'
import type { AttackContext, DamageEvent, SkillContext } from './contexts'
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
  ResourceTransactionId,
  SpecialCounterId,
} from './identifiers'
import type { ResourceType } from './resources'
import type { ModifierSourceId } from './units'

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

export interface TrainingPausedEvent {
  readonly type: 'TRAINING_PAUSED'
  readonly reason: 'ALL_PLAYER_UNITS_DEFEATED' | 'MANUAL_PAUSE'
}

export interface TrainingFinishedEvent {
  readonly type: 'TRAINING_FINISHED'
  readonly reason: 'FINITE_HEALTH_BOSS_DEFEATED'
}

export interface TrainingExitConfirmedEvent {
  readonly type: 'TRAINING_EXIT_CONFIRMED'
}

export interface UnitSkippedDeadEvent extends SequenceEventBase {
  readonly type: 'UNIT_SKIPPED_DEAD'
  readonly unitId: UnitId
}

export interface BattlefieldUnitEvent {
  readonly type: 'UNIT_SUMMONED' | 'UNIT_REMOVED' | 'UNIT_RETREATED'
    | 'UNIT_RETURNED'
  readonly unitId: UnitId
  readonly sourceUnitId: UnitId | null
  readonly effectId: string | null
}

export interface UnitReplacedEvent {
  readonly type: 'UNIT_REPLACED'
  readonly replacedUnitId: UnitId
  readonly replacementUnitId: UnitId
  readonly sourceUnitId: UnitId | null
  readonly effectId: string | null
}

export interface BattleFinishedEvent {
  readonly type: 'BATTLE_FINISHED'
  readonly outcome: 'playerVictory' | 'playerDefeat'
  readonly reason: 'ALL_ENEMY_UNITS_DEFEATED' | 'ALL_PLAYER_UNITS_DEFEATED'
}

export interface ForcedChoiceEvent {
  readonly type: 'FORCED_CHOICE_REQUIRED' | 'FORCED_CHOICE_RESOLVED'
  readonly choiceId: string
  readonly unitId: UnitId
  readonly sourceUnitId: UnitId
  readonly effectId: string
}

export interface PassiveTriggeredEvent {
  readonly type: 'PASSIVE_TRIGGERED'
  readonly unitId: UnitId
  readonly effectId: string
  readonly sourceUnitId: UnitId
  readonly targetUnitIds: readonly UnitId[]
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
  readonly actionId: ActionId | null
  readonly skillId: SkillId
  readonly casterId: UnitId
}

export interface SkillResolutionStartedEvent extends SkillResolutionEventBase {
  readonly type: 'SKILL_RESOLUTION_STARTED'
  readonly sourceUnitId: UnitId
  readonly resolutionKind: 'manual' | 'automatic' | 'passive' | 'reaction'
  readonly context?: SkillContext
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

export interface ResourceChangedEvent {
  readonly type: 'RESOURCE_GAINED' | 'RESOURCE_LOST' | 'RESOURCE_SPENT'
  readonly unitId: UnitId
  readonly resourceType: ResourceType
  readonly amount: number
  readonly before: number
  readonly after: number
  readonly reason: string
  readonly sourceId: string | null
  readonly sourceUnitId: UnitId | null
  readonly effectId: string | null
  readonly actionId: ActionId | null
  readonly personalTurnId: PersonalTurnId | null
  readonly sequenceId: TurnSequenceId | null
  readonly skillExecutionId: SkillExecutionId | null
  readonly resourceTransactionId: ResourceTransactionId | null
}

export interface ResourceSetEvent {
  readonly type: 'RESOURCE_SET'
  readonly unitId: UnitId
  readonly resourceType: ResourceType
  readonly before: number
  readonly after: number
  readonly reason: string
  readonly sourceId: string | null
  readonly sourceUnitId: UnitId | null
  readonly effectId: string | null
  readonly actionId: ActionId | null
  readonly personalTurnId: PersonalTurnId | null
  readonly sequenceId: TurnSequenceId | null
  readonly skillExecutionId: SkillExecutionId | null
  readonly resourceTransactionId: ResourceTransactionId | null
}

export interface ResourceReductionPreventedEvent {
  readonly type: 'RESOURCE_REDUCTION_PREVENTED'
  readonly unitId: UnitId
  readonly resourceType: ResourceType
  readonly attemptedAmount: number
  readonly protectionCounterId: SpecialCounterId
  readonly reason: string
  readonly sourceId: string | null
  readonly sourceUnitId: UnitId | null
  readonly effectId: string | null
  readonly actionId: ActionId | null
  readonly personalTurnId: PersonalTurnId | null
  readonly sequenceId: TurnSequenceId | null
  readonly skillExecutionId: SkillExecutionId | null
  readonly resourceTransactionId: ResourceTransactionId | null
}

export interface SpecialCounterChangedEvent {
  readonly type: 'SPECIAL_COUNTER_CHANGED'
  readonly unitId: UnitId
  readonly counterId: SpecialCounterId
  readonly operation: 'increase' | 'decrease'
  readonly amount: number
  readonly before: number
  readonly after: number
  readonly sourceUnitId: UnitId | null
  readonly effectId: string | null
  readonly actionId: ActionId | null
  readonly personalTurnId: PersonalTurnId | null
  readonly sequenceId: TurnSequenceId | null
  readonly skillExecutionId: SkillExecutionId | null
}

export interface MomentumPressureRecalculatedEvent {
  readonly type: 'MOMENTUM_PRESSURE_RECALCULATED'
  readonly unitId: UnitId
  readonly personalTurnId: PersonalTurnId
  readonly sequenceId: TurnSequenceId
  readonly momentum: number
  readonly before: number
  readonly after: number
}

export interface MomentumPressureClearedEvent {
  readonly type: 'MOMENTUM_PRESSURE_CLEARED'
  readonly unitId: UnitId
  readonly personalTurnId: PersonalTurnId
  readonly sequenceId: TurnSequenceId
  readonly before: number
  readonly after: 0
}

export interface MomentumPressureTriggeredEvent {
  readonly type: 'MOMENTUM_PRESSURE_TRIGGERED'
  readonly skillExecutionId: SkillExecutionId
  readonly attackId: AttackId
  readonly damageEventId: DamageEventId
  readonly sourceUnitId: UnitId
  readonly targetUnitId: UnitId
  readonly momentumPressure: number
  readonly extraDamage: number
}

export interface ShieldGainedEvent {
  readonly type: 'SHIELD_GAINED'
  readonly unitId: UnitId
  readonly amount: number
  readonly before: number
  readonly after: number
  readonly reason: string
  readonly sourceUnitId: UnitId | null
  readonly effectId: string | null
  readonly personalTurnId: PersonalTurnId | null
  readonly sequenceId: TurnSequenceId | null
  readonly skillExecutionId: SkillExecutionId | null
}

export interface HealthRestoredEvent {
  readonly type: 'HEALTH_RESTORED'
  readonly unitId: UnitId
  readonly amount: number
  readonly before: number
  readonly after: number
  readonly reason: string
  readonly sourceUnitId: UnitId | null
  readonly effectId: string | null
  readonly actionId: ActionId | null
  readonly personalTurnId: PersonalTurnId | null
  readonly sequenceId: TurnSequenceId | null
  readonly skillExecutionId: SkillExecutionId | null
}

export interface TemporaryAttributeChangedEvent {
  readonly type: 'TEMPORARY_ATTRIBUTE_CHANGED'
  readonly operation: 'applied' | 'durationDecremented' | 'removed'
  readonly unitId: UnitId
  readonly attribute: 'attack' | 'criticalRate' | 'criticalDamage'
  readonly sourceUnitId: UnitId | null
  readonly effectId: ModifierSourceId
  readonly value: number
  readonly durationKind: 'currentPersonalTurn' | 'ownerTurns'
  readonly remainingOwnerTurns: number | null
  readonly expiresAtPersonalTurnId: PersonalTurnId | null
  readonly actionId: ActionId | null
  readonly personalTurnId: PersonalTurnId | null
  readonly sequenceId: TurnSequenceId | null
  readonly skillExecutionId: SkillExecutionId | null
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
  | 'STATUS_REMOVED'

export interface StatusChangedEvent {
  readonly type: StatusChangeKind
  readonly ownerUnitId: UnitId
  readonly statusId: StatusId
  readonly category: StatusCategory
  readonly batchId: StatusBatchId
  readonly previousBatchId: StatusBatchId | null
  readonly stacks: number
  readonly remainingOwnerTurns: number | null
  readonly sourceUnitId: UnitId | null
  readonly skillExecutionId: SkillExecutionId | null
  readonly effectId: string | null
}

export type BattleEvent =
  | SequenceStartedEvent
  | SequenceCompletedEvent
  | BattleCannotContinueEvent
  | TrainingPausedEvent
  | TrainingFinishedEvent
  | TrainingExitConfirmedEvent
  | UnitSkippedDeadEvent
  | BattlefieldUnitEvent
  | UnitReplacedEvent
  | BattleFinishedEvent
  | ForcedChoiceEvent
  | PassiveTriggeredEvent
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
  | ResourceChangedEvent
  | ResourceSetEvent
  | ResourceReductionPreventedEvent
  | SpecialCounterChangedEvent
  | MomentumPressureRecalculatedEvent
  | MomentumPressureClearedEvent
  | MomentumPressureTriggeredEvent
  | ShieldGainedEvent
  | HealthRestoredEvent
  | TemporaryAttributeChangedEvent
  | StatusChangedEvent
