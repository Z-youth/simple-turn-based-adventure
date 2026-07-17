import {
  StackPolicy,
  StatusCategory,
} from './enums'
import type { BattleEvent, StatusChangeKind } from './events'
import type { BattleState } from './contexts'
import type { StatusBatchId, StatusId, UnitId } from './identifiers'
import type { StatusBatch } from './statuses'

export type StatusErrorCode =
  | 'INVALID_STATUS_STACKS'
  | 'INVALID_STATUS_DURATION'
  | 'INVALID_STATUS_EFFECT_VALUE'
  | 'INVALID_STATUS_ACQUISITION_ORDER'
  | 'DUPLICATE_STATUS_ACQUISITION_ORDER'
  | 'STATUS_OWNER_NOT_FOUND'

export interface StatusOperationSuccess {
  readonly ok: true
  readonly batches: readonly StatusBatch[]
  readonly events: readonly BattleEvent[]
  readonly changed: boolean
}

export interface StatusOperationFailure {
  readonly ok: false
  readonly batches: readonly StatusBatch[]
  readonly events: readonly []
  readonly reason: StatusErrorCode
}

export type StatusOperationResult =
  | StatusOperationSuccess
  | StatusOperationFailure

export interface StatusEventOrigin {
  readonly sourceUnitId: UnitId | null
  readonly skillExecutionId: import('./identifiers').SkillExecutionId | null
  readonly effectId: string | null
}

function defaultStatusOrigin(batch: StatusBatch): StatusEventOrigin {
  return {
    sourceUnitId: batch.sourceUnitId,
    skillExecutionId: null,
    effectId: String(batch.statusId),
  }
}

function statusEvent(
  type: StatusChangeKind,
  batch: StatusBatch,
  previousBatchId: StatusBatchId | null = null,
  origin: StatusEventOrigin = defaultStatusOrigin(batch),
): BattleEvent {
  return {
    type,
    ownerUnitId: batch.ownerUnitId,
    statusId: batch.statusId,
    category: batch.category,
    batchId: batch.batchId,
    previousBatchId,
    stacks: batch.stacks,
    remainingOwnerTurns: batch.remainingOwnerTurns,
    ...origin,
  }
}

function validateBatch(batch: StatusBatch): StatusErrorCode | null {
  if (!Number.isSafeInteger(batch.stacks) || batch.stacks <= 0) {
    return 'INVALID_STATUS_STACKS'
  }
  if (
    batch.remainingOwnerTurns !== null
    && (!Number.isSafeInteger(batch.remainingOwnerTurns)
      || batch.remainingOwnerTurns <= 0)
  ) {
    return 'INVALID_STATUS_DURATION'
  }
  if (!Number.isFinite(batch.effect.value)) {
    return 'INVALID_STATUS_EFFECT_VALUE'
  }
  if (!Number.isSafeInteger(batch.acquisitionOrder) || batch.acquisitionOrder < 0) {
    return 'INVALID_STATUS_ACQUISITION_ORDER'
  }
  return null
}

function validateExistingBatches(
  batches: readonly StatusBatch[],
): StatusErrorCode | null {
  const acquisitionOrders: number[] = []
  for (const batch of batches) {
    const invalid = validateBatch(batch)
    if (invalid !== null) return invalid
    if (acquisitionOrders.includes(batch.acquisitionOrder)) {
      return 'DUPLICATE_STATUS_ACQUISITION_ORDER'
    }
    acquisitionOrders.push(batch.acquisitionOrder)
  }
  return null
}

function sameStatus(left: StatusBatch, right: StatusBatch): boolean {
  return left.ownerUnitId === right.ownerUnitId
    && left.statusId === right.statusId
}

function equivalentForMerge(left: StatusBatch, right: StatusBatch): boolean {
  return sameStatus(left, right)
    && left.sourceUnitId === right.sourceUnitId
    && left.category === right.category
    && left.stackPolicy === right.stackPolicy
    && left.effect.calculation === right.effect.calculation
    && left.effect.value === right.effect.value
    && left.remainingOwnerTurns === right.remainingOwnerTurns
    && left.acquiredAt === right.acquiredAt
    && left.acquisitionGroupId === right.acquisitionGroupId
    && left.skipNextTurnEndDecrement === right.skipNextTurnEndDecrement
    && left.canBeCleansed === right.canBeCleansed
    && left.canBeDispelled === right.canBeDispelled
}

