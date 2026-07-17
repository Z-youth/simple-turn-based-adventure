import {
  PersonalTurnPhase,
  TurnEndStage,
  TurnStartStage,
} from './enums'
import type { TurnEndStage as TurnEndStageType } from './enums'
import type { TurnStartStage as TurnStartStageType } from './enums'
import type { PersonalTurnState, TurnSequenceState } from './contexts'
import type { BattleEvent } from './events'
import type { PersonalTurnId, UnitId } from './identifiers'
import type { UnitState } from './units'
import { validateBattleRuntimeUnits } from './combatValidation'

export const TURN_START_STAGE_ORDER: readonly TurnStartStageType[] = [
  TurnStartStage.AbsoluteEffects,
  TurnStartStage.TurnCounterReset,
  TurnStartStage.DelayedEffects,
  TurnStartStage.UnitPassives,
  TurnStartStage.SystemRules,
  TurnStartStage.StatusEffects,
  TurnStartStage.ForcedChoices,
]

export const TURN_END_STAGE_ORDER: readonly TurnEndStageType[] = [
  TurnEndStage.TriggeredEffects,
  TurnEndStage.UnitSpecificEffects,
  TurnEndStage.StatusEffects,
  TurnEndStage.SpecialVariables,
  TurnEndStage.StatusDurations,
  TurnEndStage.TemporaryModifiers,
]

export interface TurnLifecycleSuccess {
  readonly ok: true
  readonly turn: PersonalTurnState
  readonly events: readonly BattleEvent[]
}

export interface TurnLifecycleFailure {
  readonly ok: false
  readonly reason: string
}

export type TurnLifecycleResult = TurnLifecycleSuccess | TurnLifecycleFailure

function validateLifecycleUnits(
  units: readonly UnitState[],
  unitId: UnitId,
): string | null {
  const invalidUnits = validateBattleRuntimeUnits(units)
  if (invalidUnits !== null) return invalidUnits
  return units.some((unit) => unit.id === unitId)
    ? null
    : 'TURN_UNIT_NOT_FOUND'
}

function createPersonalTurnId(
  sequence: TurnSequenceState,
  unitId: UnitId,
): PersonalTurnId {
  return `${sequence.sequenceId}:turn:${sequence.currentIndex}:${unitId}` as PersonalTurnId
}

function getTurnEventBase(turn: PersonalTurnState) {
  return {
    sequenceId: turn.sequenceId,
    sequenceNumber: turn.sequenceNumber,
    personalTurnId: turn.personalTurnId,
    unitId: turn.unitId,
  }
}

function startStageEnteredEvent(
  turn: PersonalTurnState,
  stage: TurnStartStageType,
): BattleEvent {
  return {
    type: 'TURN_START_STAGE_ENTERED',
    ...getTurnEventBase(turn),
    stage,
  }
}

function startStageCompletedEvent(
  turn: PersonalTurnState,
  stage: TurnStartStageType,
): BattleEvent {
  return {
    type: 'TURN_START_STAGE_COMPLETED',
    ...getTurnEventBase(turn),
    stage,
  }
}

function endStageEnteredEvent(
  turn: PersonalTurnState,
  stage: TurnEndStageType,
): BattleEvent {
  return {
    type: 'TURN_END_STAGE_ENTERED',
    ...getTurnEventBase(turn),
    stage,
  }
}

function endStageCompletedEvent(
  turn: PersonalTurnState,
  stage: TurnEndStageType,
): BattleEvent {
  return {
    type: 'TURN_END_STAGE_COMPLETED',
    ...getTurnEventBase(turn),
    stage,
  }
}

function turnEndedEvent(
  turn: PersonalTurnState,
  skippedEndStagesBecauseDead: boolean,
): BattleEvent {
  return {
    type: 'TURN_ENDED',
    ...getTurnEventBase(turn),
    skippedEndStagesBecauseDead,
  }
}

export function createPersonalTurn(
  sequence: TurnSequenceState,
  unitId: UnitId,
  units: readonly UnitState[],
): TurnLifecycleResult {
  const invalidUnits = validateLifecycleUnits(units, unitId)
  if (invalidUnits !== null) return { ok: false, reason: invalidUnits }
  const turn: PersonalTurnState = {
    personalTurnId: createPersonalTurnId(sequence, unitId),
    sequenceId: sequence.sequenceId,
    unitId,
    sequenceNumber: sequence.sequenceNumber,
    phase: PersonalTurnPhase.NotStarted,
    unitPassiveEffectsApplied: false,
    startedActionIds: [],
    completedActionIds: [],
    countedActionCount: 0,
  }

  return {
    ok: true,
    turn,
    events: [{ type: 'TURN_STARTED', ...getTurnEventBase(turn) }],
  }
}

