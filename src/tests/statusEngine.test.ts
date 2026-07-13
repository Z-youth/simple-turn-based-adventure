import { describe, expect, it } from 'vitest'
import {
  StackPolicy,
  StatusAcquisitionTiming,
  StatusCategory,
} from '../game/core/enums'
import type { StackPolicy as StackPolicyType } from '../game/core/enums'
import type { StatusBatch } from '../game/core/statuses'
import {
  addStatusToBattle,
  advanceBattleStatusDurations,
  removeBattleStatus,
} from '../game/core/statusEngine'
import type {
  RemoveStatusInput,
  StatusOperationResult,
} from '../game/core/statusEngine'
import { ids } from './combatTestUtils'
import { createBattleState, createUnit, unitId } from './battleTestUtils'

function batch(
  name: string,
  overrides: Partial<StatusBatch> = {},
): StatusBatch {
  return {
    batchId: ids.batch(`batch:${name}`),
    statusId: ids.status('status:test'),
    ownerUnitId: unitId('owner'),
    sourceUnitId: unitId('source'),
    stacks: 1,
    effect: { calculation: 'perStack', value: 2 },
    remainingOwnerTurns: 2,
    acquiredAt: StatusAcquisitionTiming.Action,
    acquisitionGroupId: `group:${name}`,
    acquisitionOrder: 1,
    skipNextTurnEndDecrement: false,
    stackPolicy: StackPolicy.Independent,
    category: StatusCategory.Buff,
    canBeCleansed: false,
    canBeDispelled: true,
    ...overrides,
  }
}

function stateWithBatches(batches: readonly StatusBatch[]) {
  return {
    ...createBattleState([createUnit('owner'), createUnit('other')]),
    statusBatches: batches,
    statusAcquisitionOrders: batches.map((item) => item.acquisitionOrder),
  }
}

function addStatusBatch(
  batches: readonly StatusBatch[],
  incoming: StatusBatch,
): StatusOperationResult {
  const result = addStatusToBattle(stateWithBatches(batches), incoming)
  if (!result.ok) {
    return { ok: false, batches, events: [], reason: result.reason }
  }
  return {
    ok: true,
    batches: result.state.statusBatches,
    events: result.events,
    changed: result.changed,
  }
}

function decrementStatusDurations(
  batches: readonly StatusBatch[],
  ownerUnitId: ReturnType<typeof unitId>,
): StatusOperationResult {
  const result = advanceBattleStatusDurations(
    stateWithBatches(batches),
    ownerUnitId,
  )
  if (!result.ok) {
    return { ok: false, batches, events: [], reason: result.reason }
  }
  return {
    ok: true,
    batches: result.state.statusBatches,
    events: result.events,
    changed: result.changed,
  }
}

function removeOneStatusLayer(
  batches: readonly StatusBatch[],
  input: RemoveStatusInput,
): StatusOperationResult {
  const result = removeBattleStatus(stateWithBatches(batches), input)
  if (!result.ok) {
    return { ok: false, batches, events: [], reason: result.reason }
  }
  return {
    ok: true,
    batches: result.state.statusBatches,
    events: result.events,
    changed: result.changed,
  }
}

describe('stackable status batches', () => {
  it.each([
    [StatusCategory.Buff],
    [StatusCategory.Debuff],
  ])('keeps independently acquired %s batches separate', (category) => {
    const first = batch('first', { category, acquisitionOrder: 1 })
    const second = batch('second', { category, acquisitionOrder: 2 })
    const result = addStatusBatch([first], second)

    expect(result.ok).toBe(true)
    expect(result.batches).toEqual([first, second])
  })

  it('merges only fully equivalent batches from the same acquisition group', () => {
    const first = batch('first', {
      stacks: 2,
      stackPolicy: StackPolicy.MergeEquivalent,
      acquisitionGroupId: 'same',
    })
    const incoming = batch('incoming', {
      stacks: 3,
      stackPolicy: StackPolicy.MergeEquivalent,
      acquisitionGroupId: 'same',
    })
    const result = addStatusBatch([first], incoming)

    expect(result.ok).toBe(true)
    expect(result.batches).toHaveLength(1)
    expect(result.batches[0].stacks).toBe(5)
    expect(result.events[0].type).toBe('STATUS_BATCH_MERGED')
  })

  const mergeDifferences: readonly Partial<StatusBatch>[] = [
    { effect: { calculation: 'perStack', value: 3 } },
    { remainingOwnerTurns: 3 },
    { acquisitionGroupId: 'different' },
    { canBeDispelled: false },
  ]

  it.each(mergeDifferences)(
    'does not merge batches with different key metadata: %o',
    (difference) => {
      const first = batch('first', {
        stackPolicy: StackPolicy.MergeEquivalent,
        acquisitionGroupId: 'same',
      })
      const incoming = batch('incoming', {
        stackPolicy: StackPolicy.MergeEquivalent,
        acquisitionGroupId: 'same',
        acquisitionOrder: 2,
        ...difference,
      })
      const result = addStatusBatch([first], incoming)

      expect(result.batches).toHaveLength(2)
    },
  )
})

