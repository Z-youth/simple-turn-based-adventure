import type {
  BattleLogEventType,
  BattlePhase,
  DamageType,
} from './enums'
import type {
  ActionId,
  AttackId,
  BattleLogEventId,
  DamageEventId,
  SkillBranchId,
  SkillExecutionId,
  SkillId,
  TriggerLockId,
  UnitId,
} from './identifiers'
import type { StatusBatch } from './statuses'
import type { UnitState } from './units'

export interface TurnSequenceState {
  sequenceNumber: number
  orderedUnitIds: UnitId[]
  currentIndex: number
}

export interface PersonalTurnState {
  unitId: UnitId
  sequenceNumber: number
  actionIds: ActionId[]
  hasEnded: boolean
}

export interface ActionContext {
  actionId: ActionId
  actorId: UnitId
  skillExecutionId: SkillExecutionId | null
  countsAsAction: boolean
  endsPersonalTurn: boolean
}

export interface PerTargetTriggerLock {
  lockId: TriggerLockId
  triggeredTargetIds: UnitId[]
}

export interface SkillContext {
  skillExecutionId: SkillExecutionId
  actionId: ActionId | null
  casterId: UnitId
  skillId: SkillId
  branchId: SkillBranchId | null
  targetIds: UnitId[]
  perTargetTriggerLocks: PerTargetTriggerLock[]
  globalTriggerLocks: TriggerLockId[]
}

export interface AttackContext {
  attackId: AttackId
  skillExecutionId: SkillExecutionId
  attackerId: UnitId
  targetId: UnitId
  attackIndex: number
  hit: boolean
}

export interface DamageEvent {
  eventId: DamageEventId
  attackId: AttackId | null
  skillExecutionId: SkillExecutionId
  sourceUnitId: UnitId
  targetUnitId: UnitId
  damageType: DamageType
  rawValue: number
  resolvedValue: number
}

export interface BattleLogEvent {
  eventId: BattleLogEventId
  order: number
  type: BattleLogEventType
  message: string
  unitIds: UnitId[]
  skillExecutionId: SkillExecutionId | null
}

export interface BattleState {
  phase: BattlePhase
  units: UnitState[]
  statusBatches: StatusBatch[]
  turnSequence: TurnSequenceState
  personalTurn: PersonalTurnState | null
  activeAction: ActionContext | null
  activeSkill: SkillContext | null
  log: BattleLogEvent[]
}
