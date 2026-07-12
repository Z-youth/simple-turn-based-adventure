import type { Camp, Position, UnitSystem } from './enums'
import type { SkillId, StatusId, UnitId } from './identifiers'

export type ModifierSourceId = SkillId | StatusId | UnitId

export interface AttackModifier {
  sourceId: ModifierSourceId
  value: number
  expiresAtTurnEnd: boolean
}

export interface NormalDamageReductionSource {
  sourceId: ModifierSourceId
  reduction: number
}

export interface UnitState {
  id: UnitId
  name: string
  camp: Camp
  system: UnitSystem
  position: Position | null
  deploymentOrder: number
  currentHealth: number
  maximumHealth: number
  hasInfiniteHealth: boolean
  baseAttackAtBattleEntry: number
  attackModifiers: AttackModifier[]
  speed: number
  shield: number
  criticalRate: number
  criticalDamage: number
  normalDamageIncrease: number
  normalDamageReductionSources: NormalDamageReductionSource[]
  extraDamageIncrease: number
  extraDamageReduction: number
  energy: number
  momentum: number
  intent: number
  magic: number
  momentumPressure: number
  alive: boolean
}