export function advanceTurnStartStage(
  turn: PersonalTurnState,
  units: readonly UnitState[],
): TurnLifecycleResult {
  const invalidUnits = validateLifecycleUnits(units, turn.unitId)
  if (invalidUnits !== null) return { ok: false, reason: invalidUnits }
  switch (turn.phase) {
    case PersonalTurnPhase.NotStarted:
      return {
        ok: true,
        turn: { ...turn, phase: PersonalTurnPhase.StartingAbsoluteEffects },
        events: [startStageEnteredEvent(turn, TurnStartStage.AbsoluteEffects)],
      }
    case PersonalTurnPhase.StartingAbsoluteEffects:
      return {
        ok: true,
        turn: {
          ...turn,
          phase: PersonalTurnPhase.StartingTurnCounterReset,
        },
        events: [
          startStageCompletedEvent(turn, TurnStartStage.AbsoluteEffects),
          startStageEnteredEvent(turn, TurnStartStage.TurnCounterReset),
        ],
      }
    case PersonalTurnPhase.StartingTurnCounterReset:
      return {
        ok: true,
        turn: { ...turn, phase: PersonalTurnPhase.StartingDelayedEffects },
        events: [
          startStageCompletedEvent(turn, TurnStartStage.TurnCounterReset),
          startStageEnteredEvent(turn, TurnStartStage.DelayedEffects),
        ],
      }
    case PersonalTurnPhase.StartingDelayedEffects:
      return {
        ok: true,
        turn: {
          ...turn,
          phase: PersonalTurnPhase.StartingUnitPassives,
        },
        events: [
          startStageCompletedEvent(turn, TurnStartStage.DelayedEffects),
          startStageEnteredEvent(turn, TurnStartStage.UnitPassives),
        ],
      }
    case PersonalTurnPhase.StartingUnitPassives:
      return {
        ok: true,
        turn: {
          ...turn,
          phase: PersonalTurnPhase.StartingSystemRules,
          unitPassiveEffectsApplied: true,
        },
        events: [
          startStageCompletedEvent(turn, TurnStartStage.UnitPassives),
          startStageEnteredEvent(turn, TurnStartStage.SystemRules),
        ],
      }
    case PersonalTurnPhase.StartingSystemRules:
      return {
        ok: true,
        turn: { ...turn, phase: PersonalTurnPhase.StartingStatusEffects },
        events: [
          startStageCompletedEvent(turn, TurnStartStage.SystemRules),
          startStageEnteredEvent(turn, TurnStartStage.StatusEffects),
        ],
      }
    case PersonalTurnPhase.StartingStatusEffects:
      return {
        ok: true,
        turn: { ...turn, phase: PersonalTurnPhase.StartingForcedChoices },
        events: [
          startStageCompletedEvent(turn, TurnStartStage.StatusEffects),
          startStageEnteredEvent(turn, TurnStartStage.ForcedChoices),
        ],
      }
    case PersonalTurnPhase.StartingForcedChoices:
      return {
        ok: true,
        turn: { ...turn, phase: PersonalTurnPhase.AwaitingAction },
        events: [startStageCompletedEvent(turn, TurnStartStage.ForcedChoices)],
      }
    default:
      return { ok: false, reason: 'TURN_START_STAGE_CANNOT_ADVANCE' }
  }
}

export function runTurnStartLifecycle(
  initialTurn: PersonalTurnState,
  units: readonly UnitState[],
): TurnLifecycleResult {
  const invalidUnits = validateLifecycleUnits(units, initialTurn.unitId)
  if (invalidUnits !== null) return { ok: false, reason: invalidUnits }
  let turn = initialTurn
  const events: BattleEvent[] = []

  while (turn.phase !== PersonalTurnPhase.AwaitingAction) {
    const result = advanceTurnStartStage(turn, units)
    if (!result.ok) return result
    turn = result.turn
    events.push(...result.events)
  }

  return { ok: true, turn, events }
}

export function startPersonalTurn(
  sequence: TurnSequenceState,
  unitId: UnitId,
  units: readonly UnitState[],
): TurnLifecycleResult {
  const created = createPersonalTurn(sequence, unitId, units)
  if (!created.ok) return created
  const started = runTurnStartLifecycle(created.turn, units)
  if (!started.ok) return started
  return {
    ok: true,
    turn: started.turn,
    events: [...created.events, ...started.events],
  }
}

export function beginPersonalTurnEnd(
  turn: PersonalTurnState,
  actorIsAlive: boolean,
  units: readonly UnitState[],
): TurnLifecycleResult {
  const invalidUnits = validateLifecycleUnits(units, turn.unitId)
  if (invalidUnits !== null) return { ok: false, reason: invalidUnits }
  if (turn.phase === PersonalTurnPhase.Ended) {
    return { ok: false, reason: 'PERSONAL_TURN_ALREADY_ENDED' }
  }
  if (turn.phase === PersonalTurnPhase.ResolvingAction) {
    return { ok: false, reason: 'ACTION_STILL_RESOLVING' }
  }
  if (
    turn.phase !== PersonalTurnPhase.AwaitingAction
    && turn.phase !== PersonalTurnPhase.Ending
  ) {
    return { ok: false, reason: 'PERSONAL_TURN_NOT_READY_TO_END' }
  }

  if (!actorIsAlive) {
    const endedTurn = { ...turn, phase: PersonalTurnPhase.Ended }
    return {
      ok: true,
      turn: endedTurn,
      events: [turnEndedEvent(endedTurn, true)],
    }
  }

  if (turn.phase === PersonalTurnPhase.Ending) {
    return { ok: false, reason: 'TURN_END_ALREADY_STARTED' }
  }

  return {
    ok: true,
    turn: { ...turn, phase: PersonalTurnPhase.Ending },
    events: [],
  }
}

