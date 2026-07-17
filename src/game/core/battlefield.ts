import type { BattleState, OffFieldUnitState } from './contexts'
import type { BattleEvent } from './events'
import type { UnitId } from './identifiers'
import type { UnitState } from './units'
import { validateCombatUnit } from './combatValidation'
import { isUnitAlive } from './unitQueries'

export interface BattlefieldEventOrigin {
  readonly sourceUnitId: UnitId | null
  readonly effectId: string | null
}

export interface SummonUnitRequest extends BattlefieldEventOrigin {
  readonly kind: 'summon'
  readonly unit: UnitState
  readonly immediateTurnAfterCurrentTurn?: boolean
}

export interface RemoveUnitRequest extends BattlefieldEventOrigin {
  readonly kind: 'remove'
  readonly unitId: UnitId
}

export interface RetreatUnitRequest extends BattlefieldEventOrigin {
  readonly kind: 'retreat'
  readonly unitId: UnitId
}

export interface ReturnUnitRequest extends BattlefieldEventOrigin {
  readonly kind: 'return'
  readonly unitId: UnitId
}

export interface ReplaceUnitRequest extends BattlefieldEventOrigin {
  readonly kind: 'replace'
  readonly replacedUnitId: UnitId
  readonly replacement: UnitState
}

export type BattlefieldOperation = SummonUnitRequest
  | RemoveUnitRequest
  | RetreatUnitRequest
  | ReturnUnitRequest
  | ReplaceUnitRequest

export interface BattlefieldTransactionSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

export interface BattlefieldTransactionFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: string
}

export type BattlefieldTransactionResult = BattlefieldTransactionSuccess
  | BattlefieldTransactionFailure

function failure(
  state: BattleState,
  reason: string,
): BattlefieldTransactionFailure {
  return { ok: false, state, events: [], reason }
}

function allKnownUnits(state: BattleState): readonly UnitState[] {
  return [
    ...state.units,
    ...(state.offFieldUnits ?? []).map((entry) => entry.unit),
  ]
}

function nextDeploymentOrder(state: BattleState): number {
  return state.nextDeploymentOrder ?? allKnownUnits(state).reduce(
    (maximum, unit) => Math.max(maximum, unit.deploymentOrder),
    -1,
  ) + 1
}

function unitIdExists(state: BattleState, unitId: UnitId): boolean {
  return allKnownUnits(state).some((unit) => unit.id === unitId)
}

function appendEvent(
  state: BattleState,
  event: BattleEvent,
): BattlefieldTransactionSuccess {
  return {
    ok: true,
    state: { ...state, events: [...state.events, event] },
    events: [event],
  }
}

function insertImmediateTurn(
  state: BattleState,
  unit: UnitState,
  request: SummonUnitRequest,
): BattleState | string {
  if (!request.immediateTurnAfterCurrentTurn) return state
  const turn = state.personalTurn
  const sequence = state.turnSequence
  if (
    turn === null
    || sequence === null
    || request.sourceUnitId !== turn.unitId
  ) return 'IMMEDIATE_TURN_REQUIRES_CURRENT_SUMMONER_TURN'

  let insertionIndex = sequence.currentIndex + 1
  while (sequence.queue[insertionIndex]?.kind === 'immediate') {
    insertionIndex += 1
  }
  const queue = [...sequence.queue]
  queue.splice(insertionIndex, 0, {
    unitId: unit.id,
    speedAtSequenceStart: unit.speed,
    kind: 'immediate',
  })
  return {
    ...state,
    turnSequence: { ...sequence, queue },
  }
}

function summonUnit(
  state: BattleState,
  request: SummonUnitRequest,
): BattlefieldTransactionResult {
  if (unitIdExists(state, request.unit.id)) {
    return failure(state, 'UNIT_ID_ALREADY_EXISTS')
  }
  if (validateCombatUnit(request.unit) !== null || !isUnitAlive(request.unit)) {
    return failure(state, 'INVALID_SUMMONED_UNIT')
  }
  const deploymentOrder = nextDeploymentOrder(state)
  const unit = { ...request.unit, deploymentOrder }
  const inserted = insertImmediateTurn(
    {
      ...state,
      units: [...state.units, unit],
      nextDeploymentOrder: deploymentOrder + 1,
    },
    unit,
    request,
  )
  if (typeof inserted === 'string') return failure(state, inserted)
  return appendEvent(inserted, {
    type: 'UNIT_SUMMONED',
    unitId: unit.id,
    sourceUnitId: request.sourceUnitId,
    effectId: request.effectId,
  })
}

