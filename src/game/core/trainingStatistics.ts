import { Camp } from './enums'
import type { BattleState } from './contexts'
import type { UnitId } from './identifiers'

export interface TrainingSequenceStatistics {
  readonly sequenceNumber: number
  readonly totalDamage: number
}

export interface TrainingUnitStatistics {
  readonly unitId: UnitId
  readonly unitName: string
  readonly totalDamageDealt: number
  readonly totalDamageTaken: number
  readonly totalShieldGranted: number
  readonly totalHealing: number
}

export interface TrainingStatistics {
  readonly sequenceCount: number
  readonly sequences: readonly TrainingSequenceStatistics[]
  readonly units: readonly TrainingUnitStatistics[]
}

interface MutableUnitStatistics extends TrainingUnitStatistics {
  totalDamageDealt: number
  totalDamageTaken: number
  totalShieldGranted: number
  totalHealing: number
}

function getPlayerUnits(state: BattleState) {
  const initialUnits = state.trainingSession?.initialState.units ?? state.units
  return initialUnits.filter((unit) => unit.camp === Camp.Player)
}

function addDamage(
  units: Map<UnitId, MutableUnitStatistics>,
  sourceUnitId: UnitId,
  targetUnitId: UnitId,
  amount: number,
): void {
  const source = units.get(sourceUnitId)
  if (source !== undefined) source.totalDamageDealt += amount
  const target = units.get(targetUnitId)
  if (target !== undefined) target.totalDamageTaken += amount
}

export function calculateTrainingStatistics(state: BattleState): TrainingStatistics {
  const units = new Map<UnitId, MutableUnitStatistics>(getPlayerUnits(state).map((unit) => [
    unit.id,
    {
      unitId: unit.id,
      unitName: unit.name,
      totalDamageDealt: 0,
      totalDamageTaken: 0,
      totalShieldGranted: 0,
      totalHealing: 0,
    },
  ]))
  const sequenceDamage = new Map<number, number>()
  const skillOwners = new Map<string, UnitId>()
  let currentSequenceNumber: number | null = null

  for (const event of state.events) {
    if (event.type === 'SEQUENCE_STARTED') {
      currentSequenceNumber = event.sequenceNumber
      if (!sequenceDamage.has(event.sequenceNumber)) {
        sequenceDamage.set(event.sequenceNumber, 0)
      }
      continue
    }
    if (event.type === 'SKILL_RESOLUTION_STARTED') {
      skillOwners.set(String(event.skillExecutionId), event.casterId)
      continue
    }
    if (event.type === 'DAMAGE_CALCULATED' || event.type === 'EXTRA_DAMAGE_APPLIED') {
      const amount = event.damage.resolvedValue
      if (currentSequenceNumber !== null) {
        sequenceDamage.set(
          currentSequenceNumber,
          (sequenceDamage.get(currentSequenceNumber) ?? 0) + amount,
        )
      }
      addDamage(
        units,
        event.damage.sourceUnitId,
        event.damage.targetUnitId,
        amount,
      )
      continue
    }
    if (event.type === 'SHIELD_GAINED') {
      const sourceUnitId = event.skillExecutionId === null
        ? event.unitId
        : skillOwners.get(String(event.skillExecutionId)) ?? event.unitId
      const source = units.get(sourceUnitId)
      if (source !== undefined) source.totalShieldGranted += event.amount
      continue
    }
    if (event.type === 'HEALTH_RESTORED') {
      const sourceUnitId = event.skillExecutionId === null
        ? event.unitId
        : skillOwners.get(String(event.skillExecutionId)) ?? event.unitId
      const source = units.get(sourceUnitId)
      if (source !== undefined) source.totalHealing += event.amount
    }
  }

  const sequences = [...sequenceDamage.entries()]
    .sort(([left], [right]) => left - right)
    .map(([sequenceNumber, totalDamage]) => ({ sequenceNumber, totalDamage }))
  return {
    sequenceCount: sequences.length,
    sequences,
    units: [...units.values()],
  }
}
