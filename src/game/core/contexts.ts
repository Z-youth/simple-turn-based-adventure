import type {
  BattleLogEventType,
  BattlePhase,
  ActionLifecycleStage,
  DamageType,
  PersonalTurnPhase,
} from './enums'
import type { BattleEvent } from './events'
import type {
  ActionId,
  AttackId,
  BattleLogEventId,
  DamageEventId,
  SkillBranchId,
  SkillExecutionId,
  SkillId,
  PersonalTurnId,
  TurnSequenceId,
  TriggerLockId,
  UnitId,
  ResourceTransactionId,
} from './identifiers'
import type { StatusBatch } from './statuses'
import type { UnitState } from './units'
import type { RandomState } from './rng'
import type { ResourceConfiguration } from './resources'
import type { ResourceCost } from './resources'
import type { DelayedEffect } from './effectScheduler'

export interface TurnQueueEntry {
  readonly unitId: UnitId
  readonly speedAtSequenceStart: number
  readonly kind?: 'sequence' | 'immediate'
}

export interface OffFieldUnitState {
  readonly unit: UnitState
  readonly statusBatches: readonly StatusBatch[]
}

export interface TurnSequenceState {
  readonly sequenceId: TurnSequenceId
  readonly sequenceNumber: number
  readonly queue: readonly TurnQueueEntry[]
  readonly currentIndex: number
  readonly completed: boolean
}

export interface PersonalTurnState {
  readonly personalTurnId: PersonalTurnId
  readonly sequenceId: TurnSequenceId
  readonly unitId: UnitId
  readonly sequenceNumber: number
  readonly phase: PersonalTurnPhase
  readonly unitPassiveEffectsApplied: boolean
  readonly startedActionIds: readonly ActionId[]
  readonly completedActionIds: readonly ActionId[]
  readonly countedActionCount: number
}

export interface ActionContext {
  readonly actionId: ActionId
  readonly actorId: UnitId
  readonly personalTurnId: PersonalTurnId
  readonly sequenceId: TurnSequenceId
  readonly skillExecutionId: SkillExecutionId | null
  readonly countsAsAction: boolean
  readonly endsTurn: boolean
  readonly stage: ActionLifecycleStage
}

export interface ResourcePaymentCompletion {
  readonly resourceTransactionId: ResourceTransactionId
  readonly skillExecutionId: SkillExecutionId
  readonly actionId: ActionId
  readonly personalTurnId: PersonalTurnId
  readonly sequenceId: TurnSequenceId
  readonly payerUnitId: UnitId
  readonly reservedCosts: readonly ResourceCost[]
}

export interface ResourcePaymentRegistry {
  readonly resourceTransactionIds: readonly ResourceTransactionId[]
  readonly paidSkillExecutionIds: readonly SkillExecutionId[]
}

export interface SkillResolutionCompletion {
  readonly skillExecutionId: SkillExecutionId
  readonly actionId: ActionId
  readonly personalTurnId: PersonalTurnId
  readonly sequenceId: TurnSequenceId
}

export interface ResolutionIdRegistry {
  readonly skillExecutionIds: readonly SkillExecutionId[]
  readonly attackIds: readonly AttackId[]
  readonly damageEventIds: readonly DamageEventId[]
}

export interface PerTargetTriggerLock {
  readonly lockId: TriggerLockId
  readonly triggeredTargetIds: readonly UnitId[]
}

export interface SkillContext {
  readonly skillExecutionId: SkillExecutionId
  readonly actionId: ActionId | null
  readonly casterId: UnitId
  readonly skillId: SkillId
  readonly branchId: SkillBranchId | null
  readonly targetIds: readonly UnitId[]
  readonly perTargetTriggerLocks: readonly PerTargetTriggerLock[]
  readonly globalTriggerLocks: readonly TriggerLockId[]
}

export interface AttackContext {
  readonly attackId: AttackId
  readonly skillExecutionId: SkillExecutionId
  readonly attackerId: UnitId
  readonly attackIndex: number
  readonly damageType: DamageType
  readonly targetIds: readonly UnitId[]
  readonly targets: readonly AttackTargetContext[]
  readonly protectionSnapshot: readonly PositionProtectionSnapshotEntry[]
  readonly momentumPressureSnapshot: number
}

export interface AttackTargetContext {
  readonly targetId: UnitId
  readonly damageEventId: DamageEventId
  readonly hit: boolean
  readonly lockedAtSkillStart: boolean
}

export interface PositionProtectionSnapshotEntry {
  readonly targetId: UnitId
  readonly protectedByUnitId: UnitId | null
  readonly reduction: number
}

export interface DamageEvent {
  readonly eventId: DamageEventId
  readonly attackId: AttackId | null
  readonly skillExecutionId: SkillExecutionId
  readonly sourceUnitId: UnitId
  readonly targetUnitId: UnitId
  readonly damageType: DamageType
  readonly rawValue: number
  readonly resolvedValue: number
  readonly critical: boolean
  readonly shieldAbsorbed: number
  readonly healthLost: number
  readonly remainingShield: number
  readonly remainingHealth: number
  readonly causedDeath: boolean
  readonly targetWasAlreadyDead: boolean
  readonly extraDamageSource: 'generic' | 'momentumPressure' | null
}

export interface BattleLogEvent {
  readonly eventId: BattleLogEventId
  readonly order: number
  readonly type: BattleLogEventType
  readonly message: string
  readonly unitIds: readonly UnitId[]
  readonly skillExecutionId: SkillExecutionId | null
}

export interface TrainingSessionState {
  readonly initialState: BattleState
}

export interface BattleState {
  readonly phase: BattlePhase
  readonly units: readonly UnitState[]
  readonly offFieldUnits?: readonly OffFieldUnitState[]
  readonly nextDeploymentOrder?: number
  readonly statusBatches: readonly StatusBatch[]
  readonly statusAcquisitionOrders: readonly number[]
  readonly turnSequence: TurnSequenceState | null
  readonly personalTurn: PersonalTurnState | null
  readonly activeAction: ActionContext | null
  readonly activeSkill: SkillContext | null
  readonly completedSkillResolution: SkillResolutionCompletion | null
  readonly completedResourcePayment: ResourcePaymentCompletion | null
  readonly resourcePaymentRegistry: ResourcePaymentRegistry
  readonly resolutionIds: ResolutionIdRegistry
  readonly resourceConfiguration: ResourceConfiguration
  readonly actionRollbackState: BattleState | null
  readonly rngState: RandomState
  readonly log: readonly BattleLogEvent[]
  readonly events: readonly BattleEvent[]
  readonly outcome?: 'playerVictory' | 'playerDefeat' | null
  readonly pendingEffects?: readonly DelayedEffect[]
  readonly pendingForcedChoice?: {
    readonly choiceId: string
    readonly unitId: UnitId
    readonly kind: string
  } | null
  readonly trainingSession?: TrainingSessionState | null
}
