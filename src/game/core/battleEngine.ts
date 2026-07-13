import {
  Camp,
  BattlePhase,
  PersonalTurnPhase,
  TurnEndStage,
} from './enums'
import { EndTurnConfirmation } from './commands'
import type { EndTurnRequest } from './commands'
import type { BattleState, TurnSequenceState } from './contexts'
import type { BattleEvent } from './events'
import type { UnitState } from './units'
import type {
  ActionId,
  PersonalTurnId,
  TurnSequenceId,
  UnitId,
} from './identifiers'
import type { StartActionInput } from './actionLifecycle'
import { beginAction, finishAction } from './actionLifecycle'
import { createTurnQueue } from './turnOrder'
import { isUnitAlive } from './unitQueries'
import { finishPersonalTurn, startPersonalTurn } from './turnLifecycle'
import type { SkillResolutionRequest } from './attacks'
import type { SkillResolutionResult } from './resolutionTransaction'
import { resolveSkillTransaction } from './resolutionTransaction'
import { advanceBattleStatusDurations } from './statusEngine'

export interface BattleTransitionSuccess {
  readonly ok: true
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

export interface BattleTransitionFailure {
  readonly ok: false
  readonly state: BattleState
  readonly events: readonly []
  readonly reason: string
}

export type BattleTransitionResult =
  | BattleTransitionSuccess
  | BattleTransitionFailure

export type EndTurnRequestStatus =
  | 'confirmationRequired'
  | 'turnEnded'
  | 'cancelled'
  | 'invalid'

export interface EndTurnRequestResult {
  readonly status: EndTurnRequestStatus
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
  readonly reason?: string
}

function failure(state: BattleState, reason: string): BattleTransitionFailure {
  return { ok: false, state, events: [], reason }
}

function appendEvents(
  state: BattleState,
  events: readonly BattleEvent[],
): BattleState {
  return {
    ...state,
    events: [...state.events, ...events],
  }
}

function findUnit(state: BattleState, unitId: UnitId): UnitState | undefined {
  return state.units.find((unit) => unit.id === unitId)
}

function createSequenceId(sequenceNumber: number): TurnSequenceId {
  return `sequence:${sequenceNumber}` as TurnSequenceId
}

function createSequenceState(
  state: BattleState,
  sequenceNumber: number,
): TurnSequenceState {
  return {
    sequenceId: createSequenceId(sequenceNumber),
    sequenceNumber,
    queue: createTurnQueue(state.units),
    currentIndex: 0,
    completed: false,
  }
}

function createSequenceStartedEvent(
  sequence: TurnSequenceState,
): BattleEvent {
  return {
    type: 'SEQUENCE_STARTED',
    sequenceId: sequence.sequenceId,
    sequenceNumber: sequence.sequenceNumber,
    orderedUnitIds: sequence.queue.map((entry) => entry.unitId),
  }
}

function stopBecauseNoEligibleUnits(
  state: BattleState,
  sequence: TurnSequenceState,
  precedingEvents: readonly BattleEvent[],
): BattleTransitionSuccess {
  const completedSequence = { ...sequence, completed: true }
  const cannotContinueEvent: BattleEvent = {
    type: 'BATTLE_CANNOT_CONTINUE',
    sequenceId: sequence.sequenceId,
    sequenceNumber: sequence.sequenceNumber,
    reason: 'NO_ELIGIBLE_UNITS',
  }
  const events = [...precedingEvents, cannotContinueEvent]
  const nextState: BattleState = {
    ...state,
    phase: BattlePhase.UnableToContinue,
    turnSequence: completedSequence,
    personalTurn: null,
    activeAction: null,
  }

  return {
    ok: true,
    state: appendEvents(nextState, events),
    events,
  }
}

function advanceToNextLivingTurn(
  state: BattleState,
  precedingEvents: readonly BattleEvent[],
): BattleTransitionResult {
  const existingSequence = state.turnSequence
  if (existingSequence === null) {
    return {
      ok: true,
      state: appendEvents(state, precedingEvents),
      events: precedingEvents,
    }
  }

  let sequence = existingSequence
  const events = [...precedingEvents]

  while (sequence.currentIndex < sequence.queue.length) {
    const entry = sequence.queue[sequence.currentIndex]
    const unit = findUnit(state, entry.unitId)

    if (unit === undefined || !isUnitAlive(unit)) {
      events.push({
        type: 'UNIT_SKIPPED_DEAD',
        sequenceId: sequence.sequenceId,
        sequenceNumber: sequence.sequenceNumber,
        unitId: entry.unitId,
      })
      sequence = {
        ...sequence,
        currentIndex: sequence.currentIndex + 1,
      }
      continue
    }

    const turnResult = startPersonalTurn(sequence, unit.id)
    if (!turnResult.ok) return failure(state, turnResult.reason)
    events.push(...turnResult.events)
    const nextState: BattleState = {
      ...state,
      phase: BattlePhase.AwaitingAction,
      turnSequence: sequence,
      personalTurn: turnResult.turn,
      activeAction: null,
    }

    return {
      ok: true,
      state: appendEvents(nextState, events),
      events,
    }
  }

  events.push({
    type: 'SEQUENCE_COMPLETED',
    sequenceId: sequence.sequenceId,
    sequenceNumber: sequence.sequenceNumber,
  })
  const nextSequence = createSequenceState(state, sequence.sequenceNumber + 1)
  events.push(createSequenceStartedEvent(nextSequence))
  const nextState: BattleState = {
    ...state,
    phase: BattlePhase.SequenceStart,
    turnSequence: nextSequence,
    personalTurn: null,
    activeAction: null,
  }

  if (nextSequence.queue.length === 0) {
    return stopBecauseNoEligibleUnits(nextState, nextSequence, events)
  }

  return advanceToNextLivingTurn(nextState, events)
}

export function startBattleSequence(
  state: BattleState,
): BattleTransitionResult {
  if (state.phase === BattlePhase.UnableToContinue) {
    return failure(state, 'BATTLE_CANNOT_CONTINUE')
  }
  if (state.personalTurn !== null || state.activeAction !== null) {
    return failure(state, 'BATTLE_ALREADY_HAS_ACTIVE_TURN')
  }
  if (state.turnSequence !== null && !state.turnSequence.completed) {
    return failure(state, 'TURN_SEQUENCE_ALREADY_ACTIVE')
  }

  const sequenceNumber = (state.turnSequence?.sequenceNumber ?? 0) + 1
  const sequence = createSequenceState(state, sequenceNumber)
  const event = createSequenceStartedEvent(sequence)
  const nextState: BattleState = {
    ...state,
    phase: BattlePhase.SequenceStart,
    turnSequence: sequence,
  }

  if (sequence.queue.length === 0) {
    return stopBecauseNoEligibleUnits(nextState, sequence, [event])
  }

  return advanceToNextLivingTurn(nextState, [event])
}

function endCurrentPersonalTurnInternal(
  state: BattleState,
  personalTurnId: PersonalTurnId,
  precedingEvents: readonly BattleEvent[] = [],
): BattleTransitionResult {
  const turn = state.personalTurn
  const sequence = state.turnSequence
  if (turn === null || sequence === null) {
    return failure(state, 'NO_ACTIVE_PERSONAL_TURN')
  }
  if (turn.personalTurnId !== personalTurnId) {
    return failure(state, 'PERSONAL_TURN_ID_DOES_NOT_MATCH')
  }
  if (state.activeAction !== null) {
    return failure(state, 'ACTION_STILL_RESOLVING')
  }

  const unit = findUnit(state, turn.unitId)
  const actorIsAlive = unit !== undefined && isUnitAlive(unit)
  const turnResult = finishPersonalTurn(turn, actorIsAlive)
  if (!turnResult.ok) return failure(state, turnResult.reason)

  const durationResult = actorIsAlive
    ? advanceBattleStatusDurations(state, turn.unitId)
    : {
      ok: true as const,
      state,
      events: [] as const,
      changed: false,
    }
  if (!durationResult.ok) return failure(state, durationResult.reason)
  const durationStageIndex = turnResult.events.findIndex((event) => (
    event.type === 'TURN_END_STAGE_ENTERED'
    && event.stage === TurnEndStage.StatusDurations
  ))
  const lifecycleEvents = durationStageIndex < 0
    ? turnResult.events
    : [
      ...turnResult.events.slice(0, durationStageIndex + 1),
      ...durationResult.events,
      ...turnResult.events.slice(durationStageIndex + 1),
    ]

  const events = [...precedingEvents, ...lifecycleEvents]
  const nextState: BattleState = {
    ...state,
    phase: BattlePhase.TurnEnd,
    personalTurn: turnResult.turn,
    turnSequence: {
      ...sequence,
      currentIndex: sequence.currentIndex + 1,
    },
    statusBatches: durationResult.state.statusBatches,
  }

  return advanceToNextLivingTurn(nextState, events)
}

export function endCurrentPersonalTurn(
  state: BattleState,
  personalTurnId: PersonalTurnId,
): BattleTransitionResult {
  return endCurrentPersonalTurnInternal(state, personalTurnId)
}

export function startBattleAction(
  state: BattleState,
  input: StartActionInput,
): BattleTransitionResult {
  if (state.personalTurn === null || state.activeAction !== null) {
    return failure(state, 'BATTLE_NOT_READY_FOR_ACTION')
  }

  const result = beginAction(state.personalTurn, input)
  if (!result.ok) return failure(state, result.reason)

  const nextState: BattleState = {
    ...state,
    phase: BattlePhase.ResolvingAction,
    personalTurn: result.turn,
    activeAction: result.action,
    completedSkillResolution: null,
  }

  return {
    ok: true,
    state: appendEvents(nextState, result.events),
    events: result.events,
  }
}

export function completeBattleAction(
  state: BattleState,
  actionId: ActionId,
): BattleTransitionResult {
  if (state.personalTurn === null || state.activeAction === null) {
    return failure(state, 'NO_ACTIVE_ACTION')
  }

  const action = state.activeAction
  if (state.activeSkill !== null) {
    return failure(state, 'SKILL_RESOLUTION_STILL_ACTIVE')
  }
  if (action.skillExecutionId !== null) {
    const completion = state.completedSkillResolution
    if (
      completion === null
      || completion.skillExecutionId !== action.skillExecutionId
      || completion.actionId !== action.actionId
      || completion.personalTurnId !== action.personalTurnId
      || completion.sequenceId !== action.sequenceId
      || !state.resolutionIds.skillExecutionIds.includes(
        action.skillExecutionId,
      )
    ) {
      return failure(state, 'SKILL_RESOLUTION_NOT_COMPLETED')
    }
  }
  const result = finishAction(state.personalTurn, action, actionId)
  if (!result.ok) return failure(state, result.reason)

  const actor = findUnit(state, action.actorId)
  const actorIsAlive = actor !== undefined && isUnitAlive(actor)
  const nextState: BattleState = {
    ...state,
    phase: action.endsTurn || !actorIsAlive
      ? BattlePhase.TurnEnd
      : BattlePhase.AwaitingAction,
    personalTurn: result.turn,
    activeAction: null,
    completedSkillResolution: null,
  }

  if (action.endsTurn || !actorIsAlive) {
    return endCurrentPersonalTurnInternal(
      nextState,
      result.turn.personalTurnId,
      result.events,
    )
  }

  return {
    ok: true,
    state: appendEvents(nextState, result.events),
    events: result.events,
  }
}

export function resolveBattleSkill(
  state: BattleState,
  request: SkillResolutionRequest,
): SkillResolutionResult {
  return resolveSkillTransaction(state, request)
}

function createTurnEndRequestedEvent(state: BattleState): BattleEvent | null {
  const turn = state.personalTurn
  if (turn === null) return null
  return {
    type: 'TURN_END_REQUESTED',
    sequenceId: turn.sequenceId,
    sequenceNumber: turn.sequenceNumber,
    personalTurnId: turn.personalTurnId,
    unitId: turn.unitId,
  }
}

export function requestPlayerEndTurn(
  state: BattleState,
  request: EndTurnRequest,
): EndTurnRequestResult {
  const turn = state.personalTurn
  const unit = turn === null ? undefined : findUnit(state, turn.unitId)
  if (
    turn === null
    || unit === undefined
    || unit.camp !== Camp.Player
    || turn.phase !== PersonalTurnPhase.AwaitingAction
    || state.activeAction !== null
  ) {
    return {
      status: 'invalid',
      state,
      events: [],
      reason: 'PLAYER_TURN_NOT_AWAITING_ACTION',
    }
  }

  const confirmation = request.confirmation ?? EndTurnConfirmation.NotProvided
  if (confirmation === EndTurnConfirmation.Cancelled) {
    return { status: 'cancelled', state, events: [] }
  }

  const requestedEvent = createTurnEndRequestedEvent(state)
  const requestEvents = requestedEvent === null ? [] : [requestedEvent]
  if (
    request.hasLegalAction
    && confirmation !== EndTurnConfirmation.Confirmed
  ) {
    return {
      status: 'confirmationRequired',
      state,
      events: requestEvents,
    }
  }

  const result = endCurrentPersonalTurnInternal(
    state,
    turn.personalTurnId,
    requestEvents,
  )
  if (!result.ok) {
    return {
      status: 'invalid',
      state,
      events: [],
      reason: result.reason,
    }
  }

  return {
    status: 'turnEnded',
    state: result.state,
    events: result.events,
  }
}