function earliestBatch(
  batches: readonly StatusBatch[],
): StatusBatch | undefined {
  return batches.reduce<StatusBatch | undefined>((earliest, batch) => (
    earliest === undefined || batch.acquisitionOrder < earliest.acquisitionOrder
      ? batch
      : earliest
  ), undefined)
}

function addStatusBatch(
  batches: readonly StatusBatch[],
  incoming: StatusBatch,
  origin: StatusEventOrigin,
): StatusOperationResult {
  const invalidExisting = validateExistingBatches(batches)
  if (invalidExisting !== null) {
    return { ok: false, batches, events: [], reason: invalidExisting }
  }
  const invalid = validateBatch(incoming)
  if (invalid !== null) {
    return { ok: false, batches, events: [], reason: invalid }
  }

  const normalizedIncoming = incoming.stackPolicy === StackPolicy.Independent
    || incoming.stackPolicy === StackPolicy.MergeEquivalent
    ? incoming
    : { ...incoming, stacks: 1 }
  const matching = batches.filter((batch) => sameStatus(batch, normalizedIncoming))
  if (normalizedIncoming.stackPolicy === StackPolicy.Unique && matching.length > 0) {
    return {
      ok: true,
      batches,
      events: [statusEvent('STATUS_REJECTED', normalizedIncoming, null, origin)],
      changed: false,
    }
  }

  if (
    normalizedIncoming.stackPolicy === StackPolicy.RefreshDuration
    && matching.length > 0
  ) {
    const existing = earliestBatch(matching)
    if (existing === undefined) {
      return { ok: true, batches, events: [], changed: false }
    }
    const refreshed = {
      ...existing,
      remainingOwnerTurns: normalizedIncoming.remainingOwnerTurns,
    }
    return {
      ok: true,
      batches: batches.map((batch) => (
        batch.batchId === existing.batchId ? refreshed : batch
      )),
      events: [statusEvent('STATUS_DURATION_REFRESHED', refreshed, null, origin)],
      changed: true,
    }
  }

  if (normalizedIncoming.stackPolicy === StackPolicy.Replace && matching.length > 0) {
    const previous = earliestBatch(matching)
    const retained = batches.filter((batch) => !sameStatus(batch, normalizedIncoming))
    if (retained.some((batch) => (
      batch.acquisitionOrder === normalizedIncoming.acquisitionOrder
    ))) {
      return {
        ok: false,
        batches,
        events: [],
        reason: 'DUPLICATE_STATUS_ACQUISITION_ORDER',
      }
    }
    return {
      ok: true,
      batches: [
        ...retained,
        normalizedIncoming,
      ],
      events: [statusEvent(
        'STATUS_BATCH_REPLACED',
        normalizedIncoming,
        previous?.batchId ?? null,
        origin,
      )],
      changed: true,
    }
  }

  if (normalizedIncoming.stackPolicy === StackPolicy.MergeEquivalent) {
    const equivalent = batches.find((batch) => (
      equivalentForMerge(batch, normalizedIncoming)
    ))
    if (equivalent !== undefined) {
      if (!Number.isSafeInteger(equivalent.stacks + normalizedIncoming.stacks)) {
        return {
          ok: false,
          batches,
          events: [],
          reason: 'INVALID_STATUS_STACKS',
        }
      }
      const merged = {
        ...equivalent,
        stacks: equivalent.stacks + normalizedIncoming.stacks,
      }
      return {
        ok: true,
        batches: batches.map((batch) => (
          batch.batchId === equivalent.batchId ? merged : batch
        )),
        events: [statusEvent('STATUS_BATCH_MERGED', merged, null, origin)],
        changed: true,
      }
    }
  }


  if (batches.some((batch) => (
    batch.acquisitionOrder === normalizedIncoming.acquisitionOrder
  ))) {
    return {
      ok: false,
      batches,
      events: [],
      reason: 'DUPLICATE_STATUS_ACQUISITION_ORDER',
    }
  }

  return {
    ok: true,
    batches: [...batches, normalizedIncoming],
    events: [statusEvent('STATUS_ACQUIRED', normalizedIncoming, null, origin)],
    changed: true,
  }
}

