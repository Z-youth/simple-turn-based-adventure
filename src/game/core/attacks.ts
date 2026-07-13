import type { DamageType } from './enums'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  PersonalTurnId,
  SkillBranchId,
  SkillExecutionId,
  SkillId,
  SpecialCounterId,
  TriggerLockId,
  TurnSequenceId,
  UnitId,
} from './identifiers'
import type { ResourceType } from './resources'
import type { StatusBatch } from './statuses'
import type { ModifierSourceId } from './units'
import type {
  TemporaryAttribute,
  TemporaryModifierDurationRequest,
} from './temporaryModifiers'

export interface ExtraDamageRequest {
  readonly damageEventId: DamageEventId
  readonly value: number
  readonly triggerLockId?: TriggerLockId
}

export interface AttackTargetRequest {
  readonly targetId: UnitId
  readonly damageEventId: DamageEventId
  readonly hit?: boolean
  readonly additionalReductionSources?: readonly number[]
  readonly extraDamage?: ExtraDamageRequest
}

interface AttackRequestBase {
  readonly attackId: AttackId
  readonly targets: readonly AttackTargetRequest[]
}

export interface NormalAttackRequest extends AttackRequestBase {
  readonly damageType: 'normal'
  readonly effectiveAttack: number
  readonly multiplier: number
  readonly fixedDamage: number
  readonly criticalRate: number
  readonly criticalDamage: number
  readonly normalDamageIncrease: number
}

export interface ShieldValueAttackRequest extends AttackRequestBase {
  readonly damageType: 'shieldValue'
  readonly baseValue: number
  readonly normalDamageIncrease: number
}

export type AttackRequest = NormalAttackRequest | ShieldValueAttackRequest

export interface SkillResourceEffectRequest {
  readonly kind: 'resource'
  readonly operation: 'gain' | 'spend'
  readonly unitId: UnitId
  readonly resourceType: ResourceType
  readonly amount: number
  readonly reason: string
  readonly sourceId?: string | null
}

export interface SkillStatusAddEffectRequest {
  readonly kind: 'status'
  readonly operation: 'add'
  readonly status: StatusBatch
}

export interface SkillStatusRemoveEffectRequest {
  readonly kind: 'status'
  readonly operation: 'remove'
  readonly ownerUnitId: UnitId
  readonly mode: 'cleanse' | 'dispel'
}

export interface SkillTemporaryAttributeEffectRequest {
  readonly kind: 'temporaryAttribute'
  readonly attribute: TemporaryAttribute
  readonly unitId: UnitId
  readonly sourceId: ModifierSourceId
  readonly value: number
  readonly duration: TemporaryModifierDurationRequest
}

export interface SkillSpecialCounterEffectRequest {
  readonly kind: 'specialCounter'
  readonly operation: 'increase' | 'decrease'
  readonly unitId: UnitId
  readonly counterId: SpecialCounterId
  readonly amount: number
}

export interface SkillAttackEffectRequest {
  readonly kind: 'attack'
  readonly attack: AttackRequest
}

export type SkillEffectRequest =
  | SkillResourceEffectRequest
  | SkillStatusAddEffectRequest
  | SkillStatusRemoveEffectRequest
  | SkillSpecialCounterEffectRequest
  | SkillTemporaryAttributeEffectRequest
  | SkillAttackEffectRequest

export interface SkillResolutionRequest {
  readonly skillExecutionId: SkillExecutionId
  readonly skillId: SkillId
  readonly branchId?: SkillBranchId | null
  readonly actionId: ActionId
  readonly personalTurnId: PersonalTurnId
  readonly sequenceId: TurnSequenceId
  readonly casterId: UnitId
  readonly attacks: readonly AttackRequest[]
  readonly effects?: readonly SkillEffectRequest[]
}

export type TriggeredSkillResolutionRequest = Omit<
  SkillResolutionRequest,
  'actionId'
> & {
  readonly actionId: ActionId | null
}

export function isSupportedAttackDamageType(
  damageType: DamageType,
): damageType is AttackRequest['damageType'] {
  return damageType === 'normal' || damageType === 'shieldValue'
}