export function advanceTurnEndStage(
  turn: PersonalTurnState,
  units: readonly UnitState[],
): TurnLifecycleResult {
  const invalidUnits = validateLifecycleUnits(units, turn.unitId)
  if (invalidUnits !== null) return { ok: false, reason: invalidUnits }
  switch (turn.phase) {
    case PersonalTurnPhase.Ending:
      return {
        ok: true,
        turn: { ...turn, phase: PersonalTurnPhase.EndingTriggeredEffects },
        events: [endStageEnteredEvent(turn, TurnEndStage.TriggeredEffects)],
      }
    case PersonalTurnPhase.EndingTriggeredEffects:
      return {
        ok: true,
        turn: { ...turn, phase: PersonalTurnPhase.EndingUnitSpecificEffects },
        events: [
          endStageCompletedEvent(turn, TurnEndStage.TriggeredEffects),
          endStageEnteredEvent(turn, TurnEndStage.UnitSpecificEffects),
        ],
      }
    case PersonalTurnPhase.EndingUnitSpecificEffects:
      return {
        ok: true,
        turn: { ...turn, phase: PersonalTurnPhase.EndingStatusEffects },
        events: [
          endStageCompletedEvent(turn, TurnEndStage.UnitSpecificEffects),
          endStageEnteredEvent(turn, TurnEndStage.StatusEffects),
        ],
      }
    case PersonalTurnPhase.EndingStatusEffects:
      return {
        ok: true,
        turn: { ...turn, phase: PersonalTurnPhase.EndingSpecialVariables },
        events: [
          endStageCompletedEvent(turn, TurnEndStage.StatusEffects),
          endStageEnteredEvent(turn, TurnEndStage.SpecialVariables),
        ],
      }
    case PersonalTurnPhase.EndingSpecialVariables:
      return {
        ok: true,
        turn: { ...turn, phase: PersonalTurnPhase.EndingStatusDurations },
        events: [
          endStageCompletedEvent(turn, TurnEndStage.SpecialVariables),
          endStageEnteredEvent(turn, TurnEndStage.StatusDurations),
        ],
      }
    case PersonalTurnPhase.EndingStatusDurations:
      return {
        ok: true,
        turn: { ...turn, phase: PersonalTurnPhase.EndingTemporaryModifiers },
        events: [
          endStageCompletedEvent(turn, TurnEndStage.StatusDurations),
          endStageEnteredEvent(turn, TurnEndStage.TemporaryModifiers),
        ],
      }
    case PersonalTurnPhase.EndingTemporaryModifiers: {
      const endedTurn = { ...turn, phase: PersonalTurnPhase.Ended }
      return {
        ok: true,
        turn: endedTurn,
        events: [
          endStageCompletedEvent(turn, TurnEndStage.TemporaryModifiers),
          turnEndedEvent(endedTurn, false),
        ],
      }
    }
    default:
      return { ok: false, reason: 'TURN_END_STAGE_CANNOT_ADVANCE' }
  }
}

export function runTurnEndLifecycle(
  initialTurn: PersonalTurnState,
  actorIsAlive: boolean,
  units: readonly UnitState[],
): TurnLifecycleResult {
  const invalidUnits = validateLifecycleUnits(units, initialTurn.unitId)
  if (invalidUnits !== null) return { ok: false, reason: invalidUnits }
  let turn = initialTurn
  const events: BattleEvent[] = []

  if (turn.phase === PersonalTurnPhase.Ended) {
    return { ok: false, reason: 'PERSONAL_TURN_ALREADY_ENDED' }
  }
  if (turn.phase === PersonalTurnPhase.ResolvingAction) {
    return { ok: false, reason: 'ACTION_STILL_RESOLVING' }
  }
  if (!actorIsAlive) return beginPersonalTurnEnd(turn, false, units)

  if (turn.phase === PersonalTurnPhase.AwaitingAction) {
    const beginning = beginPersonalTurnEnd(turn, true, units)
    if (!beginning.ok) return beginning
    turn = beginning.turn
    events.push(...beginning.events)
  } else if (turn.phase !== PersonalTurnPhase.Ending) {
    return { ok: false, reason: 'PERSONAL_TURN_NOT_READY_TO_END' }
  }

  while (turn.phase !== PersonalTurnPhase.Ended) {
    const result = advanceTurnEndStage(turn, units)
    if (!result.ok) return result
    turn = result.turn
    events.push(...result.events)
  }

  return { ok: true, turn, events }
}

export function finishPersonalTurn(
  turn: PersonalTurnState,
  actorIsAlive: boolean,
  units: readonly UnitState[],
): TurnLifecycleResult {
  return runTurnEndLifecycle(turn, actorIsAlive, units)
}
