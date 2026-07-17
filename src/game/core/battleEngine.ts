import {
  Camp,
  BattlePhase,
  PersonalTurnPhase,
} from './enums'
import {
  EndTurnConfirmation,
  TrainingExitConfirmation,
} from './commands'
import type { EndTurnRequest } from './commands'
import type {
  ActionContext,
  BattleState,
  PersonalTurnState,
  TurnSequenceState,
} from './contexts'
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
import {
  advanceTurnEndStage,
  advanceTurnStartStage,
  beginPersonalTurnEnd,
  createPersonalTurn,
} from './turnLifecycle'
import type { SkillResolutionRequest } from './attacks'
import type { SkillResolutionResult } from './resolutionTransaction'
import { resolveSkillTransaction } from './resolutionTransaction'
import { advanceBattleStatusDurations } from './statusEngine'
import {
  clearMomentumPressure,
  recalculateMomentumPressure,
} from './momentumPressure'
import { validateBattleStateUnits } from './combatValidation'
import { advanceTemporaryAttributeModifiers } from './temporaryModifiers'

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

export interface BattleEngineExtensions {
  readonly applyUnitBattleStartEffects?: (
    state: BattleState,
    unitId: UnitId,
  ) => BattleTransitionResult
  readonly applyTurnStartAbsoluteEffects?: (
    state: BattleState,
    turn: PersonalTurnState,
  ) => BattleTransitionResult
  readonly resetUnitTurnCounters?: (
    state: BattleState,
    turn: PersonalTurnState,
  ) => BattleTransitionResult
  readonly applySequenceStartEffects?: (
    state: BattleState,
    sequence: TurnSequenceState,
  ) => BattleTransitionResult
  readonly applyTurnStartPreSystemEffects?: (
    state: BattleState,
    turn: PersonalTurnState,
  ) => BattleTransitionResult
  readonly applyTurnStartPostSystemEffects?: (
    state: BattleState,
    turn: PersonalTurnState,
  ) => BattleTransitionResult
  readonly applyTurnStartForcedChoices?: (
    state: BattleState,
    turn: PersonalTurnState,
  ) => BattleTransitionResult
  readonly applyUnitPassiveEffects?: (
    state: BattleState,
    turn: PersonalTurnState,
  ) => BattleTransitionResult
  readonly applyAfterActionEffects?: (
    state: BattleState,
    action: ActionContext,
  ) => BattleTransitionResult
  readonly applyUnitTurnEndEffects?: (
    state: BattleState,
    turn: PersonalTurnState,
  ) => BattleTransitionResult
  readonly runAutomaticAction?: (
    state: BattleState,
  ) => BattleTransitionResult | null
}

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

export type TrainingExitRequestStatus =
  | 'confirmationRequired'
  | 'cancelled'
  | 'exited'
  | 'invalid'

