import { describe, expect, it } from 'vitest'
import { resolveBattlefieldTransaction } from '../game/core/battlefield'
import {
  endCurrentPersonalTurn,
  startBattleSequence,
} from '../game/core/battleEngine'
import {
  Camp,
  Position,
  StackPolicy,
  StatusAcquisitionTiming,
  StatusCategory,
} from '../game/core/enums'
import type { StatusBatchId, StatusId } from '../game/core/identifiers'
import type { StatusBatch } from '../game/core/statuses'
import { createTurnQueue } from '../game/core/turnOrder'
import { createBattleState, createUnit, unitId } from './battleTestUtils'

const origin = {
  sourceUnitId: unitId('summoner'),
  effectId: 'test:summon',
}

function enemy(id: string, deploymentOrder: number, speed = 100) {
  return createUnit(id, {
    camp: Camp.Enemy,
    position: Position.EnemyCenter,
    deploymentOrder,
    speed,
  })
}

function status(owner: string): StatusBatch {
  return {
    batchId: 'stored-status' as StatusBatchId,
    statusId: 'stored-status' as StatusId,
    ownerUnitId: unitId(owner),
    sourceUnitId: unitId('source'),
    stacks: 2,
    effect: { calculation: 'perStack', value: 1 },
    remainingOwnerTurns: 2,
    acquiredAt: StatusAcquisitionTiming.Action,
    acquisitionGroupId: 'stored-status',
    acquisitionOrder: 4,
    skipNextTurnEndDecrement: false,
    stackPolicy: StackPolicy.Independent,
    category: StatusCategory.Buff,
    canBeCleansed: true,
    canBeDispelled: true,
  }
}