describe('non-stackable policies', () => {
  it('refreshes duration while retaining identity, effect, metadata, and one stack', () => {
    const existing = batch('existing', {
      stackPolicy: StackPolicy.RefreshDuration,
      effect: { calculation: 'total', value: 10 },
      remainingOwnerTurns: 1,
    })
    const incoming = batch('incoming', {
      stackPolicy: StackPolicy.RefreshDuration,
      effect: { calculation: 'total', value: 99 },
      remainingOwnerTurns: 4,
    })
    const result = addStatusBatch([existing], incoming)

    expect(result.batches[0]).toEqual({
      ...existing,
      remainingOwnerTurns: 4,
    })
    expect(result.events[0].type).toBe('STATUS_DURATION_REFRESHED')
  })

  it('replaces the complete previous batch with new metadata and order', () => {
    const existing = batch('existing', {
      stackPolicy: StackPolicy.Replace,
      acquisitionOrder: 1,
    })
    const incoming = batch('incoming', {
      stackPolicy: StackPolicy.Replace,
      acquisitionOrder: 9,
      effect: { calculation: 'total', value: 50 },
      canBeDispelled: false,
    })
    const result = addStatusBatch([existing], incoming)

    expect(result.batches).toEqual([incoming])
    expect(result.events[0].type).toBe('STATUS_BATCH_REPLACED')
  })

  it('rejects a duplicate unique status without changing batches', () => {
    const existing = batch('existing', { stackPolicy: StackPolicy.Unique })
    const incoming = batch('incoming', { stackPolicy: StackPolicy.Unique })
    const original: readonly StatusBatch[] = [existing]
    const result = addStatusBatch(original, incoming)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(false)
    expect(result.batches).toBe(original)
    expect(result.batches).toEqual([existing])
    expect(result.events[0].type).toBe('STATUS_REJECTED')
  })

  it.each<[
    StackPolicyType,
  ]>([
    [StackPolicy.RefreshDuration],
    [StackPolicy.Replace],
    [StackPolicy.Unique],
  ])('%s does not increase stack count on duplicate acquisition', (stackPolicy) => {
    const result = addStatusBatch([
      batch('existing', { stackPolicy }),
    ], batch('incoming', { stackPolicy, stacks: 5 }))

    expect(result.batches.reduce((sum, item) => sum + item.stacks, 0)).toBe(1)
  })
})

describe('status duration', () => {
  it('decrements only the owner batches and removes them at zero', () => {
    const owner = batch('owner', { remainingOwnerTurns: 1 })
    const other = batch('other', {
      ownerUnitId: unitId('other'),
      remainingOwnerTurns: 1,
      acquisitionOrder: 2,
    })
    const result = decrementStatusDurations([other, owner], unitId('owner'))

    expect(result.batches).toEqual([other])
    expect(result.events.map((event) => event.type)).toEqual([
      'STATUS_DURATION_DECREMENTED',
      'STATUS_BATCH_REMOVED',
    ])
  })

  it('turns a two-turn action status into one turn on the current turn end', () => {
    const result = decrementStatusDurations([
      batch('two-turns', { remainingOwnerTurns: 2 }),
    ], unitId('owner'))

    expect(result.batches[0].remainingOwnerTurns).toBe(1)
  })

  it('skips the first decrement for a batch acquired during turn end', () => {
    const original = batch('turn-end', {
      acquiredAt: StatusAcquisitionTiming.TurnEnd,
      skipNextTurnEndDecrement: true,
    })
    const first = decrementStatusDurations([original], unitId('owner'))
    const second = decrementStatusDurations(first.batches, unitId('owner'))

    expect(first.batches[0].remainingOwnerTurns).toBe(2)
    expect(first.batches[0].skipNextTurnEndDecrement).toBe(false)
    expect(second.batches[0].remainingOwnerTurns).toBe(1)
  })

  it('keeps independent batches on independent timers', () => {
    const first = decrementStatusDurations([
      batch('first', { remainingOwnerTurns: 1 }),
      batch('second', { remainingOwnerTurns: 3, acquisitionOrder: 2 }),
    ], unitId('owner'))

    expect(first.batches).toHaveLength(1)
    expect(first.batches[0].remainingOwnerTurns).toBe(2)
  })
})

