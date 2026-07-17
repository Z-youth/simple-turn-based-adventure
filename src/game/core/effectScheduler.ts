import type { UnitId } from './identifiers'
import type { UnitState } from './units'
import { isUnitAlive } from './unitQueries'

export interface AcquiredEffect {
  readonly acquisitionOrder: number
}

export interface DelayedEffect<TPayload = unknown> extends AcquiredEffect {
  readonly effectId: string
  readonly timing: string
  readonly ownerUnitId: UnitId | null
  readonly payload: TPayload
}

export type PendingExecutionKind =
  | 'extraAction'
  | 'repeatAction'
  | 'extraTurn'

export interface PendingExecution<TPayload = unknown> extends AcquiredEffect {
  readonly executionId: string
  readonly chainId: string
  readonly kind: PendingExecutionKind
  readonly actorId: UnitId
  readonly fixedTargetId: UnitId | null
  readonly payload: TPayload
}

export interface PendingExecutionSelection<TPayload = unknown> {
  readonly execution: PendingExecution<TPayload> | null
  readonly remaining: readonly PendingExecution<TPayload>[]
  readonly cancelled: readonly PendingExecution<TPayload>[]
}

export interface TriggerResolution<TState, TTrigger> {
  readonly state: TState
  readonly triggers: readonly TTrigger[]
}

export interface TriggerChainResult<TState, TTrigger> {
  readonly state: TState
  readonly resolved: readonly TTrigger[]
}

export interface PostActionBoundaryInput {
  readonly battleEnded: boolean
  readonly actorEligibleForAfterAction: boolean
  readonly afterActionCompleted: boolean
  readonly phaseTransitionPending: boolean
  readonly hasPendingExecution: boolean
  readonly turnShouldEnd: boolean
}

export type PostActionContinuation =
  | 'battleEnded'
  | 'afterAction'
  | 'phaseTransition'
  | 'pendingExecution'
  | 'turnEnd'
  | 'awaitAction'

function assertAcquisitionOrder(order: number): void {
  if (!Number.isSafeInteger(order) || order < 0) {
    throw new RangeError('INVALID_EFFECT_ACQUISITION_ORDER')
  }
}

export function sortByAcquisitionOrder<T extends AcquiredEffect>(
  effects: readonly T[],
): readonly T[] {
  effects.forEach((effect) => assertAcquisitionOrder(effect.acquisitionOrder))
  return effects
    .map((effect, insertionOrder) => ({ effect, insertionOrder }))
    .sort((left, right) => (
      left.effect.acquisitionOrder - right.effect.acquisitionOrder
      || left.insertionOrder - right.insertionOrder
    ))
    .map(({ effect }) => effect)
}

export function takeDelayedEffects<TPayload>(
  queue: readonly DelayedEffect<TPayload>[],
  timing: string,
  ownerUnitId: UnitId | null,
): {
  readonly due: readonly DelayedEffect<TPayload>[]
  readonly remaining: readonly DelayedEffect<TPayload>[]
} {
  const due = queue.filter((effect) => (
    effect.timing === timing && effect.ownerUnitId === ownerUnitId
  ))
  const dueEffects = new Set(due)
  return {
    due: sortByAcquisitionOrder(due),
    remaining: queue.filter((effect) => !dueEffects.has(effect)),
  }
}

export function resolveImmediateTriggerChain<TState, TTrigger extends AcquiredEffect>(
  initialState: TState,
  initialTriggers: readonly TTrigger[],
  resolve: (
    state: TState,
    trigger: TTrigger,
  ) => TriggerResolution<TState, TTrigger>,
): TriggerChainResult<TState, TTrigger> {
  let state = initialState
  const stack = [...sortByAcquisitionOrder(initialTriggers)].reverse()
  const resolved: TTrigger[] = []

  while (stack.length > 0) {
    const trigger = stack.pop()
    if (trigger === undefined) continue
    const result = resolve(state, trigger)
    state = result.state
    resolved.push(trigger)
    stack.push(...[...sortByAcquisitionOrder(result.triggers)].reverse())
  }

  return { state, resolved }
}

function getUnit(units: readonly UnitState[], unitId: UnitId): UnitState | null {
  return units.find((unit) => unit.id === unitId) ?? null
}

export function takeNextPendingExecution<TPayload>(
  queue: readonly PendingExecution<TPayload>[],
  units: readonly UnitState[],
): PendingExecutionSelection<TPayload> {
  const ordered = [...sortByAcquisitionOrder(queue)]
  const cancelled: PendingExecution<TPayload>[] = []

  while (ordered.length > 0) {
    const execution = ordered.shift()
    if (execution === undefined) break
    const actor = getUnit(units, execution.actorId)
    const target = execution.fixedTargetId === null
      ? null
      : getUnit(units, execution.fixedTargetId)
    const actorIsValid = actor !== null && isUnitAlive(actor)
    const targetIsValid = execution.fixedTargetId === null
      || (target !== null && isUnitAlive(target))
    if (actorIsValid && targetIsValid) {
      return { execution, remaining: ordered, cancelled }
    }

    cancelled.push(execution)
    if (!targetIsValid) {
      const sameChain = ordered.filter((item) => item.chainId === execution.chainId)
      cancelled.push(...sameChain)
      const sameChainIds = new Set(sameChain.map((item) => item.executionId))
      for (let index = ordered.length - 1; index >= 0; index -= 1) {
        const queued = ordered[index]
        if (queued !== undefined && sameChainIds.has(queued.executionId)) {
          ordered.splice(index, 1)
        }
      }
    }
  }

  return { execution: null, remaining: [], cancelled }
}

export function getPendingExecutionLifecycle(kind: PendingExecutionKind): {
  readonly startsPersonalTurn: boolean
  readonly countsAsAction: boolean
} {
  return kind === 'extraTurn'
    ? { startsPersonalTurn: true, countsAsAction: false }
    : { startsPersonalTurn: false, countsAsAction: true }
}

export function selectPostActionContinuation(
  input: PostActionBoundaryInput,
): PostActionContinuation {
  if (input.battleEnded) return 'battleEnded'
  if (!input.afterActionCompleted && input.actorEligibleForAfterAction) {
    return 'afterAction'
  }
  if (input.phaseTransitionPending) return 'phaseTransition'
  if (input.hasPendingExecution) return 'pendingExecution'
  return input.turnShouldEnd ? 'turnEnd' : 'awaitAction'
}