export interface TrainingExitRequestResult {
  readonly status: TrainingExitRequestStatus
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
  readonly returnToModeSelection: boolean
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

function applySequenceStartEffects(
  state: BattleState,
  sequence: TurnSequenceState,
  extensions?: BattleEngineExtensions,
): BattleTransitionResult {
  const result = extensions?.applySequenceStartEffects?.(state, sequence)
  if (result === undefined) return { ok: true, state, events: [] }
  if (!result.ok) return result
  const currentSequence = result.state.turnSequence
  if (
    result.state.phase !== BattlePhase.SequenceStart
    || currentSequence === null
    || currentSequence.sequenceId !== sequence.sequenceId
    || result.state.personalTurn !== null
    || result.state.activeAction !== null
  ) return failure(state, 'SEQUENCE_START_EFFECTS_INVALID_STATE')
  return {
    ok: true,
    state: { ...result.state, events: state.events },
    events: result.events,
  }
}

function applyBattleStartEffects(
  state: BattleState,
  extensions?: BattleEngineExtensions,
): BattleTransitionResult {
  const queue = createTurnQueue(state.units)
  if (!queue.ok) return failure(state, queue.reason)
  let currentState = state
  const events: BattleEvent[] = []
  for (const entry of queue.queue) {
    const result = extensions?.applyUnitBattleStartEffects?.(
      currentState,
      entry.unitId,
    )
    if (result === undefined) continue
    if (!result.ok) return failure(state, result.reason)
    if (
      result.state.phase !== BattlePhase.Setup
      || result.state.turnSequence !== null
      || result.state.personalTurn !== null
      || result.state.activeAction !== null
    ) return failure(state, 'BATTLE_START_EFFECTS_INVALID_STATE')
    currentState = { ...result.state, events: state.events }
    events.push(...result.events)
  }
  return {
    ok: true,
    state: appendEvents({ ...currentState, events: state.events }, events),
    events,
  }
}

function findUnit(state: BattleState, unitId: UnitId): UnitState | undefined {
  return state.units.find((unit) => unit.id === unitId)
}

function hasLivingHostileUnit(state: BattleState, camp: Camp): boolean {
  return [
    ...state.units,
    ...(state.offFieldUnits ?? []).map((entry) => entry.unit),
  ].some((unit) => (
    unit.camp !== camp && isUnitAlive(unit)
  ))
}

function isBattleStopped(state: BattleState): boolean {
  return state.phase === BattlePhase.Paused
    || state.phase === BattlePhase.Finished
}

function hasLivingPlayerUnit(state: BattleState): boolean {
  return [
    ...state.units,
    ...(state.offFieldUnits ?? []).map((entry) => entry.unit),
  ].some((unit) => (
    unit.camp === Camp.Player && isUnitAlive(unit)
  ))
}

export function checkBattleCompletion(
  state: BattleState,
): BattleTransitionResult {
  if (state.trainingSession !== null && state.trainingSession !== undefined) {
    return applyTrainingCompletion(state)
  }
  const knownUnits = [
    ...state.units,
    ...(state.offFieldUnits ?? []).map((entry) => entry.unit),
  ]
  const hadPlayers = knownUnits.some((unit) => unit.camp === Camp.Player)
  const hadEnemies = knownUnits.some((unit) => unit.camp === Camp.Enemy)
  const outcome = hadPlayers && !hasLivingPlayerUnit(state)
    ? 'playerDefeat'
    : hadEnemies && !hasLivingHostileUnit(state, Camp.Player)
      ? 'playerVictory'
      : null
  if (outcome === null) return { ok: true, state, events: [] }
  const event: BattleEvent = {
    type: 'BATTLE_FINISHED',
    outcome,
    reason: outcome === 'playerVictory'
      ? 'ALL_ENEMY_UNITS_DEFEATED'
      : 'ALL_PLAYER_UNITS_DEFEATED',
  }
  const finished: BattleState = {
    ...state,
    phase: BattlePhase.Finished,
    outcome,
    activeAction: null,
    activeSkill: null,
    actionRollbackState: null,
  }
  return { ok: true, state: appendEvents(finished, [event]), events: [event] }
}

function hasDefeatedFiniteHealthBoss(state: BattleState): boolean {
  return state.units.some((unit) => (
    unit.camp === Camp.Enemy
    && unit.isBoss
    && !unit.hasInfiniteHealth
    && !isUnitAlive(unit)
  ))
}

function applyTrainingCompletion(state: BattleState): BattleTransitionResult {
  if (state.trainingSession === null || state.trainingSession === undefined) {
    return { ok: true, state, events: [] }
  }

  if (!hasLivingPlayerUnit(state)) {
    const event: BattleEvent = {
      type: 'TRAINING_PAUSED',
      reason: 'ALL_PLAYER_UNITS_DEFEATED',
    }
    const paused: BattleState = {
      ...state,
      phase: BattlePhase.Paused,
      activeAction: null,
      activeSkill: null,
      actionRollbackState: null,
    }
    return { ok: true, state: appendEvents(paused, [event]), events: [event] }
  }

  if (hasDefeatedFiniteHealthBoss(state)) {
    const event: BattleEvent = {
      type: 'TRAINING_FINISHED',
      reason: 'FINITE_HEALTH_BOSS_DEFEATED',
    }
    const finished: BattleState = {
      ...state,
      phase: BattlePhase.Finished,
      activeAction: null,
      activeSkill: null,
      actionRollbackState: null,
    }
    return { ok: true, state: appendEvents(finished, [event]), events: [event] }
  }

  return { ok: true, state, events: [] }
}

function createSequenceId(sequenceNumber: number): TurnSequenceId {
  return `sequence:${sequenceNumber}` as TurnSequenceId
}

function createSequenceState(
  state: BattleState,
  sequenceNumber: number,
): TurnSequenceState | 'INVALID_UNIT_BASE_ATTACK' {
  const queue = createTurnQueue(state.units)
  if (!queue.ok) return queue.reason
  return {
    sequenceId: createSequenceId(sequenceNumber),
    sequenceNumber,
    queue: queue.queue,
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

function advanceToNextLivingTurnStart(
  state: BattleState,
  precedingEvents: readonly BattleEvent[],
  extensions?: BattleEngineExtensions,
): BattleTransitionResult {
  if (isBattleStopped(state)) {
    return { ok: true, state, events: [] }
  }
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

    const created = createPersonalTurn(sequence, unit.id, state.units)
    if (!created.ok) return failure(state, created.reason)
    let turn = created.turn
    let turnState: BattleState = {
      ...state,
      phase: BattlePhase.TurnStart,
      turnSequence: sequence,
      personalTurn: turn,
      activeAction: null,
    }
    events.push(...created.events)
    while (turn.phase !== PersonalTurnPhase.AwaitingAction) {
      const stageResult = advanceTurnStartStage(turn, state.units)
      if (!stageResult.ok) return failure(state, stageResult.reason)
      turn = stageResult.turn
      turnState = { ...turnState, personalTurn: turn }
      events.push(...stageResult.events)
      if (turn.phase === PersonalTurnPhase.StartingAbsoluteEffects) {
        const result = extensions?.applyTurnStartAbsoluteEffects?.(
          turnState,
          turn,
        )
        if (result !== undefined) {
          if (!result.ok) return failure(state, result.reason)
          const nextTurn = result.state.personalTurn
          if (
            nextTurn === null
            || nextTurn.personalTurnId !== turn.personalTurnId
            || nextTurn.phase !== PersonalTurnPhase.StartingAbsoluteEffects
          ) return failure(state, 'TURN_START_ABSOLUTE_EFFECTS_INVALID_TURN')
          turnState = { ...result.state, events: turnState.events }
          turn = nextTurn
          events.push(...result.events)
        }
      }
      if (turn.phase === PersonalTurnPhase.StartingTurnCounterReset) {
        const result = extensions?.resetUnitTurnCounters?.(turnState, turn)
        if (result !== undefined) {
          if (!result.ok) return failure(state, result.reason)
          const nextTurn = result.state.personalTurn
          if (
            nextTurn === null
            || nextTurn.personalTurnId !== turn.personalTurnId
            || nextTurn.phase !== PersonalTurnPhase.StartingTurnCounterReset
          ) return failure(state, 'TURN_COUNTER_RESET_INVALID_TURN')
          turnState = { ...result.state, events: turnState.events }
          turn = nextTurn
          events.push(...result.events)
        }
      }
      if (turn.phase === PersonalTurnPhase.StartingDelayedEffects) {
        const preSystemResult = extensions?.applyTurnStartPreSystemEffects?.(
          turnState,
          turn,
        )
        if (preSystemResult !== undefined) {
          if (!preSystemResult.ok) return failure(state, preSystemResult.reason)
          const preSystemTurn = preSystemResult.state.personalTurn
          if (
            preSystemTurn === null
            || preSystemTurn.personalTurnId !== turn.personalTurnId
            || preSystemTurn.phase !== PersonalTurnPhase.StartingDelayedEffects
          ) return failure(state, 'TURN_START_PRE_SYSTEM_EFFECTS_INVALID_TURN')
          turnState = {
            ...preSystemResult.state,
            events: turnState.events,
          }
          turn = preSystemTurn
          events.push(...preSystemResult.events)
        }
      }
      if (turn.phase === PersonalTurnPhase.StartingSystemRules) {
        const pressureResult = recalculateMomentumPressure(
          turnState,
          unit.id,
          turn,
        )
        if (!pressureResult.ok) return failure(state, pressureResult.reason)
        turnState = pressureResult.state
        events.push(...pressureResult.events)
        const postSystemResult = extensions?.applyTurnStartPostSystemEffects?.(
          turnState,
          turn,
        )
        if (postSystemResult !== undefined) {
          if (!postSystemResult.ok) return failure(state, postSystemResult.reason)
          const postSystemTurn = postSystemResult.state.personalTurn
          if (
            postSystemTurn === null
            || postSystemTurn.personalTurnId !== turn.personalTurnId
            || postSystemTurn.phase !== PersonalTurnPhase.StartingSystemRules
          ) return failure(state, 'TURN_START_POST_SYSTEM_EFFECTS_INVALID_TURN')
          turnState = {
            ...postSystemResult.state,
            events: turnState.events,
          }
          turn = postSystemTurn
          events.push(...postSystemResult.events)
        }
      }
      if (
        turn.phase === PersonalTurnPhase.StartingUnitPassives
        && !turn.unitPassiveEffectsApplied
      ) {
        const passiveResult = extensions?.applyUnitPassiveEffects?.(
          turnState,
          turn,
        )
        if (passiveResult !== undefined) {
          if (!passiveResult.ok) return failure(state, passiveResult.reason)
          const passiveTurn = passiveResult.state.personalTurn
          if (
            passiveTurn === null
            || passiveTurn.personalTurnId !== turn.personalTurnId
            || passiveTurn.phase !== PersonalTurnPhase.StartingUnitPassives
          ) return failure(state, 'UNIT_PASSIVE_EFFECTS_INVALID_TURN')
          turnState = {
            ...passiveResult.state,
            events: turnState.events,
          }
          turn = passiveTurn
          events.push(...passiveResult.events)
        }
        turn = { ...turn, unitPassiveEffectsApplied: true }
        turnState = { ...turnState, personalTurn: turn }
      }
      if (turn.phase === PersonalTurnPhase.StartingForcedChoices) {
        const result = extensions?.applyTurnStartForcedChoices?.(turnState, turn)
        if (result !== undefined) {
          if (!result.ok) return failure(state, result.reason)
          const nextTurn = result.state.personalTurn
          if (
            nextTurn === null
            || nextTurn.personalTurnId !== turn.personalTurnId
            || nextTurn.phase !== PersonalTurnPhase.StartingForcedChoices
          ) return failure(state, 'TURN_START_FORCED_CHOICES_INVALID_TURN')
          turnState = { ...result.state, events: turnState.events }
          turn = nextTurn
          events.push(...result.events)
        }
      }
    }
    const nextState: BattleState = {
      ...turnState,
      phase: BattlePhase.AwaitingAction,
      turnSequence: sequence,
      personalTurn: turn,
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
  if (typeof nextSequence === 'string') return failure(state, nextSequence)
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

  const sequenceEffects = applySequenceStartEffects(
    nextState,
    nextSequence,
    extensions,
  )
  if (!sequenceEffects.ok) return failure(state, sequenceEffects.reason)
  const advanced = advanceToNextLivingTurnStart(
    sequenceEffects.state,
    [...events, ...sequenceEffects.events],
    extensions,
  )
  if (!advanced.ok) return failure(state, advanced.reason)
  return {
    ok: true,
    state: advanced.state,
    events: advanced.events,
  }
}

function runAutomaticActions(
  state: BattleState,
  extensions: BattleEngineExtensions | undefined,
  initialRollbackState: BattleState,
): BattleTransitionResult {
  if (isBattleStopped(state)) return { ok: true, state, events: [] }
  if (extensions?.runAutomaticAction === undefined) {
    return { ok: true, state, events: [] }
  }

  let currentState = state
  let rollbackState = initialRollbackState
  const events: BattleEvent[] = []
  while (true) {
    const automaticActor = currentState.personalTurn === null
      ? undefined
      : findUnit(currentState, currentState.personalTurn.unitId)
    const automaticResult = extensions.runAutomaticAction(currentState)
    if (automaticResult === null) {
      return { ok: true, state: currentState, events }
    }
    if (!automaticResult.ok) {
      return failure(rollbackState, automaticResult.reason)
    }
    if (automaticResult.state === currentState) {
      return failure(rollbackState, 'AUTOMATIC_ACTION_DID_NOT_PROGRESS')
    }

    currentState = automaticResult.state
    rollbackState = currentState
    events.push(...automaticResult.events)
    if (isBattleStopped(currentState)) {
      return { ok: true, state: currentState, events }
    }
    if (
      automaticActor !== undefined
      && !hasLivingHostileUnit(currentState, automaticActor.camp)
    ) {
      return { ok: true, state: currentState, events }
    }

    const advanced = advanceToNextLivingTurnStart(currentState, [], extensions)
    if (!advanced.ok) return failure(rollbackState, advanced.reason)
    currentState = advanced.state
    events.push(...advanced.events)
  }
}

function continueAfterCommittedTurn(
  state: BattleState,
  extensions?: BattleEngineExtensions,
): BattleTransitionResult {
  if (isBattleStopped(state)) return { ok: true, state, events: [] }
  const advanced = advanceToNextLivingTurnStart(state, [], extensions)
  if (!advanced.ok) return failure(state, advanced.reason)
  const automatic = runAutomaticActions(
    advanced.state,
    extensions,
    state,
  )
  if (!automatic.ok) return automatic
  return {
    ok: true,
    state: automatic.state,
    events: [...advanced.events, ...automatic.events],
  }
}

export function startBattleSequence(
  state: BattleState,
  extensions?: BattleEngineExtensions,
): BattleTransitionResult {
  if (isBattleStopped(state)) return failure(state, 'BATTLE_NOT_ACTIVE')
  const invalidUnits = validateBattleStateUnits(state)
  if (invalidUnits !== null) return failure(state, invalidUnits)
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
  if (typeof sequence === 'string') return failure(state, sequence)
  const event = createSequenceStartedEvent(sequence)
  const nextState: BattleState = {
    ...state,
    phase: BattlePhase.SequenceStart,
    turnSequence: sequence,
  }

  if (sequence.queue.length === 0) {
    return stopBecauseNoEligibleUnits(nextState, sequence, [event])
  }

  const sequenceEffects = applySequenceStartEffects(
    nextState,
    sequence,
    extensions,
  )
  if (!sequenceEffects.ok) return failure(state, sequenceEffects.reason)
  const advanced = advanceToNextLivingTurnStart(
    sequenceEffects.state,
    [event, ...sequenceEffects.events],
    extensions,
  )
  if (!advanced.ok) return failure(state, advanced.reason)
  const automatic = runAutomaticActions(
    advanced.state,
    extensions,
    state,
  )
  if (!automatic.ok) return automatic
  return {
    ok: true,
    state: automatic.state,
    events: [...advanced.events, ...automatic.events],
  }
}

export function startTrainingBattle(
  state: BattleState,
  extensions?: BattleEngineExtensions,
): BattleTransitionResult {
  if (state.trainingSession !== null && state.trainingSession !== undefined) {
    return failure(state, 'TRAINING_ALREADY_STARTED')
  }
  if (state.phase !== BattlePhase.Setup) {
    return failure(state, 'TRAINING_MUST_START_FROM_SETUP')
  }

  const initialState: BattleState = {
    ...state,
    trainingSession: null,
  }
  const withSession: BattleState = {
    ...state,
    trainingSession: { initialState },
  }
  const started = applyBattleStartEffects(withSession, extensions)
  if (!started.ok) return failure(state, started.reason)
  const sequence = startBattleSequence(started.state, extensions)
  if (!sequence.ok) return sequence
  return {
    ok: true,
    state: sequence.state,
    events: [...started.events, ...sequence.events],
  }
}

export function resetTrainingBattle(
  state: BattleState,
  extensions?: BattleEngineExtensions,
): BattleTransitionResult {
  const session = state.trainingSession
  if (session === null || session === undefined) {
    return failure(state, 'TRAINING_SESSION_NOT_FOUND')
  }
  if (state.phase === BattlePhase.ResolvingAction) {
    return failure(state, 'TRAINING_RESET_DURING_ACTION')
  }

  const resetState: BattleState = {
    ...session.initialState,
    trainingSession: session,
  }
  const started = applyBattleStartEffects(resetState, extensions)
  if (!started.ok) return failure(state, started.reason)
  const sequence = startBattleSequence(started.state, extensions)
  if (!sequence.ok) return sequence
  return {
    ok: true,
    state: sequence.state,
    events: [...started.events, ...sequence.events],
  }
}

export function pauseTrainingBattle(
  state: BattleState,
): BattleTransitionResult {
  if (state.trainingSession === null || state.trainingSession === undefined) {
    return failure(state, 'TRAINING_SESSION_NOT_FOUND')
  }
  if (isBattleStopped(state)) return failure(state, 'BATTLE_NOT_ACTIVE')
  if (state.phase === BattlePhase.ResolvingAction) {
    return failure(state, 'TRAINING_PAUSE_DURING_ACTION')
  }

  const event: BattleEvent = {
    type: 'TRAINING_PAUSED',
    reason: 'MANUAL_PAUSE',
  }
  const paused: BattleState = {
    ...state,
    phase: BattlePhase.Paused,
    activeAction: null,
    activeSkill: null,
    actionRollbackState: null,
  }
  return {
    ok: true,
    state: appendEvents(paused, [event]),
    events: [event],
  }
}

function commitCurrentPersonalTurnEnd(
  state: BattleState,
  personalTurnId: PersonalTurnId,
  precedingEvents: readonly BattleEvent[] = [],
  extensions?: BattleEngineExtensions,
  rollbackState: BattleState = state,
): BattleTransitionResult {
  const turn = state.personalTurn
  const sequence = state.turnSequence
  if (turn === null || sequence === null) {
    return failure(rollbackState, 'NO_ACTIVE_PERSONAL_TURN')
  }
  if (turn.personalTurnId !== personalTurnId) {
    return failure(rollbackState, 'PERSONAL_TURN_ID_DOES_NOT_MATCH')
  }
  if (state.activeAction !== null) {
    return failure(rollbackState, 'ACTION_STILL_RESOLVING')
  }

  const unit = findUnit(state, turn.unitId)
  const actorIsAlive = unit !== undefined && isUnitAlive(unit)
  const events = [...precedingEvents]
  let turnState = state
  let endingTurn = turn
  if (!actorIsAlive) {
    const ended = beginPersonalTurnEnd(endingTurn, false, state.units)
    if (!ended.ok) return failure(rollbackState, ended.reason)
    endingTurn = ended.turn
    events.push(...ended.events)
  } else {
    if (endingTurn.phase === PersonalTurnPhase.AwaitingAction) {
      const beginning = beginPersonalTurnEnd(endingTurn, true, state.units)
      if (!beginning.ok) return failure(rollbackState, beginning.reason)
      endingTurn = beginning.turn
      events.push(...beginning.events)
    } else if (endingTurn.phase !== PersonalTurnPhase.Ending) {
      return failure(rollbackState, 'PERSONAL_TURN_NOT_READY_TO_END')
    }
    turnState = {
      ...turnState,
      phase: BattlePhase.TurnEnd,
      personalTurn: endingTurn,
    }
    while (endingTurn.phase !== PersonalTurnPhase.Ended) {
      const stageResult = advanceTurnEndStage(endingTurn, state.units)
      if (!stageResult.ok) return failure(rollbackState, stageResult.reason)
      endingTurn = stageResult.turn
      turnState = { ...turnState, personalTurn: endingTurn }
      events.push(...stageResult.events)
      if (endingTurn.phase === PersonalTurnPhase.EndingUnitSpecificEffects) {
        const turnEndResult = extensions?.applyUnitTurnEndEffects?.(
          turnState,
          endingTurn,
        )
        if (turnEndResult !== undefined) {
          if (!turnEndResult.ok) {
            return failure(rollbackState, turnEndResult.reason)
          }
          const turnEndTurn = turnEndResult.state.personalTurn
          if (
            turnEndTurn === null
            || turnEndTurn.personalTurnId !== endingTurn.personalTurnId
            || turnEndTurn.phase
              !== PersonalTurnPhase.EndingUnitSpecificEffects
            || turnEndResult.state.activeAction !== null
          ) return failure(rollbackState, 'UNIT_TURN_END_EFFECTS_INVALID_TURN')
          turnState = {
            ...turnEndResult.state,
            events: turnState.events,
          }
          endingTurn = turnEndTurn
          events.push(...turnEndResult.events)
        }
      }
      if (endingTurn.phase === PersonalTurnPhase.EndingSpecialVariables) {
        const pressureResult = clearMomentumPressure(
          turnState,
          turn.unitId,
          endingTurn,
        )
        if (!pressureResult.ok) {
          return failure(rollbackState, pressureResult.reason)
        }
        turnState = pressureResult.state
        events.push(...pressureResult.events)
      }
      if (endingTurn.phase === PersonalTurnPhase.EndingStatusDurations) {
        const durationResult = advanceBattleStatusDurations(
          turnState,
          turn.unitId,
        )
        if (!durationResult.ok) {
          return failure(rollbackState, durationResult.reason)
        }
        turnState = {
          ...durationResult.state,
          events: turnState.events,
        }
        events.push(...durationResult.events)
      }
      if (endingTurn.phase === PersonalTurnPhase.EndingTemporaryModifiers) {
        const modifierResult = advanceTemporaryAttributeModifiers(
          turnState,
          turn.unitId,
          turn.personalTurnId,
        )
        if (!modifierResult.ok) {
          return failure(rollbackState, modifierResult.reason)
        }
        turnState = {
          ...modifierResult.state,
          events: turnState.events,
        }
        events.push(...modifierResult.events)
      }
    }
  }
  const nextState: BattleState = {
    ...turnState,
    phase: BattlePhase.TurnEnd,
    personalTurn: endingTurn,
    turnSequence: {
      ...sequence,
      currentIndex: sequence.currentIndex + 1,
    },
  }

  return {
    ok: true,
    state: appendEvents(nextState, events),
    events,
  }
}

export function endCurrentPersonalTurn(
  state: BattleState,
  personalTurnId: PersonalTurnId,
  extensions?: BattleEngineExtensions,
): BattleTransitionResult {
  if (isBattleStopped(state)) return failure(state, 'BATTLE_NOT_ACTIVE')
  const invalidUnits = validateBattleStateUnits(state)
  if (invalidUnits !== null) return failure(state, invalidUnits)
  const committed = commitCurrentPersonalTurnEnd(
    state,
    personalTurnId,
    [],
    extensions,
  )
  if (!committed.ok) return committed
  const continued = continueAfterCommittedTurn(committed.state, extensions)
  if (!continued.ok) return continued
  return {
    ok: true,
    state: continued.state,
    events: [...committed.events, ...continued.events],
  }
}

export function startBattleAction(
  state: BattleState,
  input: StartActionInput,
): BattleTransitionResult {
  if (isBattleStopped(state)) return failure(state, 'BATTLE_NOT_ACTIVE')
  const invalidUnits = validateBattleStateUnits(state)
  if (invalidUnits !== null) return failure(state, invalidUnits)
  if (state.personalTurn === null || state.activeAction !== null) {
    return failure(state, 'BATTLE_NOT_READY_FOR_ACTION')
  }

  const result = beginAction(state.personalTurn, input, state.units)
  if (!result.ok) return failure(state, result.reason)

  const nextState: BattleState = {
    ...state,
    phase: BattlePhase.ResolvingAction,
    personalTurn: result.turn,
    activeAction: result.action,
    completedSkillResolution: null,
    completedResourcePayment: null,
    actionRollbackState: state,
  }

  return {
    ok: true,
    state: appendEvents(nextState, result.events),
    events: result.events,
  }
}

export function completeCurrentBattleAction(
  state: BattleState,
  actionId: ActionId,
  extensions?: BattleEngineExtensions,
): BattleTransitionResult {
  if (isBattleStopped(state)) return failure(state, 'BATTLE_NOT_ACTIVE')
  const invalidUnits = validateBattleStateUnits(state)
  if (invalidUnits !== null) return failure(state, invalidUnits)
  if (state.personalTurn === null || state.activeAction === null) {
    return failure(state, 'NO_ACTIVE_ACTION')
  }

  const action = state.activeAction
  if (state.activeSkill !== null) {
    return failure(state, 'SKILL_RESOLUTION_STILL_ACTIVE')
  }
  if (action.skillExecutionId !== null) {
    const payment = state.completedResourcePayment
    const completion = state.completedSkillResolution
    if (
      payment === null
      || payment.skillExecutionId !== action.skillExecutionId
      || payment.actionId !== action.actionId
      || payment.personalTurnId !== action.personalTurnId
      || payment.sequenceId !== action.sequenceId
      || payment.payerUnitId !== action.actorId
      || !state.resourcePaymentRegistry.paidSkillExecutionIds.includes(
        action.skillExecutionId,
      )
      || completion === null
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
  const result = finishAction(state.personalTurn, action, actionId, state.units)
  if (!result.ok) return failure(state, result.reason)

  const rollbackState = state.actionRollbackState ?? state
  const completedTurn: PersonalTurnState = {
    ...result.turn,
    phase: PersonalTurnPhase.AwaitingAction,
  }
  const completedState = appendEvents({
    ...state,
    phase: BattlePhase.AwaitingAction,
    personalTurn: completedTurn,
    activeAction: null,
    completedSkillResolution: null,
    completedResourcePayment: null,
  }, result.events)
  const battleCompletion = checkBattleCompletion(completedState)
  if (!battleCompletion.ok) return battleCompletion
  if (isBattleStopped(battleCompletion.state)) {
    return {
      ok: true,
      state: battleCompletion.state,
      events: [...result.events, ...battleCompletion.events],
    }
  }
  const actorAfterSkill = findUnit(completedState, action.actorId)
  const afterAction = actorAfterSkill !== undefined && isUnitAlive(actorAfterSkill)
    ? extensions?.applyAfterActionEffects?.(
      completedState,
      action,
    )
    : undefined
  if (afterAction !== undefined && !afterAction.ok) {
    return failure(rollbackState, afterAction.reason)
  }

  let afterActionState = completedState
  let afterActionEvents: readonly BattleEvent[] = []
  if (afterAction !== undefined) {
    const afterActionTurn = afterAction.state.personalTurn
    if (
      afterActionTurn === null
      || afterActionTurn.personalTurnId !== completedTurn.personalTurnId
      || afterActionTurn.phase !== PersonalTurnPhase.AwaitingAction
      || afterAction.state.activeAction !== null
    ) return failure(rollbackState, 'AFTER_ACTION_EFFECTS_INVALID_TURN')
    afterActionEvents = afterAction.events
    afterActionState = appendEvents({
      ...afterAction.state,
      events: completedState.events,
    }, afterActionEvents)
  }

  const finalTurn = afterActionState.personalTurn
  if (
    finalTurn === null
    || finalTurn.personalTurnId !== completedTurn.personalTurnId
    || finalTurn.phase !== PersonalTurnPhase.AwaitingAction
    || afterActionState.activeAction !== null
  ) return failure(rollbackState, 'AFTER_ACTION_EFFECTS_INVALID_TURN')

  const actor = findUnit(afterActionState, action.actorId)
  const actorIsAlive = actor !== undefined && isUnitAlive(actor)
  const shouldEndTurn = action.endsTurn || !actorIsAlive
  const turnEndRollbackState: BattleState = {
    ...afterActionState,
    actionRollbackState: null,
  }
  const nextState: BattleState = {
    ...turnEndRollbackState,
    phase: shouldEndTurn ? BattlePhase.TurnEnd : BattlePhase.AwaitingAction,
    personalTurn: shouldEndTurn
      ? { ...finalTurn, phase: PersonalTurnPhase.Ending }
      : finalTurn,
  }
  const actionEvents = [...result.events, ...afterActionEvents]

  if (shouldEndTurn) {
    const ended = commitCurrentPersonalTurnEnd(
      nextState,
      completedTurn.personalTurnId,
      [],
      extensions,
      turnEndRollbackState,
    )
    if (!ended.ok) return ended
    return {
      ok: true,
      state: ended.state,
      events: [...actionEvents, ...ended.events],
    }
  }

  return {
    ok: true,
    state: nextState,
    events: actionEvents,
  }
}

export function completeBattleAction(
  state: BattleState,
  actionId: ActionId,
  extensions?: BattleEngineExtensions,
): BattleTransitionResult {
  const committed = completeCurrentBattleAction(state, actionId, extensions)
  if (!committed.ok) return committed
  if (committed.state.personalTurn?.phase !== PersonalTurnPhase.Ended) {
    return committed
  }

  const continued = continueAfterCommittedTurn(committed.state, extensions)
  if (!continued.ok) return continued
  return {
    ok: true,
    state: continued.state,
    events: [...committed.events, ...continued.events],
  }
}

export function resolveBattleSkill(
  state: BattleState,
  request: SkillResolutionRequest,
): SkillResolutionResult {
  if (isBattleStopped(state)) {
    return { ok: false, state, events: [], reason: 'NOT_AT_SKILL_RESOLUTION_BOUNDARY' }
  }
  const invalidUnits = validateBattleStateUnits(state)
  if (invalidUnits !== null) {
    return { ok: false, state, events: [], reason: invalidUnits }
  }
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
  extensions?: BattleEngineExtensions,
): EndTurnRequestResult {
  if (isBattleStopped(state)) {
    return {
      status: 'invalid',
      state,
      events: [],
      reason: 'BATTLE_NOT_ACTIVE',
    }
  }
  const invalidUnits = validateBattleStateUnits(state)
  if (invalidUnits !== null) {
    return {
      status: 'invalid',
      state,
      events: [],
      reason: invalidUnits,
    }
  }
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

  const committed = commitCurrentPersonalTurnEnd(
    state,
    turn.personalTurnId,
    requestEvents,
    extensions,
  )
  if (!committed.ok) {
    return {
      status: 'invalid',
      state,
      events: [],
      reason: committed.reason,
    }
  }

  const result = continueAfterCommittedTurn(committed.state, extensions)
  if (!result.ok) {
    return {
      status: 'invalid',
      state: result.state,
      events: [],
      reason: result.reason,
    }
  }

  return {
    status: 'turnEnded',
    state: result.state,
    events: [...committed.events, ...result.events],
  }
}

export function requestTrainingExit(
  state: BattleState,
  confirmation: TrainingExitConfirmation = TrainingExitConfirmation.NotProvided,
): TrainingExitRequestResult {
  if (state.trainingSession === null || state.trainingSession === undefined) {
    return {
      status: 'invalid',
      state,
      events: [],
      returnToModeSelection: false,
      reason: 'TRAINING_SESSION_NOT_FOUND',
    }
  }
  if (confirmation === TrainingExitConfirmation.Cancelled) {
    return {
      status: 'cancelled',
      state,
      events: [],
      returnToModeSelection: false,
    }
  }
  if (confirmation !== TrainingExitConfirmation.Confirmed) {
    return {
      status: 'confirmationRequired',
      state,
      events: [],
      returnToModeSelection: false,
    }
  }

  const event: BattleEvent = { type: 'TRAINING_EXIT_CONFIRMED' }
  const exited: BattleState = {
    ...state,
    phase: BattlePhase.Finished,
    activeAction: null,
    activeSkill: null,
    actionRollbackState: null,
  }
  return {
    status: 'exited',
    state: appendEvents(exited, [event]),
    events: [event],
    returnToModeSelection: true,
  }
}