describe('cleanse and dispel', () => {
  it('cleanses only the earliest removable debuff by explicit acquisition order', () => {
    const laterInArray = batch('later-in-array', {
      category: StatusCategory.Debuff,
      canBeCleansed: true,
      canBeDispelled: false,
      acquisitionOrder: 9,
      stacks: 2,
    })
    const earlierInOrder = batch('earlier-in-order', {
      category: StatusCategory.Debuff,
      canBeCleansed: true,
      canBeDispelled: false,
      acquisitionOrder: 1,
      stacks: 2,
    })
    const buff = batch('buff', { acquisitionOrder: 0 })
    const result = removeOneStatusLayer(
      [laterInArray, buff, earlierInOrder],
      { ownerUnitId: unitId('owner'), mode: 'cleanse' },
    )

    expect(result.batches.find(
      (item) => item.batchId === earlierInOrder.batchId,
    )?.stacks).toBe(1)
    expect(result.batches).toContain(buff)
    expect(result.events[0].type).toBe('STATUS_CLEANSED')
  })

  it('dispels only buffs and never removes a debuff', () => {
    const buff = batch('buff', { stacks: 1 })
    const debuff = batch('debuff', {
      category: StatusCategory.Debuff,
      canBeCleansed: true,
      canBeDispelled: false,
      acquisitionOrder: 0,
    })
    const result = removeOneStatusLayer([debuff, buff], {
      ownerUnitId: unitId('owner'),
      mode: 'dispel',
    })

    expect(result.batches).toEqual([debuff])
    expect(result.events[0].type).toBe('STATUS_DISPELLED')
  })

  it('chooses the same earliest batch when storage order is reversed', () => {
    const earlier = batch('earlier', {
      category: StatusCategory.Debuff,
      canBeCleansed: true,
      canBeDispelled: false,
      acquisitionOrder: 2,
    })
    const later = batch('later', {
      category: StatusCategory.Debuff,
      canBeCleansed: true,
      canBeDispelled: false,
      acquisitionOrder: 8,
    })
    const forward = removeBattleStatus(stateWithBatches([later, earlier]), {
      ownerUnitId: unitId('owner'),
      mode: 'cleanse',
    })
    const reversed = removeBattleStatus(stateWithBatches([earlier, later]), {
      ownerUnitId: unitId('owner'),
      mode: 'cleanse',
    })

    expect(forward.ok).toBe(true)
    expect(reversed.ok).toBe(true)
    if (!forward.ok || !reversed.ok) return
    expect(forward.events[0]).toMatchObject({ batchId: earlier.batchId })
    expect(reversed.events[0]).toMatchObject({ batchId: earlier.batchId })
  })

  it('rejects duplicate existing acquisition orders without choosing by array order', () => {
    const first = batch('first', { acquisitionOrder: 4 })
    const second = batch('second', {
      acquisitionOrder: 4,
      category: StatusCategory.Debuff,
      canBeCleansed: true,
    })
    const state = stateWithBatches([first, second])
    const result = removeBattleStatus(state, {
      ownerUnitId: unitId('owner'),
      mode: 'cleanse',
    })

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'DUPLICATE_STATUS_ACQUISITION_ORDER',
    })
  })

  it('removes a whole non-stackable batch', () => {
    const unique = batch('unique', {
      category: StatusCategory.Debuff,
      canBeCleansed: true,
      canBeDispelled: false,
      stackPolicy: StackPolicy.Unique,
    })
    const result = removeOneStatusLayer([unique], {
      ownerUnitId: unitId('owner'),
      mode: 'cleanse',
    })

    expect(result.batches).toEqual([])
  })

  it.each([
    ['cleanse' as const],
    ['dispel' as const],
  ])('returns no target without changing batches or events for %s', (mode) => {
    const protectedBatch = batch('protected', {
      canBeCleansed: false,
      canBeDispelled: false,
    })
    const result = removeOneStatusLayer([protectedBatch], {
      ownerUnitId: unitId('owner'),
      mode,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(false)
    expect(result.batches).toEqual([protectedBatch])
    expect(result.events).toEqual([])
  })
})