describe('battlefield transactions', () => {
  it('summons with a fresh stable deployment order without joining this sequence', () => {
    const started = startBattleSequence(createBattleState([
      enemy('summoner', 3, 120),
      enemy('existing', 7, 80),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const summoned = resolveBattlefieldTransaction(started.state, [{
      kind: 'summon',
      unit: enemy('summoned', 0, 100),
      immediateTurnAfterCurrentTurn: false,
      ...origin,
    }])
    expect(summoned.ok).toBe(true)
    if (!summoned.ok) return

    expect(summoned.state.units.find((unit) => unit.id === unitId('summoned')))
      .toMatchObject({ deploymentOrder: 8, position: Position.EnemyCenter })
    expect(summoned.state.turnSequence?.queue.map((entry) => entry.unitId))
      .not.toContain(unitId('summoned'))
    const nextQueue = createTurnQueue(summoned.state.units)
    expect(nextQueue.ok).toBe(true)
    if (!nextQueue.ok) return
    expect(nextQueue.queue.map((entry) => entry.unitId)).toEqual([
      unitId('summoner'),
      unitId('summoned'),
      unitId('existing'),
    ])
  })

  it('rolls the whole transaction back when a later operation fails', () => {
    const state = createBattleState([enemy('summoner', 0)])
    const result = resolveBattlefieldTransaction(state, [
      {
        kind: 'summon',
        unit: enemy('new', 0),
        ...origin,
      },
      {
        kind: 'summon',
        unit: enemy('new', 0),
        ...origin,
      },
    ])

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'UNIT_ID_ALREADY_EXISTS',
    })
    expect(result.state).toBe(state)
  })

  it('stores and restores a retreated unit with its live state and statuses', () => {
    const storedStatus = status('guard')
    const state = {
      ...createBattleState([
        enemy('summoner', 0),
        enemy('guard', 1),
      ]),
      statusBatches: [storedStatus],
      statusAcquisitionOrders: [4],
    }
    const retreated = resolveBattlefieldTransaction(state, [{
      kind: 'retreat',
      unitId: unitId('guard'),
      ...origin,
    }])
    expect(retreated.ok).toBe(true)
    if (!retreated.ok) return
    expect(retreated.state.units.map((unit) => unit.id)).not.toContain(unitId('guard'))
    expect(retreated.state.statusBatches).toEqual([])
    expect(retreated.state.offFieldUnits?.[0]).toMatchObject({
      unit: { id: unitId('guard'), deploymentOrder: 1 },
      statusBatches: [storedStatus],
    })

    const returned = resolveBattlefieldTransaction(retreated.state, [{
      kind: 'return',
      unitId: unitId('guard'),
      ...origin,
    }])
    expect(returned.ok).toBe(true)
    if (!returned.ok) return
    expect(returned.state.offFieldUnits).toEqual([])
    expect(returned.state.statusBatches).toEqual([storedStatus])
    expect(returned.state.units.find((unit) => unit.id === unitId('guard')))
      .toMatchObject({ deploymentOrder: 2 })
  })

  it('replaces identity without a death event or inherited queue slot', () => {
    const started = startBattleSequence(createBattleState([
      enemy('old', 0, 120),
      enemy('other', 1, 80),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const replaced = resolveBattlefieldTransaction(started.state, [{
      kind: 'replace',
      replacedUnitId: unitId('old'),
      replacement: enemy('new', 0, 200),
      ...origin,
    }])
    expect(replaced.ok).toBe(true)
    if (!replaced.ok) return

    expect(replaced.events).toEqual([{
      type: 'UNIT_REPLACED',
      replacedUnitId: unitId('old'),
      replacementUnitId: unitId('new'),
      ...origin,
    }])
    expect(replaced.events.some((event) => event.type === 'UNIT_DIED')).toBe(false)
    expect(replaced.state.turnSequence?.queue.map((entry) => entry.unitId))
      .not.toContain(unitId('new'))
  })

  it('runs a summoned immediate turn fully after the summoner turn', () => {
    const started = startBattleSequence(createBattleState([
      enemy('summoner', 0, 120),
      enemy('later', 1, 80),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    const summoned = resolveBattlefieldTransaction(started.state, [{
      kind: 'summon',
      unit: enemy('summoned', 0, 10),
      immediateTurnAfterCurrentTurn: true,
      ...origin,
    }])
    expect(summoned.ok).toBe(true)
    if (!summoned.ok) return

    const ended = endCurrentPersonalTurn(
      summoned.state,
      started.state.personalTurn.personalTurnId,
    )
    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    expect(ended.state.personalTurn).toMatchObject({
      unitId: unitId('summoned'),
      phase: 'awaitingAction',
    })
    expect(ended.events).toContainEqual(expect.objectContaining({
      type: 'TURN_STARTED',
      unitId: unitId('summoned'),
    }))
    expect(ended.events).toContainEqual(expect.objectContaining({
      type: 'TURN_START_STAGE_COMPLETED',
      unitId: unitId('summoned'),
      stage: 'forcedChoices',
    }))
  })

  it('skips a dead summon immediate slot and continues the fixed queue', () => {
    const started = startBattleSequence(createBattleState([
      enemy('summoner', 0, 120),
      enemy('later', 1, 80),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    const summoned = resolveBattlefieldTransaction(started.state, [{
      kind: 'summon',
      unit: enemy('summoned', 0, 10),
      immediateTurnAfterCurrentTurn: true,
      ...origin,
    }])
    expect(summoned.ok).toBe(true)
    if (!summoned.ok) return
    const summonDefeated = {
      ...summoned.state,
      units: summoned.state.units.map((unit) => (
        unit.id === unitId('summoned')
          ? { ...unit, currentHealth: 0, alive: false }
          : unit
      )),
    }

    const ended = endCurrentPersonalTurn(
      summonDefeated,
      started.state.personalTurn.personalTurnId,
    )
    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    expect(ended.state.personalTurn?.unitId).toBe(unitId('later'))
    expect(ended.events).toContainEqual(expect.objectContaining({
      type: 'UNIT_SKIPPED_DEAD',
      unitId: unitId('summoned'),
    }))
  })

  it('clears active and stored units without treating clearing as death', () => {
    const state = createBattleState([
      enemy('summoner', 0),
      enemy('clear-me', 1),
    ])
    const result = resolveBattlefieldTransaction(state, [{
      kind: 'remove',
      unitId: unitId('clear-me'),
      ...origin,
    }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.map((unit) => unit.id)).not.toContain(unitId('clear-me'))
    expect(result.events).toEqual([expect.objectContaining({
      type: 'UNIT_REMOVED',
      unitId: unitId('clear-me'),
    })])
  })
})
