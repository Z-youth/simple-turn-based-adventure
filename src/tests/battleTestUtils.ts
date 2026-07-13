import { BattlePhase, Camp, Position, UnitSystem } from '../game/core/enums'
import type { BattleState } from '../game/core/contexts'
import type { UnitId } from '../game/core/identifiers'
import type { UnitState } from '../game/core/units'
import { createSeededRandomState } from '../game/core/rng'

export function unitId(value: string): UnitId {
  return value as UnitId
}

export function createUnit(
  id: string,
  overrides: Partial<UnitState> = {},
): UnitState {
  return {
    id: unitId(id),
    name: id,
    camp: Camp.Player,
    system: UnitSystem.Momentum,
    isBoss: false,
    position: Position.Front1,
    deploymentOrder: 0,
    currentHealth: 100,
    maximumHealth: 100,
    hasInfiniteHealth: false,
    baseAttackAtBattleEntry: 10,
    attackModifiers: [],
    speed: 100,
    shield: 0,
    criticalRate: 0,
    criticalDamage: 0.5,
    normalDamageIncrease: 0,
    normalDamageReductionSources: [],
    extraDamageIncrease: 0,
    extraDamageReduction: 0,
    energy: 0,
    momentum: 0,
    intent: 0,
    magic: 0,
    momentumPressure: 0,
    alive: true,
    ...overrides,
  }
}

export function createBattleState(units: readonly UnitState[]): BattleState {
  return {
    phase: BattlePhase.Setup,
    units,
    statusBatches: [],
    statusAcquisitionOrders: [],
    turnSequence: null,
    personalTurn: null,
    activeAction: null,
    activeSkill: null,
    completedSkillResolution: null,
    resolutionIds: {
      skillExecutionIds: [],
      attackIds: [],
      damageEventIds: [],
    },
    rngState: createSeededRandomState(1),
    log: [],
    events: [],
  }
}
