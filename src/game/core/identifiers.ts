type Brand<Value, Name extends string> = Value & { readonly __brand: Name }

export type UnitId = Brand<string, 'UnitId'>
export type SkillId = Brand<string, 'SkillId'>
export type SkillBranchId = Brand<string, 'SkillBranchId'>
export type StatusId = Brand<string, 'StatusId'>
export type StatusBatchId = Brand<string, 'StatusBatchId'>
export type SkillExecutionId = Brand<string, 'SkillExecutionId'>
export type ActionId = Brand<string, 'ActionId'>
export type AttackId = Brand<string, 'AttackId'>
export type DamageEventId = Brand<string, 'DamageEventId'>
export type BattleLogEventId = Brand<string, 'BattleLogEventId'>
export type TriggerLockId = Brand<string, 'TriggerLockId'>
export type TurnSequenceId = Brand<string, 'TurnSequenceId'>
export type PersonalTurnId = Brand<string, 'PersonalTurnId'>
export type ResourceTransactionId = Brand<string, 'ResourceTransactionId'>
export type SpecialCounterId = Brand<string, 'SpecialCounterId'>
