import { Camp } from './enums'
import type { TurnQueueEntry } from './contexts'
import type { UnitState } from './units'
import { validateBattleRuntimeUnits } from './combatValidation'
import { getPositionOrderWeight, isUnitAlive } from './unitQueries'

export interface TurnQueueCreationSuccess {
  readonly ok: true
  readonly queue: readonly TurnQueueEntry[]
}

export interface TurnQueueCreationFailure {
  readonly ok: false
  readonly queue: readonly []
  readonly reason: 'INVALID_UNIT_BASE_ATTACK'
}

export type TurnQueueCreationResult =
  | TurnQueueCreationSuccess
  | TurnQueueCreationFailure

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareUnitIds(left: UnitState, right: UnitState): number {
  const leftId = String(left.id)
  const rightId = String(right.id)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function getCampPriority(unit: UnitState): number {
  return unit.camp === Camp.Player ? 0 : 1
}

export function compareUnitsForTurnOrder(
  left: UnitState,
  right: UnitState,
): number {
  const speedComparison = compareNumbers(right.speed, left.speed)
  if (speedComparison !== 0) return speedComparison

  const campComparison = compareNumbers(
    getCampPriority(left),
    getCampPriority(right),
  )
  if (campComparison !== 0) return campComparison

  if (left.camp === Camp.Player && right.camp === Camp.Player) {
    const positionComparison = compareNumbers(
      getPositionOrderWeight(left.position),
      getPositionOrderWeight(right.position),
    )
    if (positionComparison !== 0) return positionComparison
  }

  const deploymentComparison = compareNumbers(
    left.deploymentOrder,
    right.deploymentOrder,
  )
  if (deploymentComparison !== 0) return deploymentComparison

  return compareUnitIds(left, right)
}

export function isEligibleForTurnQueue(unit: UnitState): boolean {
  if (!isUnitAlive(unit)) return false
  return unit.camp === Camp.Enemy || unit.position !== null
}

export function createTurnQueue(
  units: readonly UnitState[],
): TurnQueueCreationResult {
  const invalidUnits = validateBattleRuntimeUnits(units)
  if (invalidUnits !== null) {
    return { ok: false, queue: [], reason: invalidUnits }
  }
  const queue = units
    .filter(isEligibleForTurnQueue)
    .slice()
    .sort(compareUnitsForTurnOrder)
    .map((unit) => ({
      unitId: unit.id,
      speedAtSequenceStart: unit.speed,
    }))
  return { ok: true, queue }
}
