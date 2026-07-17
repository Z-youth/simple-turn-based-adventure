export const Camp = {
  Player: 'player',
  Enemy: 'enemy',
} as const

export type Camp = (typeof Camp)[keyof typeof Camp]

export const UnitSystem = {
  Momentum: '势',
  Intent: '意',
  Magic: '法',
} as const

export type UnitSystem = (typeof UnitSystem)[keyof typeof UnitSystem]

export const Position = {
  Front1: 'front1',
  Front2: 'front2',
  Back1: 'back1',
  Back2: 'back2',
} as const

export type Position = (typeof Position)[keyof typeof Position]

export const DamageType = {
  Normal: 'normal',
  Extra: 'extra',
  ShieldValue: 'shieldValue',
} as const

export type DamageType = (typeof DamageType)[keyof typeof DamageType]

export const BattlePhase = {
  Setup: 'setup',
  SequenceStart: 'sequenceStart',
  TurnStart: 'turnStart',
  AwaitingAction: 'awaitingAction',
  ResolvingAction: 'resolvingAction',
  TurnEnd: 'turnEnd',
  UnableToContinue: 'unableToContinue',
  Paused: 'paused',
  Finished: 'finished',
} as const

export type BattlePhase = (typeof BattlePhase)[keyof typeof BattlePhase]

export const PersonalTurnPhase = {
  NotStarted: 'notStarted',
  StartingAbsoluteEffects: 'startingAbsoluteEffects',
  StartingTurnCounterReset: 'startingTurnCounterReset',
  StartingDelayedEffects: 'startingDelayedEffects',
  StartingSystemRules: 'startingSystemRules',
  StartingUnitPassives: 'startingUnitPassives',
  StartingStatusEffects: 'startingStatusEffects',
  StartingForcedChoices: 'startingForcedChoices',
  AwaitingAction: 'awaitingAction',
  ResolvingAction: 'resolvingAction',
  Ending: 'ending',
  EndingTriggeredEffects: 'endingTriggeredEffects',
  EndingUnitSpecificEffects: 'endingUnitSpecificEffects',
  EndingStatusEffects: 'endingStatusEffects',
  EndingSpecialVariables: 'endingSpecialVariables',
  EndingStatusDurations: 'endingStatusDurations',
  EndingTemporaryModifiers: 'endingTemporaryModifiers',
  Ended: 'ended',
} as const

export type PersonalTurnPhase =
  (typeof PersonalTurnPhase)[keyof typeof PersonalTurnPhase]

export const TurnStartStage = {
  AbsoluteEffects: 'absoluteEffects',
  TurnCounterReset: 'turnCounterReset',
  DelayedEffects: 'delayedEffects',
  SystemRules: 'systemRules',
  UnitPassives: 'unitPassives',
  StatusEffects: 'statusEffects',
  ForcedChoices: 'forcedChoices',
} as const

export type TurnStartStage =
  (typeof TurnStartStage)[keyof typeof TurnStartStage]

export const TurnEndStage = {
  TriggeredEffects: 'triggeredEffects',
  UnitSpecificEffects: 'unitSpecificEffects',
  StatusEffects: 'statusEffects',
  SpecialVariables: 'specialVariables',
  StatusDurations: 'statusDurations',
  TemporaryModifiers: 'temporaryModifiers',
} as const

export type TurnEndStage =
  (typeof TurnEndStage)[keyof typeof TurnEndStage]

export const ActionLifecycleStage = {
  OnAction: 'onAction',
  ResourceValidationAndPayment: 'resourceValidationAndPayment',
  SkillResolution: 'skillResolution',
  AfterAction: 'afterAction',
} as const

export type ActionLifecycleStage =
  (typeof ActionLifecycleStage)[keyof typeof ActionLifecycleStage]

export const TargetType = {
  Self: 'self',
  SingleAlly: 'singleAlly',
  AllAllies: 'allAllies',
  SingleEnemy: 'singleEnemy',
  AllEnemies: 'allEnemies',
} as const

export type TargetType = (typeof TargetType)[keyof typeof TargetType]

export const StackPolicy = {
  Independent: 'independent',
  MergeEquivalent: 'mergeEquivalent',
  RefreshDuration: 'refreshDuration',
  Replace: 'replace',
  Unique: 'unique',
} as const

export type StackPolicy = (typeof StackPolicy)[keyof typeof StackPolicy]

export const StatusCategory = {
  Buff: 'buff',
  Debuff: 'debuff',
} as const

export type StatusCategory =
  (typeof StatusCategory)[keyof typeof StatusCategory]

export const StatusAcquisitionTiming = {
  TurnStart: 'turnStart',
  Action: 'action',
  TurnEnd: 'turnEnd',
  External: 'external',
} as const

export type StatusAcquisitionTiming =
  (typeof StatusAcquisitionTiming)[keyof typeof StatusAcquisitionTiming]

export const BattleLogEventType = {
  Phase: 'phase',
  Action: 'action',
  Skill: 'skill',
  Damage: 'damage',
  Resource: 'resource',
  Status: 'status',
  Defeat: 'defeat',
} as const

export type BattleLogEventType =
  (typeof BattleLogEventType)[keyof typeof BattleLogEventType]
