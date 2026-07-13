import { describe, expect, it } from 'vitest'
import { ActionLifecycleStage, PersonalTurnPhase } from '../game/core/enums'
import type {
  ActionId,
  UnitId,
  TurnSequenceId,
} from '../game/core/identifiers'
import type {
  ActionContext,
  PersonalTurnState,
  TurnSequenceState,
} from '../game/core/contexts'
import type { StartActionInput } from '../game/core/actionLifecycle'
import {
  beginAction as beginRuntimeAction,
  finishAction as finishRuntimeAction,
} from '../game/core/actionLifecycle'
import { startPersonalTurn as startRuntimePersonalTurn } from '../game/core/turnLifecycle'
import { createUnit, unitId } from './battleTestUtils'

const runtimeUnits = [createUnit('actor')]

function startPersonalTurn(
  sequence: TurnSequenceState,
  actorId: UnitId,
) {
  return startRuntimePersonalTurn(sequence, actorId, runtimeUnits)
}

function beginAction(
  turn: PersonalTurnState,
  input: StartActionInput,
) {
  return beginRuntimeAction(turn, input, runtimeUnits)
}

function finishAction(
  turn: PersonalTurnState,
  action: ActionContext,
  id: ActionId,
) {
  return finishRuntimeAction(turn, action, id, runtimeUnits)
}

function actionId(value: string): ActionId {
  return value as ActionId
}

function createTurn() {
  const sequence: TurnSequenceState = {
    sequenceId: 'sequence:1' as TurnSequenceId,
    sequenceNumber: 1,
    queue: [{ unitId: unitId('actor'), speedAtSequenceStart: 100 }],
    currentIndex: 0,
    completed: false,
  }
  const result = startPersonalTurn(sequence, unitId('actor'))
  if (!result.ok) throw new Error(result.reason)
  return result.turn
}

describe('action lifecycle', () => {
  it('uses counted and turn-ending defaults for a normal action', () => {
    const started = beginAction(createTurn(), {
      actionId: actionId('normal'),
      actorId: unitId('actor'),
    })

    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.action.countsAsAction).toBe(true)
    expect(started.action.endsTurn).toBe(true)

    const completed = finishAction(
      started.turn,
      started.action,
      actionId('normal'),
    )
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.turn.countedActionCount).toBe(1)
    expect(completed.turn.phase).toBe(PersonalTurnPhase.Ending)
  })

  it('allows multiple non-ending actions by the same unit', () => {
    const first = beginAction(createTurn(), {
      actionId: actionId('first'),
      actorId: unitId('actor'),
      endsTurn: false,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const firstCompleted = finishAction(
      first.turn,
      first.action,
      actionId('first'),
    )
    expect(firstCompleted.ok).toBe(true)
    if (!firstCompleted.ok) return

    const second = beginAction(firstCompleted.turn, {
      actionId: actionId('second'),
      actorId: unitId('actor'),
      endsTurn: false,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.turn.startedActionIds).toEqual([
      actionId('first'),
      actionId('second'),
    ])
    expect(first.events.some((event) => event.type === 'ACTION_STARTED')).toBe(true)
    expect(second.events.some((event) => event.type === 'ACTION_STARTED')).toBe(true)
  })

  it('does not count or emit on-action/after-action stages for an uncounted action', () => {
    const normal = beginAction(createTurn(), {
      actionId: actionId('normal'),
      actorId: unitId('actor'),
      endsTurn: false,
    })
    expect(normal.ok).toBe(true)
    if (!normal.ok) return
    const normalCompleted = finishAction(
      normal.turn,
      normal.action,
      actionId('normal'),
    )
    expect(normalCompleted.ok).toBe(true)
    if (!normalCompleted.ok) return

    const uncounted = beginAction(normalCompleted.turn, {
      actionId: actionId('uncounted'),
      actorId: unitId('actor'),
      countsAsAction: false,
      endsTurn: false,
    })
    expect(uncounted.ok).toBe(true)
    if (!uncounted.ok) return
    const uncountedCompleted = finishAction(
      uncounted.turn,
      uncounted.action,
      actionId('uncounted'),
    )
    expect(uncountedCompleted.ok).toBe(true)
    if (!uncountedCompleted.ok) return

    const stages = [...uncounted.events, ...uncountedCompleted.events]
      .filter((event) => event.type === 'ACTION_STAGE_REACHED')
      .map((event) => event.stage)
    expect(stages).toEqual([
      ActionLifecycleStage.ResourceValidationAndPayment,
      ActionLifecycleStage.SkillResolution,
    ])
    expect(uncountedCompleted.turn.countedActionCount).toBe(1)
  })

  it('rejects starting another action while one is resolving', () => {
    const first = beginAction(createTurn(), {
      actionId: actionId('first'),
      actorId: unitId('actor'),
      endsTurn: false,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return

    expect(beginAction(first.turn, {
      actionId: actionId('second'),
      actorId: unitId('actor'),
    })).toEqual({
      ok: false,
      reason: 'PERSONAL_TURN_NOT_AWAITING_ACTION',
    })
  })

  it('rejects completing an action twice', () => {
    const started = beginAction(createTurn(), {
      actionId: actionId('action'),
      actorId: unitId('actor'),
      endsTurn: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const completed = finishAction(
      started.turn,
      started.action,
      actionId('action'),
    )
    expect(completed.ok).toBe(true)
    if (!completed.ok) return

    expect(finishAction(
      completed.turn,
      started.action,
      actionId('action'),
    ).ok).toBe(false)
  })

  it('preserves confirmed action boundary order', () => {
    const started = beginAction(createTurn(), {
      actionId: actionId('ordered'),
      actorId: unitId('actor'),
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const completed = finishAction(
      started.turn,
      started.action,
      actionId('ordered'),
    )
    expect(completed.ok).toBe(true)
    if (!completed.ok) return

    const labels = [...started.events, ...completed.events].map((event) => (
      event.type === 'ACTION_STAGE_REACHED'
        ? `${event.type}:${event.stage}`
        : event.type
    ))
    expect(labels).toEqual([
      'ACTION_CONFIRMED',
      'ACTION_STARTED',
      'ACTION_STAGE_REACHED:onAction',
      'ACTION_STAGE_REACHED:resourceValidationAndPayment',
      'ACTION_STAGE_REACHED:skillResolution',
      'ACTION_STAGE_REACHED:afterAction',
      'ACTION_COMPLETED',
    ])
  })

  it.each([
    { alive: false, currentHealth: 100 },
    { alive: true, currentHealth: 0 },
    { alive: true, currentHealth: -1 },
  ])('rejects a dead actor at the low-level action start boundary %o', (override) => {
    const turn = createTurn()
    const startedActionIds = turn.startedActionIds
    const units = [createUnit('actor', override)]
    const result = beginRuntimeAction(turn, {
      actionId: actionId('dead-actor'),
      actorId: unitId('actor'),
    }, units)

    expect(result).toEqual({
      ok: false,
      reason: 'ACTION_ACTOR_DEAD',
    })
    expect('events' in result).toBe(false)
    expect(turn.startedActionIds).toBe(startedActionIds)
    expect(turn.phase).toBe(PersonalTurnPhase.AwaitingAction)
    expect(units[0]).toMatchObject(override)
  })
})