function decrementStatusDurations(
  batches: readonly StatusBatch[],
  ownerUnitId: UnitId,
): StatusOperationResult {
  const invalid = validateExistingBatches(batches)
  if (invalid !== null) {
    return { ok: false, batches, events: [], reason: invalid }
  }
  const nextBatches: StatusBatch[] = []
  const events: BattleEvent[] = []

  for (const batch of batches) {
    if (batch.ownerUnitId !== ownerUnitId || batch.remainingOwnerTurns === null) {
      nextBatches.push(batch)
      continue
    }
    const remainingOwnerTurns = batch.remainingOwnerTurns - 1
    const decremented = { ...batch, remainingOwnerTurns }
    events.push(statusEvent('STATUS_DURATION_DECREMENTED', decremented))
    if (remainingOwnerTurns === 0) {
      events.push(statusEvent('STATUS_BATCH_REMOVED', decremented))
    } else {
      nextBatches.push(decremented)
    }
  }

  return {
    ok: true,
    batches: nextBatches,
    events,
    changed: events.length > 0 || nextBatches.some(
      (batch, index) => batch !== batches[index],
    ),
  }
}

export type RemoveStatusInput = ({
  readonly ownerUnitId: UnitId
  readonly mode: 'cleanse' | 'dispel'
} | {
  readonly ownerUnitId: UnitId
  readonly mode: 'remove'
  readonly category: StatusCategory
  readonly statusId?: StatusId
}) & { readonly origin?: StatusEventOrigin }

function isRemovable(batch: StatusBatch, input: RemoveStatusInput): boolean {
  if (batch.ownerUnitId !== input.ownerUnitId) return false
  if (input.mode === 'cleanse') {
    return batch.category === StatusCategory.Debuff && batch.canBeCleansed
  }
  if (input.mode === 'remove') {
    return batch.category === input.category
      && (input.statusId === undefined || batch.statusId === input.statusId)
  }
  return batch.category === StatusCategory.Buff && batch.canBeDispelled
}

function removeOneStatusLayer(
  batches: readonly StatusBatch[],
  input: RemoveStatusInput,
): StatusOperationResult {
  const invalid = validateExistingBatches(batches)
  if (invalid !== null) {
    return { ok: false, batches, events: [], reason: invalid }
  }
  const target = earliestBatch(batches.filter((batch) => isRemovable(batch, input)))
  if (target === undefined) {
    return { ok: true, batches, events: [], changed: false }
  }

  const removeWholeBatch = target.stackPolicy !== StackPolicy.Independent
    && target.stackPolicy !== StackPolicy.MergeEquivalent
  const nextStacks = removeWholeBatch ? 0 : target.stacks - 1
  const operationType = input.mode === 'cleanse'
    ? 'STATUS_CLEANSED'
    : input.mode === 'dispel'
      ? 'STATUS_DISPELLED'
      : 'STATUS_REMOVED'
  if (nextStacks <= 0) {
    return {
      ok: true,
      batches: batches.filter((batch) => batch.batchId !== target.batchId),
      events: [
        statusEvent(operationType, target, null, input.origin),
        statusEvent('STATUS_BATCH_REMOVED', { ...target, stacks: 0 }, null, input.origin),
      ],
      changed: true,
    }
  }

  const reduced = { ...target, stacks: nextStacks }
  return {
    ok: true,
    batches: batches.map((batch) => (
      batch.batchId === target.batchId ? reduced : batch
    )),
    events: [
        statusEvent(operationType, reduced, null, input.origin),
        statusEvent('STATUS_STACK_REMOVED', reduced, null, input.origin),
    ],
    changed: true,
  }
}

export function getStatusBatchesForOwner(
  batches: readonly StatusBatch[],
  ownerUnitId: UnitId,
  statusId?: StatusId,
): readonly StatusBatch[] {
  return batches.filter((batch) => (
    batch.ownerUnitId === ownerUnitId
    && (statusId === undefined || batch.statusId === statusId)
  ))
}

export interface BattleStatusSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
  readonly changed: boolean
}

export interface BattleStatusFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: StatusErrorCode
}

