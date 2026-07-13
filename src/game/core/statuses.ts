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
  | { readonly calculation: 'perStack'; readonly value: number }
  | { readonly calculation: 'total'; readonly value: number }

export interface StatusBatch {
  readonly batchId: StatusBatchId
  readonly statusId: StatusId
  readonly ownerUnitId: UnitId
  readonly sourceUnitId: UnitId
  readonly stacks: number
  readonly effect: StatusEffectValue
  readonly remainingOwnerTurns: number | null
  readonly acquiredAt: StatusAcquisitionTiming
  readonly acquisitionGroupId: string
  readonly acquisitionOrder: number
  readonly skipNextTurnEndDecrement: boolean
  readonly stackPolicy: StackPolicy
  readonly category: StatusCategory
  readonly canBeCleansed: boolean
  readonly canBeDispelled: boolean
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
