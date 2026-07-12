import type {
  StackPolicy,
  StatusAcquisitionTiming,
  StatusCategory,
} from './enums'
import type {
  StatusBatchId,
  StatusId,
  UnitId,
} from './identifiers'

export type StatusEffectValue =
  | { calculation: 'perStack'; value: number }
  | { calculation: 'total'; value: number }

export interface StatusBatch {
  batchId: StatusBatchId
  statusId: StatusId
  sourceUnitId: UnitId
  stacks: number
  effect: StatusEffectValue
  remainingOwnerTurns: number | null
  acquiredAt: StatusAcquisitionTiming
  skipNextTurnEndDecrement: boolean
  stackPolicy: StackPolicy
  category: StatusCategory
}

export function aggregateStatusStacks(
  batches: readonly StatusBatch[],
  statusId: StatusId,
): number {
  return batches.reduce(
    (total, batch) => total + (batch.statusId === statusId ? batch.stacks : 0),
    0,
  )
}
