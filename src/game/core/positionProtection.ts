import { Position } from './enums'
import type { PositionProtectionSnapshotEntry } from './contexts'
import type { UnitId } from './identifiers'
import type { UnitState } from './units'
import { isUnitAlive } from './unitQueries'

const POSITION_PROTECTION_REDUCTION = 0.5

function getProtectingPosition(
  position: UnitState['position'],
): UnitState['position'] {
  if (position === Position.Back1) return Position.Front1
  if (position === Position.Back2) return Position.Front2
  return null
}

export function createPositionProtectionSnapshot(
  units: readonly UnitState[],
  targetIds: readonly UnitId[],
): readonly PositionProtectionSnapshotEntry[] {
  return targetIds.map((targetId) => {
    const target = units.find((unit) => unit.id === targetId)
    const protectingPosition = target === undefined
      ? null
      : getProtectingPosition(target.position)
    const protector = protectingPosition === null || target === undefined
      ? undefined
      : units.find((unit) => (
        unit.camp === target.camp
        && unit.position === protectingPosition
        && isUnitAlive(unit)
      ))

    return {
      targetId,
      protectedByUnitId: protector?.id ?? null,
      reduction: protector === undefined ? 0 : POSITION_PROTECTION_REDUCTION,
    }
  })
}

export function getPositionProtectionReduction(
  snapshot: readonly PositionProtectionSnapshotEntry[],
  targetId: UnitId,
): number {
  return snapshot.find((entry) => entry.targetId === targetId)?.reduction ?? 0
}