export type BattleStatusResult = BattleStatusSuccess | BattleStatusFailure

function validateStatusAcquisitionRegistry(
  state: BattleState,
): StatusErrorCode | null {
  const orders = state.statusAcquisitionOrders
  if (orders.some((order) => !Number.isSafeInteger(order) || order < 0)) {
    return 'INVALID_STATUS_ACQUISITION_ORDER'
  }
  if (new Set(orders).size !== orders.length) {
    return 'DUPLICATE_STATUS_ACQUISITION_ORDER'
  }
  if (state.statusBatches.some((batch) => (
    !orders.includes(batch.acquisitionOrder)
  ))) {
    return 'INVALID_STATUS_ACQUISITION_ORDER'
  }
  return null
}

function commitStatusOperation(
  state: BattleState,
  operation: StatusOperationResult,
): BattleStatusResult {
  if (!operation.ok) {
    return {
      ok: false,
      state,
      events: [],
      reason: operation.reason,
    }
  }
  if (!operation.changed && operation.events.length === 0) {
    return { ok: true, state, events: [], changed: false }
  }
  return {
    ok: true,
    state: {
      ...state,
      statusBatches: operation.batches,
      events: [...state.events, ...operation.events],
    },
    events: operation.events,
    changed: operation.changed,
  }
}

export function addStatusToBattle(
  state: BattleState,
  incoming: StatusBatch,
  origin: StatusEventOrigin = defaultStatusOrigin(incoming),
): BattleStatusResult {
  const normalizedIncoming: StatusBatch = {
    ...incoming,
    skipNextTurnEndDecrement: false,
  }
  if (!state.units.some((unit) => unit.id === normalizedIncoming.ownerUnitId)) {
    return {
      ok: false,
      state,
      events: [],
      reason: 'STATUS_OWNER_NOT_FOUND',
    }
  }
  const invalidRegistry = validateStatusAcquisitionRegistry(state)
  if (invalidRegistry !== null) {
    return { ok: false, state, events: [], reason: invalidRegistry }
  }
  const operation = addStatusBatch(
    state.statusBatches,
    normalizedIncoming,
    origin,
  )
  if (!operation.ok) return commitStatusOperation(state, operation)
  const createsBatch = operation.events.some((event) => (
    event.type === 'STATUS_ACQUIRED'
    || event.type === 'STATUS_BATCH_REPLACED'
  ))
  if (
    createsBatch
    && state.statusAcquisitionOrders.includes(normalizedIncoming.acquisitionOrder)
  ) {
    return {
      ok: false,
      state,
      events: [],
      reason: 'DUPLICATE_STATUS_ACQUISITION_ORDER',
    }
  }
  const committed = commitStatusOperation(state, operation)
  if (!committed.ok || !createsBatch) return committed
  return {
    ...committed,
    state: {
      ...committed.state,
      statusAcquisitionOrders: [
        ...state.statusAcquisitionOrders,
        normalizedIncoming.acquisitionOrder,
      ],
    },
  }
}

export function removeBattleStatus(
  state: BattleState,
  input: RemoveStatusInput,
): BattleStatusResult {
  if (!state.units.some((unit) => unit.id === input.ownerUnitId)) {
    return {
      ok: false,
      state,
      events: [],
      reason: 'STATUS_OWNER_NOT_FOUND',
    }
  }
  const invalidRegistry = validateStatusAcquisitionRegistry(state)
  if (invalidRegistry !== null) {
    return { ok: false, state, events: [], reason: invalidRegistry }
  }
  return commitStatusOperation(
    state,
    removeOneStatusLayer(state.statusBatches, input),
  )
}

export function advanceBattleStatusDurations(
  state: BattleState,
  ownerUnitId: UnitId,
): BattleStatusResult {
  if (!state.units.some((unit) => unit.id === ownerUnitId)) {
    return {
      ok: false,
      state,
      events: [],
      reason: 'STATUS_OWNER_NOT_FOUND',
    }
  }
  const invalidRegistry = validateStatusAcquisitionRegistry(state)
  if (invalidRegistry !== null) {
    return { ok: false, state, events: [], reason: invalidRegistry }
  }
  return commitStatusOperation(
    state,
    decrementStatusDurations(state.statusBatches, ownerUnitId),
  )
}
