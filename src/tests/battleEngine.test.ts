import { describe, expect, it } from 'vitest'
import { BattlePhase, Camp, Position } from '../game/core/enums'
import { EndTurnConfirmation } from '../game/core/commands'
import type { ActionId } from '../game/core/identifiers'
import {
  completeBattleAction,
  endCurrentPersonalTurn,
  requestPlayerEndTurn,
  startBattleAction,
  startBattleSequence,
} from '../game/core/battleEngine'
import type { BattleEngineExtensions } from '../game/core/battleEngine'
import type { BattleState } from '../game/core/contexts'
import { gainResource, ResourceType } from '../game/core/resources'
import { gainShield } from '../game/core/shields'
import { finishPersonalTurn } from '../game/core/turnLifecycle'
import {
  createBattleState,
  createUnit,
  unitId,
} from './battleTestUtils'

function actionId(value: string): ActionId {
  return value as ActionId
}

describe('battle sequence engine', () => {
  it('rolls back all UnitPassiveEffects hook changes when the hook fails', () => {
    const initialState = createBattleState([createUnit('actor', {
      momentum: 2,
    })])
    const failedHookStates: BattleState[] = []
    const extensions: BattleEngineExtensions = {
      applyUnitPassiveEffects(state, turn) {
        const shield = gainShield(state, {
          unitId: turn.unitId,
          amount: 20,
          reason: 'testFailingPassive',
          personalTurnId: turn.personalTurnId,
          sequenceId: turn.sequenceId,
          skillExecutionId: null,
        })
        if (!shield.ok) return shield
        const momentum = gainResource(shield.state, {
          unitId: turn.unitId,
          resourceType: ResourceType.Momentum,
          amount: 5,
          reason: 'testFailingPassive',
          sourceId: null,
          actionId: null,
          personalTurnId: turn.personalTurnId,
          sequenceId: turn.sequenceId,
          skillExecutionId: null,
          resourceTransactionId: null,
        })
        if (!momentum.ok) return momentum
        const failedHookState: BattleState = {
          ...momentum.state,
          personalTurn: {
            ...turn,
            unitPassiveEffectsApplied: true,
          },
        }
        failedHookStates.push(failedHookState)
        return {
          ok: false,
          state: failedHookState,
          events: [],
          reason: 'TEST_UNIT_PASSIVE_EFFECTS_FAILURE',
        }
      },
    }
    const result = startBattleSequence(initialState, extensions)

    expect(failedHookStates).toHaveLength(1)
    const failedHookState = failedHookStates[0]
    if (failedHookState === undefined) return
    expect(failedHookState.units[0]).toMatchObject({ shield: 20, momentum: 7 })
    expect(failedHookState.personalTurn).toMatchObject({
      unitPassiveEffectsApplied: true,
    })
    expect(failedHookState.events.map((event) => event.type)).toEqual([
      'SHIELD_GAINED',
      'RESOURCE_GAINED',
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('TEST_UNIT_PASSIVE_EFFECTS_FAILURE')
    expect(result.state).toBe(initialState)
    expect(result.state.units).toBe(initialState.units)
    expect(result.state.events).toBe(initialState.events)
    expect(result.state.rngState).toBe(initialState.rngState)
    expect(result.state.units[0]).toMatchObject({
      shield: 0,
      momentum: 2,
      currentHealth: 100,
      alive: true,
    })
    expect(result.state.personalTurn).toBe(initialState.personalTurn)
    expect(result.state.personalTurn?.unitPassiveEffectsApplied)
      .toBe(initialState.personalTurn?.unitPassiveEffectsApplied)
    expect(result.state.personalTurn?.phase)
      .toBe(initialState.personalTurn?.phase)
    expect(result.state.events.some((event) => (
      event.type === 'SHIELD_GAINED'
      || event.type === 'RESOURCE_GAINED'
      || event.type === 'TURN_START_STAGE_ENTERED'
      || event.type === 'TURN_START_STAGE_COMPLETED'
    ))).toBe(false)
    expect(result.state.phase).toBe(BattlePhase.Setup)
  })

  it.each([
    0,
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects battle-entry base attack %s before creating a sequence', (value) => {
    const initialState = createBattleState([
      createUnit('invalid', { baseAttackAtBattleEntry: value }),
    ])
    const started = startBattleSequence(initialState)

    expect(started).toEqual({
      ok: false,
      state: initialState,
      events: [],
      reason: 'INVALID_UNIT_BASE_ATTACK',
    })
    expect(started.state.turnSequence).toBeNull()
    expect(started.state.personalTurn).toBeNull()
    expect(started.state.events).toBe(initialState.events)
    expect(started.state.rngState).toBe(initialState.rngState)
  })

  it.each([
    { alive: false, currentHealth: 100 },
    { alive: true, currentHealth: 0 },
  ])('rejects starting a new action for a dead actor %o', (override) => {
    const started = startBattleSequence(createBattleState([
      createUnit('actor'),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const units = started.state.units.map((unit) => (
      unit.id === unitId('actor') ? { ...unit, ...override } : unit
    ))
    const state = { ...started.state, units }
    const result = startBattleAction(state, {
      actionId: actionId('dead-actor'),
      actorId: unitId('actor'),
    })

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'ACTION_ACTOR_DEAD',
    })
    expect(result.state).toBe(state)
    expect(result.state.units).toBe(units)
    expect(result.state.events).toBe(state.events)
    expect(result.state.rngState).toBe(state.rngState)
    expect(result.state.activeAction).toBeNull()
    expect(result.state.phase).toBe(BattlePhase.AwaitingAction)
    expect(result.state.events.some((event) => (
      event.type === 'ACTION_CONFIRMED' || event.type === 'ACTION_STARTED'
    ))).toBe(false)
  })

  it('stops stably when no eligible units exist without creating empty sequences repeatedly', () => {
    const initialState = createBattleState([])
    const started = startBattleSequence(initialState)

    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.state.phase).toBe(BattlePhase.UnableToContinue)
    expect(started.state.turnSequence).toMatchObject({
      sequenceNumber: 1,
      completed: true,
      queue: [],
    })
    expect(started.state.personalTurn).toBeNull()
    expect(started.events.filter(
      (event) => event.type === 'SEQUENCE_STARTED',
    )).toHaveLength(1)
    expect(started.events).toContainEqual(expect.objectContaining({
      type: 'BATTLE_CANNOT_CONTINUE',
      reason: 'NO_ELIGIBLE_UNITS',
    }))

    const repeated = startBattleSequence(started.state)
    expect(repeated.ok).toBe(false)
    expect(repeated.state).toBe(started.state)
    expect(repeated.events).toEqual([])
    expect(repeated.state.turnSequence?.sequenceNumber).toBe(1)
  })

  it('starts the first living unit and keeps a fixed speed snapshot', () => {
    const result = startBattleSequence(createBattleState([
      createUnit('slow', { speed: 80, position: Position.Back1 }),
      createUnit('fast', { speed: 120, position: Position.Front1 }),
      createUnit('middle', { speed: 100, position: Position.Front2 }),
    ]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.turnSequence?.queue).toEqual([
      { unitId: unitId('fast'), speedAtSequenceStart: 120 },
      { unitId: unitId('middle'), speedAtSequenceStart: 100 },
      { unitId: unitId('slow'), speedAtSequenceStart: 80 },
    ])
    expect(result.state.personalTurn?.unitId).toBe(unitId('fast'))
  })

  it('does not reorder the current queue after speed changes, but re-reads next sequence', () => {
    const started = startBattleSequence(createBattleState([
      createUnit('first', { speed: 120, position: Position.Front1 }),
      createUnit('second', { speed: 100, position: Position.Front2 }),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    const firstTurnId = started.state.personalTurn.personalTurnId

    const speedChangedState = {
      ...started.state,
      units: started.state.units.map((unit) => (
        unit.id === unitId('second') ? { ...unit, speed: 200 } : unit
      )),
    }
    expect(speedChangedState.turnSequence?.queue.map((entry) => entry.unitId))
      .toEqual([unitId('first'), unitId('second')])

    const afterFirst = endCurrentPersonalTurn(
      speedChangedState,
      firstTurnId,
    )
    expect(afterFirst.ok).toBe(true)
    if (!afterFirst.ok || afterFirst.state.personalTurn === null) return
    expect(afterFirst.state.personalTurn.unitId).toBe(unitId('second'))

    const afterSecond = endCurrentPersonalTurn(
      afterFirst.state,
      afterFirst.state.personalTurn.personalTurnId,
    )
    expect(afterSecond.ok).toBe(true)
    if (!afterSecond.ok) return
    expect(afterSecond.state.turnSequence?.sequenceNumber).toBe(2)
    expect(afterSecond.state.turnSequence?.queue.map((entry) => entry.unitId))
      .toEqual([unitId('second'), unitId('first')])
    expect(afterSecond.state.personalTurn?.unitId).toBe(unitId('second'))
  })

  it('skips a unit that dies after queue creation and starts the next living unit', () => {
    const started = startBattleSequence(createBattleState([
      createUnit('first', { speed: 120, position: Position.Front1 }),
      createUnit('dies-later', { speed: 100, position: Position.Front2 }),
      createUnit('third', { speed: 80, position: Position.Back1 }),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    const firstTurnId = started.state.personalTurn.personalTurnId

    const deathState = {
      ...started.state,
      units: started.state.units.map((unit) => (
        unit.id === unitId('dies-later')
          ? { ...unit, alive: false, currentHealth: 0 }
          : unit
      )),
    }
    const advanced = endCurrentPersonalTurn(
      deathState,
      firstTurnId,
    )

    expect(advanced.ok).toBe(true)
    if (!advanced.ok) return
    expect(advanced.state.personalTurn?.unitId).toBe(unitId('third'))
    expect(advanced.events).toContainEqual(expect.objectContaining({
      type: 'UNIT_SKIPPED_DEAD',
      unitId: unitId('dies-later'),
    }))
    expect(advanced.events.some((event) => (
      event.type === 'TURN_STARTED' && event.unitId === unitId('dies-later')
    ))).toBe(false)
  })

  it('completes the sequence and automatically starts the next numbered sequence', () => {
    const started = startBattleSequence(createBattleState([
      createUnit('only'),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return

    const advanced = endCurrentPersonalTurn(
      started.state,
      started.state.personalTurn.personalTurnId,
    )

    expect(advanced.ok).toBe(true)
    if (!advanced.ok) return
    expect(advanced.state.turnSequence?.sequenceNumber).toBe(2)
    expect(advanced.events.filter(
      (event) => event.type === 'SEQUENCE_COMPLETED',
    )).toHaveLength(1)
    const nextSequenceEvents = advanced.events.filter((event) => (
      event.type === 'SEQUENCE_STARTED' && event.sequenceNumber === 2
    ))
    expect(nextSequenceEvents).toHaveLength(1)
  })

  it('creates deterministic unique sequence and personal-turn IDs within one battle', () => {
    const started = startBattleSequence(createBattleState([createUnit('only')]))
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    const firstSequenceId = started.state.turnSequence?.sequenceId
    const firstTurnId = started.state.personalTurn.personalTurnId

    const advanced = endCurrentPersonalTurn(
      started.state,
      started.state.personalTurn.personalTurnId,
    )
    expect(advanced.ok).toBe(true)
    if (!advanced.ok || advanced.state.personalTurn === null) return
    const secondSequenceId = advanced.state.turnSequence?.sequenceId
    const secondTurnId = advanced.state.personalTurn.personalTurnId

    expect([firstSequenceId, secondSequenceId]).toEqual([
      'sequence:1',
      'sequence:2',
    ])
    expect(new Set([firstSequenceId, secondSequenceId]).size).toBe(2)
    expect([firstTurnId, secondTurnId]).toEqual([
      'sequence:1:turn:0:only',
      'sequence:2:turn:0:only',
    ])
    expect(new Set([firstTurnId, secondTurnId]).size).toBe(2)
  })
})

describe('battle action engine', () => {
  it('ends the turn after a normal action and records one counted action', () => {
    const started = startBattleSequence(createBattleState([
      createUnit('first', { speed: 120, position: Position.Front1 }),
      createUnit('second', { speed: 100, position: Position.Front2 }),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const actionStarted = startBattleAction(started.state, {
      actionId: actionId('normal'),
      actorId: unitId('first'),
    })
    expect(actionStarted.ok).toBe(true)
    if (!actionStarted.ok) return

    const completed = completeBattleAction(actionStarted.state, actionId('normal'))
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.state.personalTurn?.unitId).toBe(unitId('second'))
    expect(completed.events).toContainEqual(expect.objectContaining({
      type: 'ACTION_COMPLETED',
      countedActionCount: 1,
    }))
  })

  it('keeps the same unit waiting after a non-ending action and permits another action', () => {
    const started = startBattleSequence(createBattleState([createUnit('actor')]))
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const firstStarted = startBattleAction(started.state, {
      actionId: actionId('first'),
      actorId: unitId('actor'),
      endsTurn: false,
    })
    expect(firstStarted.ok).toBe(true)
    if (!firstStarted.ok) return
    const firstCompleted = completeBattleAction(
      firstStarted.state,
      actionId('first'),
    )
    expect(firstCompleted.ok).toBe(true)
    if (!firstCompleted.ok) return

    expect(firstCompleted.state.personalTurn?.unitId).toBe(unitId('actor'))
    const secondStarted = startBattleAction(firstCompleted.state, {
      actionId: actionId('second'),
      actorId: unitId('actor'),
      endsTurn: false,
    })
    expect(secondStarted.ok).toBe(true)
  })

  it('ends the turn without action timing events for an uncounted turn-ending action', () => {
    const started = startBattleSequence(createBattleState([
      createUnit('first', { speed: 120, position: Position.Front1 }),
      createUnit('second', { speed: 100, position: Position.Front2 }),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const actionStarted = startBattleAction(started.state, {
      actionId: actionId('uncounted-ending'),
      actorId: unitId('first'),
      countsAsAction: false,
      endsTurn: true,
    })
    expect(actionStarted.ok).toBe(true)
    if (!actionStarted.ok) return

    const completed = completeBattleAction(
      actionStarted.state,
      actionId('uncounted-ending'),
    )
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    const actionStages = [
      ...actionStarted.events,
      ...completed.events,
    ].filter((event) => event.type === 'ACTION_STAGE_REACHED')
    expect(actionStages.some((event) => event.stage === 'onAction')).toBe(false)
    expect(actionStages.some((event) => event.stage === 'afterAction')).toBe(false)
    expect(completed.events).toContainEqual(expect.objectContaining({
      type: 'ACTION_COMPLETED',
      countedActionCount: 0,
    }))
    expect(completed.state.personalTurn?.unitId).toBe(unitId('second'))
  })

  it('finishes an action after its actor dies, skips end stages, then advances', () => {
    const started = startBattleSequence(createBattleState([
      createUnit('actor', { speed: 120, position: Position.Front1 }),
      createUnit('next', { speed: 100, position: Position.Front2 }),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const actionStarted = startBattleAction(started.state, {
      actionId: actionId('fatal-action'),
      actorId: unitId('actor'),
      endsTurn: false,
    })
    expect(actionStarted.ok).toBe(true)
    if (!actionStarted.ok) return
    const actorDiedState = {
      ...actionStarted.state,
      units: actionStarted.state.units.map((unit) => (
        unit.id === unitId('actor')
          ? { ...unit, alive: false, currentHealth: 0 }
          : unit
      )),
    }

    const completed = completeBattleAction(actorDiedState, actionId('fatal-action'))
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.events.some(
      (event) => event.type === 'ACTION_COMPLETED',
    )).toBe(true)
    expect(completed.events.some((event) => (
      event.type === 'TURN_END_STAGE_COMPLETED'
      && event.unitId === unitId('actor')
    ))).toBe(false)
    expect(completed.state.personalTurn?.unitId).toBe(unitId('next'))
  })

  it('rejects duplicate action completion and starting while resolving', () => {
    const started = startBattleSequence(createBattleState([createUnit('actor')]))
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const actionStarted = startBattleAction(started.state, {
      actionId: actionId('action'),
      actorId: unitId('actor'),
      endsTurn: false,
    })
    expect(actionStarted.ok).toBe(true)
    if (!actionStarted.ok) return

    expect(startBattleAction(actionStarted.state, {
      actionId: actionId('other'),
      actorId: unitId('actor'),
    }).ok).toBe(false)
    const completed = completeBattleAction(actionStarted.state, actionId('action'))
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completeBattleAction(completed.state, actionId('action')).ok).toBe(false)
  })

  it('rejects actions and player end requests for an already-ended turn without changing state', () => {
    const started = startBattleSequence(createBattleState([createUnit('actor')]))
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    const ended = finishPersonalTurn(
      started.state.personalTurn,
      true,
      started.state.units,
    )
    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    const endedState = {
      ...started.state,
      phase: BattlePhase.TurnEnd,
      personalTurn: ended.turn,
    }

    const actionResult = startBattleAction(endedState, {
      actionId: actionId('too-late'),
      actorId: unitId('actor'),
    })
    expect(actionResult.ok).toBe(false)
    expect(actionResult.state).toBe(endedState)

    const endRequest = requestPlayerEndTurn(endedState, {
      hasLegalAction: false,
    })
    expect(endRequest.status).toBe('invalid')
    expect(endRequest.state).toBe(endedState)
  })
})

describe('player end-turn command', () => {
  it('requires confirmation when a legal action remains and cancellation changes nothing', () => {
    const started = startBattleSequence(createBattleState([createUnit('player')]))
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const requested = requestPlayerEndTurn(started.state, {
      hasLegalAction: true,
    })
    expect(requested.status).toBe('confirmationRequired')
    expect(requested.state).toBe(started.state)

    const cancelled = requestPlayerEndTurn(started.state, {
      hasLegalAction: true,
      confirmation: EndTurnConfirmation.Cancelled,
    })
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.state).toBe(started.state)
  })

  it('ends after confirmation or immediately when no legal action remains', () => {
    const started = startBattleSequence(createBattleState([
      createUnit('player', { speed: 120, position: Position.Front1 }),
      createUnit('next', { speed: 100, position: Position.Front2 }),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const confirmed = requestPlayerEndTurn(started.state, {
      hasLegalAction: true,
      confirmation: EndTurnConfirmation.Confirmed,
    })
    expect(confirmed.status).toBe('turnEnded')
    expect(confirmed.state.personalTurn?.unitId).toBe(unitId('next'))

    const restarted = startBattleSequence(createBattleState([
      createUnit('player', { speed: 120, position: Position.Front1 }),
      createUnit('next', { speed: 100, position: Position.Front2 }),
    ]))
    expect(restarted.ok).toBe(true)
    if (!restarted.ok) return
    const direct = requestPlayerEndTurn(restarted.state, {
      hasLegalAction: false,
    })
    expect(direct.status).toBe('turnEnded')
    expect(direct.state.personalTurn?.unitId).toBe(unitId('next'))
  })

  it('rejects enemy turns and action-resolution phases', () => {
    const enemyStarted = startBattleSequence(createBattleState([
      createUnit('enemy', { camp: Camp.Enemy, position: null }),
    ]))
    expect(enemyStarted.ok).toBe(true)
    if (!enemyStarted.ok) return
    expect(requestPlayerEndTurn(enemyStarted.state, {
      hasLegalAction: false,
    }).status).toBe('invalid')

    const playerStarted = startBattleSequence(createBattleState([
      createUnit('player'),
    ]))
    expect(playerStarted.ok).toBe(true)
    if (!playerStarted.ok) return
    const resolving = startBattleAction(playerStarted.state, {
      actionId: actionId('resolving'),
      actorId: unitId('player'),
      endsTurn: false,
    })
    expect(resolving.ok).toBe(true)
    if (!resolving.ok) return
    expect(requestPlayerEndTurn(resolving.state, {
      hasLegalAction: false,
    }).status).toBe('invalid')
  })
})