describe('invalid status input', () => {
  it.each([
    [batch('zero-stacks', { stacks: 0 }), 'INVALID_STATUS_STACKS'],
    [batch('fractional-stacks', { stacks: 1.5 }), 'INVALID_STATUS_STACKS'],
    [batch('zero-duration', { remainingOwnerTurns: 0 }), 'INVALID_STATUS_DURATION'],
    [batch('nan-effect', {
      effect: { calculation: 'total', value: Number.NaN },
    }), 'INVALID_STATUS_EFFECT_VALUE'],
    [batch('negative-order', { acquisitionOrder: -1 }), 'INVALID_STATUS_ACQUISITION_ORDER'],
    [batch('fractional-order', { acquisitionOrder: 1.5 }), 'INVALID_STATUS_ACQUISITION_ORDER'],
    [batch('nan-order', { acquisitionOrder: Number.NaN }), 'INVALID_STATUS_ACQUISITION_ORDER'],
    [batch('infinite-order', { acquisitionOrder: Number.POSITIVE_INFINITY }), 'INVALID_STATUS_ACQUISITION_ORDER'],
  ])('rejects invalid batch input with stable error %s', (incoming, reason) => {
    const original: readonly StatusBatch[] = []
    const result = addStatusBatch(original, incoming)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe(reason)
    expect(result.batches).toBe(original)
    expect(result.events).toEqual([])
  })

  it('rejects a merge whose stack total exceeds the safe integer range', () => {
    const existing = batch('existing', {
      stackPolicy: StackPolicy.MergeEquivalent,
      acquisitionGroupId: 'same',
      stacks: Number.MAX_SAFE_INTEGER,
    })
    const incoming = batch('incoming', {
      stackPolicy: StackPolicy.MergeEquivalent,
      acquisitionGroupId: 'same',
      stacks: 1,
    })
    const original: readonly StatusBatch[] = [existing]
    const result = addStatusBatch(original, incoming)

    expect(result).toEqual({
      ok: false,
      batches: original,
      events: [],
      reason: 'INVALID_STATUS_STACKS',
    })
  })
})

describe('battle status transactions', () => {
  it('commits batches and structured events together on success', () => {
    const state = createBattleState([createUnit('owner')])
    const result = addStatusToBattle(state, batch('new'))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.statusBatches).toHaveLength(1)
    expect(result.state.events.at(-1)?.type).toBe('STATUS_ACQUIRED')
    expect(state.statusBatches).toEqual([])
  })

  it('leaves state, events, and RNG references unchanged when removal has no target', () => {
    const state = createBattleState([createUnit('owner')])
    const result = removeBattleStatus(state, {
      ownerUnitId: unitId('owner'),
      mode: 'cleanse',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(false)
    expect(result.state).toBe(state)
    expect(result.state.events).toBe(state.events)
    expect(result.state.rngState).toBe(state.rngState)
  })

  it('rejects a missing status owner atomically', () => {
    const state = createBattleState([createUnit('owner')])
    const result = addStatusToBattle(state, batch('missing', {
      ownerUnitId: unitId('missing'),
    }))

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'STATUS_OWNER_NOT_FOUND',
    })
  })

  it('rejects a new batch whose acquisition order is already in use', () => {
    const existing = batch('existing', { acquisitionOrder: 3 })
    const state = stateWithBatches([existing])
    const result = addStatusToBattle(state, batch('incoming', {
      acquisitionOrder: 3,
    }))

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'DUPLICATE_STATUS_ACQUISITION_ORDER',
    })
  })

  it('does not reuse an acquisition order after its original batch is removed', () => {
    const acquired = addStatusToBattle(
      createBattleState([createUnit('owner')]),
      batch('original', { acquisitionOrder: 7 }),
    )
    expect(acquired.ok).toBe(true)
    if (!acquired.ok) return
    const removed = removeBattleStatus(acquired.state, {
      ownerUnitId: unitId('owner'),
      mode: 'dispel',
    })
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.state.statusBatches).toEqual([])

    const reused = addStatusToBattle(removed.state, batch('replacement', {
      statusId: ids.status('status:different'),
      acquisitionOrder: 7,
    }))
    expect(reused).toEqual({
      ok: false,
      state: removed.state,
      events: [],
      reason: 'DUPLICATE_STATUS_ACQUISITION_ORDER',
    })
  })
})
