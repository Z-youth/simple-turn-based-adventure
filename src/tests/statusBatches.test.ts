import { describe, expect, it } from 'vitest'
import {
  StackPolicy,
  StatusAcquisitionTiming,
  StatusCategory,
} from '../game/core/enums'
import type { StatusCategory as StatusCategoryType } from '../game/core/enums'
import type {
  StatusBatchId,
  StatusId,
  UnitId,
} from '../game/core/identifiers'
import {
  aggregateStatusStacks,
  type StatusBatch,
} from '../game/core/statuses'

const statusId = 'attack-up' as StatusId
const sourceUnitId = 'source' as UnitId

function createBatch(
  batchId: string,
  stacks: number,
  category: StatusCategoryType = StatusCategory.Buff,
): StatusBatch {
  return {
    batchId: batchId as StatusBatchId,
    statusId,
    sourceUnitId,
    stacks,
    effect: { calculation: 'perStack', value: 2 },
    remainingOwnerTurns: 2,
    acquiredAt: StatusAcquisitionTiming.Action,
    skipNextTurnEndDecrement: false,
    stackPolicy: StackPolicy.Independent,
    category,
  }
}

describe('status batches', () => {
  it('keeps two batches of the same status independent', () => {
    const batches = [createBatch('first', 2), createBatch('second', 3)]

    expect(batches).toHaveLength(2)
    expect(batches[0].batchId).not.toBe(batches[1].batchId)
    expect(batches[0].stacks).toBe(2)
    expect(batches[1].stacks).toBe(3)
  })

  it('aggregates stacks without replacing batches', () => {
    const batches = [createBatch('first', 2), createBatch('second', 3)]

    expect(aggregateStatusStacks(batches, statusId)).toBe(5)
    expect(batches).toHaveLength(2)
  })

  it('distinguishes buffs from debuffs in batch data', () => {
    const buff = createBatch('buff', 1, StatusCategory.Buff)
    const debuff = createBatch('debuff', 1, StatusCategory.Debuff)

    expect(buff.category).toBe('buff')
    expect(debuff.category).toBe('debuff')
  })
})
