import { describe, expect, it } from 'vitest'
import {
  StackPolicy,
  StatusAcquisitionTiming,
  StatusCategory,
  TurnEndStage,
} from '../game/core/enums'
import type { StatusBatch } from '../game/core/statuses'
import { addStatusToBattle } from '../game/core/statusEngine'
import {
  endCurrentPersonalTurn,
  startBattleSequence,
} from '../game/core/battleEngine'
import { createBattleState, createUnit, unitId } from './battleTestUtils'
import { ids } from './combatTestUtils'

function timedStatus(owner: string, remainingOwnerTurns: number): StatusBatch {
  return {
    batchId: ids.batch(`batch:${owner}`),
    statusId: ids.status('status:timed'),
    ownerUnitId: unitId(owner),
    sourceUnitId: unitId(owner),
    stacks: 1,
    effect: { calculation: 'total', value: 1 },
    remainingOwnerTurns,
    acquiredAt: StatusAcquisitionTiming.Action,
    acquisitionGroupId: 'action:1',
    acquisitionOrder: 1,
    skipNextTurnEndDecrement: false,
    stackPolicy: StackPolicy.Independent,
    category: StatusCategory.Buff,
    canBeCleansed: false,
    canBeDispelled: true,
  }
}

describe('status duration lifecycle integration', () => {
  it('counts the current owner turn when a status is gained during that turn', () => {
    const started = startBattleSequence(createBattleState([
      createUnit('owner', { speed: 200 }),
      createUnit('next', { speed: 100 }),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    const added = addStatusToBattle(
      started.state,
      timedStatus('owner', 1),
    )
    expect(added.ok).toBe(true)
    if (!added.ok) return
    const ended = endCurrentPersonalTurn(
      added.state,
      started.state.personalTurn.personalTurnId,
    )

    expect(ended.ok).toBe(true)
    if (ended.ok) expect(ended.state.statusBatches).toEqual([])
  })

  it('counts the next owner turn when a status is gained outside that turn', () => {
    const started = startBattleSequence(createBattleState([
      createUnit('current', { speed: 200 }),
      createUnit('owner', { speed: 100, position: 'front2' }),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    const added = addStatusToBattle(started.state, {
      ...timedStatus('owner', 1),
      acquiredAt: StatusAcquisitionTiming.External,
      skipNextTurnEndDecrement: true,
    })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    const afterCurrent = endCurrentPersonalTurn(
      added.state,
      started.state.personalTurn.personalTurnId,
    )
    expect(afterCurrent.ok).toBe(true)
    if (!afterCurrent.ok || afterCurrent.state.personalTurn === null) return
    expect(afterCurrent.state.statusBatches[0]?.remainingOwnerTurns).toBe(1)
    expect(afterCurrent.state.statusBatches[0]?.skipNextTurnEndDecrement)
      .toBe(false)
    const afterOwner = endCurrentPersonalTurn(
      afterCurrent.state,
      afterCurrent.state.personalTurn.personalTurnId,
    )

    expect(afterOwner.ok).toBe(true)
    if (afterOwner.ok) expect(afterOwner.state.statusBatches).toEqual([])
  })

  it('decrements status inside the controlled status-duration stage', () => {
    const initial = {
      ...createBattleState([
        createUnit('owner', { speed: 200 }),
        createUnit('next', { speed: 100 }),
      ]),
      statusBatches: [timedStatus('owner', 2)],
      statusAcquisitionOrders: [1],
    }
    const started = startBattleSequence(initial)
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    const ended = endCurrentPersonalTurn(
      started.state,
      started.state.personalTurn.personalTurnId,
    )

    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    expect(ended.state.statusBatches[0].remainingOwnerTurns).toBe(1)
    const entered = ended.events.findIndex((event) => (
      event.type === 'TURN_END_STAGE_ENTERED'
      && event.stage === TurnEndStage.StatusDurations
    ))
    const decremented = ended.events.findIndex(
      (event) => event.type === 'STATUS_DURATION_DECREMENTED',
    )
    const completed = ended.events.findIndex((event) => (
      event.type === 'TURN_END_STAGE_COMPLETED'
      && event.stage === TurnEndStage.StatusDurations
    ))
    expect(entered).toBeLessThan(decremented)
    expect(decremented).toBeLessThan(completed)
  })

  it('does not decrement another unit status on the current owner turn', () => {
    const initial = {
      ...createBattleState([
        createUnit('owner', { speed: 200 }),
        createUnit('other', { speed: 100 }),
      ]),
      statusBatches: [timedStatus('other', 2)],
      statusAcquisitionOrders: [1],
    }
    const started = startBattleSequence(initial)
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    const ended = endCurrentPersonalTurn(
      started.state,
      started.state.personalTurn.personalTurnId,
    )

    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    expect(ended.state.statusBatches[0].remainingOwnerTurns).toBe(2)
  })
})
