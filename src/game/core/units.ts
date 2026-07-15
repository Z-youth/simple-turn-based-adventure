import type { Camp, Position, UnitSystem } from './enums'
import type { SkillId, StatusId, UnitId } from './identifiers'
import type {
  ResourceReductionProtection,
  SpecialCounter,
} from './specialCounters'
import type { TemporaryAttributeModifier } from './temporaryModifiers'

export type ModifierSourceId = SkillId | StatusId | UnitId

export interface NormalDamageModifierSource {
  readonly sourceId: string
  readonly modifier: number
}

export interface NormalDamageReductionSource {
  readonly sourceId: ModifierSourceId
  readonly reduction: number
}

export interface MomentumReadRule {
  readonly maximumActualMomentum: number | null
  readonly attackLayersPerMomentum: number
  readonly effectLayersPerMomentum: number
  readonly pressureLayersPerMomentum: number
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
  readonly temporaryAttributeModifiers: readonly TemporaryAttributeModifier[]
  readonly speed: number
  readonly shield: number
  readonly criticalRate: number
  readonly criticalDamage: number
  readonly normalDamageIncrease: number
  readonly normalDamageIncreaseSources?: readonly NormalDamageModifierSource[]
  readonly normalDamageReductionSources: readonly NormalDamageReductionSource[]
  readonly extraDamageIncrease: number
  readonly extraDamageReduction: number
  readonly energy: number
  readonly momentum: number
  readonly momentumReadRules?: readonly MomentumReadRule[]
  readonly intent: number
  readonly magic: number
  readonly momentumPressure: number
  readonly specialCounters: readonly SpecialCounter[]
  readonly resourceReductionProtections: readonly ResourceReductionProtection[]
  readonly alive: boolean
}