function removeUnit(
  state: BattleState,
  request: RemoveUnitRequest,
): BattlefieldTransactionResult {
  const active = state.units.some((unit) => unit.id === request.unitId)
  const offField = (state.offFieldUnits ?? []).some(
    (entry) => entry.unit.id === request.unitId,
  )
  if (!active && !offField) return failure(state, 'UNIT_NOT_FOUND')
  const deploymentOrder = nextDeploymentOrder(state)
  const nextState: BattleState = {
    ...state,
    units: state.units.filter((unit) => unit.id !== request.unitId),
    offFieldUnits: (state.offFieldUnits ?? []).filter(
      (entry) => entry.unit.id !== request.unitId,
    ),
    statusBatches: state.statusBatches.filter(
      (batch) => batch.ownerUnitId !== request.unitId,
    ),
    nextDeploymentOrder: deploymentOrder,
  }
  return appendEvent(nextState, {
    type: 'UNIT_REMOVED',
    unitId: request.unitId,
    sourceUnitId: request.sourceUnitId,
    effectId: request.effectId,
  })
}

function retreatUnit(
  state: BattleState,
  request: RetreatUnitRequest,
): BattlefieldTransactionResult {
  const unit = state.units.find((candidate) => candidate.id === request.unitId)
  if (unit === undefined) return failure(state, 'ACTIVE_UNIT_NOT_FOUND')
  const statusBatches = state.statusBatches.filter(
    (batch) => batch.ownerUnitId === request.unitId,
  )
  const stored: OffFieldUnitState = { unit, statusBatches }
  const nextState: BattleState = {
    ...state,
    units: state.units.filter((candidate) => candidate.id !== request.unitId),
    offFieldUnits: [...(state.offFieldUnits ?? []), stored],
    statusBatches: state.statusBatches.filter(
      (batch) => batch.ownerUnitId !== request.unitId,
    ),
  }
  return appendEvent(nextState, {
    type: 'UNIT_RETREATED',
    unitId: request.unitId,
    sourceUnitId: request.sourceUnitId,
    effectId: request.effectId,
  })
}

function returnUnit(
  state: BattleState,
  request: ReturnUnitRequest,
): BattlefieldTransactionResult {
  const stored = (state.offFieldUnits ?? []).find(
    (entry) => entry.unit.id === request.unitId,
  )
  if (stored === undefined) return failure(state, 'OFF_FIELD_UNIT_NOT_FOUND')
  if (!isUnitAlive(stored.unit)) return failure(state, 'OFF_FIELD_UNIT_NOT_ALIVE')
  const deploymentOrder = nextDeploymentOrder(state)
  const unit = { ...stored.unit, deploymentOrder }
  const nextState: BattleState = {
    ...state,
    units: [...state.units, unit],
    offFieldUnits: (state.offFieldUnits ?? []).filter(
      (entry) => entry.unit.id !== request.unitId,
    ),
    statusBatches: [...state.statusBatches, ...stored.statusBatches],
    nextDeploymentOrder: deploymentOrder + 1,
  }
  return appendEvent(nextState, {
    type: 'UNIT_RETURNED',
    unitId: request.unitId,
    sourceUnitId: request.sourceUnitId,
    effectId: request.effectId,
  })
}

function replaceBattlefieldUnit(
  state: BattleState,
  request: ReplaceUnitRequest,
): BattlefieldTransactionResult {
  if (!state.units.some((unit) => unit.id === request.replacedUnitId)) {
    return failure(state, 'ACTIVE_UNIT_NOT_FOUND')
  }
  if (
    request.replacement.id !== request.replacedUnitId
    && unitIdExists(state, request.replacement.id)
  ) return failure(state, 'UNIT_ID_ALREADY_EXISTS')
  if (
    validateCombatUnit(request.replacement) !== null
    || !isUnitAlive(request.replacement)
  ) return failure(state, 'INVALID_REPLACEMENT_UNIT')

  const deploymentOrder = nextDeploymentOrder(state)
  const withoutReplaced: BattleState = {
    ...state,
    units: state.units.filter((unit) => unit.id !== request.replacedUnitId),
    statusBatches: state.statusBatches.filter(
      (batch) => batch.ownerUnitId !== request.replacedUnitId,
    ),
  }
  const replacement = { ...request.replacement, deploymentOrder }
  return appendEvent({
    ...withoutReplaced,
    units: [...withoutReplaced.units, replacement],
    nextDeploymentOrder: deploymentOrder + 1,
  }, {
    type: 'UNIT_REPLACED',
    replacedUnitId: request.replacedUnitId,
    replacementUnitId: replacement.id,
    sourceUnitId: request.sourceUnitId,
    effectId: request.effectId,
  })
}

function applyOperation(
  state: BattleState,
  operation: BattlefieldOperation,
): BattlefieldTransactionResult {
  switch (operation.kind) {
    case 'summon':
      return summonUnit(state, operation)
    case 'remove':
      return removeUnit(state, operation)
    case 'retreat':
      return retreatUnit(state, operation)
    case 'return':
      return returnUnit(state, operation)
    case 'replace':
      return replaceBattlefieldUnit(state, operation)
  }
}

export function resolveBattlefieldTransaction(
  state: BattleState,
  operations: readonly BattlefieldOperation[],
): BattlefieldTransactionResult {
  let currentState = state
  const events: BattleEvent[] = []
  for (const operation of operations) {
    const result = applyOperation(currentState, operation)
    if (!result.ok) return failure(state, result.reason)
    currentState = result.state
    events.push(...result.events)
  }
  return { ok: true, state: currentState, events }
}
