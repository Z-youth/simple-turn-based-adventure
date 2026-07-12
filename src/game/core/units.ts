import type { Camp, Position, UnitSystem } from './enums'
import type { SkillId, StatusId, UnitId } from './identifiers'

export type ModifierSourceId = SkillId | StatusId | UnitId

export interface AttackModifier {
  readonly sourceId: ModifierSourceId
  readonly value: number
  readonly expiresAtTurnEnd: boolean
}

export interface NormalDamageReductionSource {
  readonly sourceId: ModifierSourceId
  readonly reduction: number
}

export interface UnitState {
  readonly id: UnitId
  readonly name: string
  readonly camp: Camp
  readonly system: UnitSystem
  readonly isBoss: boolean
  readonly position: Position | null
  readonly deploymentOrder: number
  readonly currentHealth: number
  readonly maximumHealth: number
  readonly hasInfiniteHealth: boolean
  readonly baseAttackAtBattleEntry: number
  readonly attackModifiers: readonly AttackModifier[]
  readonly speed: number
  readonly shield: number
  readonly criticalRate: number
  readonly criticalDamage: number
  readonly normalDamageIncrease: number
  readonly normalDamageReductionSources: readonly NormalDamageReductionSource[]
  readonly extraDamageIncrease: number
  readonly extraDamageReduction: number
  readonly energy: number
  readonly momentum: number
  readonly intent: number
  readonly magic: number
  readonly momentumPressure: number
  readonly alive: boolean
}
