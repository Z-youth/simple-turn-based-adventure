import { describe, expect, it } from 'vitest'
import { PersonalTurnPhase, TurnStartStage } from '../game/core/enums'
import type { PersonalTurnState, TurnSequenceState } from '../game/core/contexts'
import type { TurnSequenceId } from '../game/core/identifiers'
import {
  advanceTurnEndStage,
  advanceTurnStartStage,
  beginPersonalTurnEnd,
  createPersonalTurn,
  finishPersonalTurn,
  startPersonalTurn,
  TURN_END_STAGE_ORDER,
} from '../game/core/turnLifecycle'
import { unitId } from './battleTestUtils'

const sequence: TurnSequenceState = {
  sequenceId: 'sequence:1' as TurnSequenceId,
  sequenceNumber: 1,
  queue: [{ unitId: unitId('actor'), speedAtSequenceStart: 100 }],
  currentIndex: 0,
  completed: false,
}

function startTurn(): PersonalTurnState {
  const result = startPersonalTurn(sequence, unitId('actor'))
  if (!result.ok) throw new Error(result.reason)
  return result.turn
}

function requireTurn(result: ReturnType<typeof advanceTurnStartStage>) {
  if (!result.ok) throw new Error(result.reason)
  return result.turn
}

describe('personal turn lifecycle', () => {
  it('fixes the turn-start stage order before awaiting action', () => {
    const result = startPersonalTurn(sequence, unitId('actor'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const stages = result.events
      .filter((event) => event.type === 'TURN_START_STAGE_COMPLETED')
      .map((event) => event.stage)

    expect(stages).toEqual([
      TurnStartStage.DelayedEffects,
      TurnStartStage.SystemRules,
      TurnStartStage.UnitPassives,
      TurnStartStage.StatusEffects,
    ])
    expect(result.turn.phase).toBe(PersonalTurnPhase.AwaitingAction)
  })

  it('advances every turn-start phase without skipping or moving backward', () => {
    const created = createPersonalTurn(sequence, unitId('actor'))
    expect(created.turn.phase).toBe(PersonalTurnPhase.NotStarted)

    const delayed = requireTurn(advanceTurnStartStage(created.turn))
    expect(delayed.phase).toBe(PersonalTurnPhase.StartingDelayedEffects)
    const system = requireTurn(advanceTurnStartStage(delayed))
    expect(system.phase).toBe(PersonalTurnPhase.StartingSystemRules)
    const passives = requireTurn(advanceTurnStartStage(system))
    expect(passives.phase).toBe(PersonalTurnPhase.StartingUnitPassives)
    const statuses = requireTurn(advanceTurnStartStage(passives))
    expect(statuses.phase).toBe(PersonalTurnPhase.StartingStatusEffects)
    const awaiting = requireTurn(advanceTurnStartStage(statuses))
    expect(awaiting.phase).toBe(PersonalTurnPhase.AwaitingAction)

    const invalid = advanceTurnStartStage(awaiting)
    expect(invalid).toEqual({
      ok: false,
      reason: 'TURN_START_STAGE_CANNOT_ADVANCE',
    })
    expect(awaiting.phase).toBe(PersonalTurnPhase.AwaitingAction)
  })

  it('runs turn-end stages once and then rejects a duplicate end', () => {
    const ended = finishPersonalTurn(startTurn(), true)

    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    expect(ended.events.filter(
      (event) => event.type === 'TURN_END_STAGE_COMPLETED',
    )).toHaveLength(TURN_END_STAGE_ORDER.length)
    expect(ended.turn.phase).toBe(PersonalTurnPhase.Ended)

    const duplicate = finishPersonalTurn(ended.turn, true)
    expect(duplicate).toEqual({
      ok: false,
      reason: 'PERSONAL_TURN_ALREADY_ENDED',
    })
  })

  it('advances every turn-end phase and rejects skipping or repeating it', () => {
    const awaiting = startTurn()
    expect(advanceTurnEndStage(awaiting)).toEqual({
      ok: false,
      reason: 'TURN_END_STAGE_CANNOT_ADVANCE',
    })

    const beginning = beginPersonalTurnEnd(awaiting, true)
    expect(beginning.ok).toBe(true)
    if (!beginning.ok) return
    expect(beginning.turn.phase).toBe(PersonalTurnPhase.Ending)

    const expectedPhases = [
      PersonalTurnPhase.EndingTriggeredEffects,
      PersonalTurnPhase.EndingUnitSpecificEffects,
      PersonalTurnPhase.EndingStatusEffects,
      PersonalTurnPhase.EndingSpecialVariables,
      PersonalTurnPhase.EndingStatusDurations,
      PersonalTurnPhase.EndingTemporaryModifiers,
      PersonalTurnPhase.Ended,
    ]
    let turn = beginning.turn
    for (const expectedPhase of expectedPhases) {
      const result = advanceTurnEndStage(turn)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      turn = result.turn
      expect(turn.phase).toBe(expectedPhase)
    }

    expect(advanceTurnEndStage(turn)).toEqual({
      ok: false,
      reason: 'TURN_END_STAGE_CANNOT_ADVANCE',
    })
    expect(beginPersonalTurnEnd(turn, true)).toEqual({
      ok: false,
      reason: 'PERSONAL_TURN_ALREADY_ENDED',
    })
  })

  it('does not run turn-end stages for a dead unit', () => {
    const ended = finishPersonalTurn(startTurn(), false)

    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    expect(ended.events.some(
      (event) => event.type === 'TURN_END_STAGE_COMPLETED',
    )).toBe(false)
    expect(ended.events.at(-1)).toMatchObject({
      type: 'TURN_ENDED',
      skippedEndStagesBecauseDead: true,
    })
  })

  it('refuses to end a turn while an action is resolving', () => {
    const resolvingTurn: PersonalTurnState = {
      ...startTurn(),
      phase: PersonalTurnPhase.ResolvingAction,
    }

    expect(finishPersonalTurn(resolvingTurn, true)).toEqual({
      ok: false,
      reason: 'ACTION_STILL_RESOLVING',
    })
  })
})
