import type { DamageType } from './enums'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  PersonalTurnId,
  SkillExecutionId,
  SkillId,
  TriggerLockId,
  TurnSequenceId,
  UnitId,
} from './identifiers'

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

export interface SkillResolutionRequest {
  readonly skillExecutionId: SkillExecutionId
  readonly skillId: SkillId
  readonly actionId: ActionId
  readonly personalTurnId: PersonalTurnId
  readonly sequenceId: TurnSequenceId
  readonly casterId: UnitId
  readonly attacks: readonly AttackRequest[]
}

export function isSupportedAttackDamageType(
  damageType: DamageType,
): damageType is AttackRequest['damageType'] {
  return damageType === 'normal' || damageType === 'shieldValue'
}
