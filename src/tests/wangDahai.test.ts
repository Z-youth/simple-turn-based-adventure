import { describe, expect, it } from 'vitest'
import type {
  ActionId,
  StatusBatchId,
  StatusId,
} from '../game/core/identifiers'
import {
  completeBattleAction,
  startBattleAction,
  startBattleSequence,
} from '../game/core/battleEngine'
import type { BattleEngineExtensions } from '../game/core/battleEngine'
import type { BattleState } from '../game/core/contexts'
import {
  StackPolicy,
  StatusAcquisitionTiming,
  StatusCategory,
} from '../game/core/enums'
import { createFixedSequenceRandomState } from '../game/core/rng'
import { ResourceType, spendResource } from '../game/core/resources'
import { readSpecialCounter } from '../game/core/specialCounters'
import type { StatusBatch } from '../game/core/statuses'
import { getEffectiveAttack } from '../game/core/unitQueries'
import type { UnitState } from '../game/core/units'
import { GAME_CONTENT_BATTLE_EXTENSIONS } from '../game/content/battleExtensions'
import { createTrainingDummy, TRAINING_DUMMY_UNIT_ID } from '../game/content/bosses/trainingDummy'
import {
  applyWangDahaiRisingMomentum,
  createWangDahai,
  hasFreeMyriadRiversAtTurnEnd,
  WANG_DAHAI_BATTLE_EXTENSIONS,
  WANG_DAHAI_TIDE_COUNTER_ID,
  WANG_DAHAI_UNIT_ID,
} from '../game/content/characters/wangDahai'
import { createBattleState, createUnit, unitId } from './battleTestUtils'

function wang(overrides: Partial<UnitState> = {}): UnitState {
  return { ...createWangDahai(), ...overrides }
}

function setup(
  wangOverrides: Partial<UnitState> = {},
  stateOverrides: Partial<BattleState> = {},
  extensions: BattleEngineExtensions = WANG_DAHAI_BATTLE_EXTENSIONS,
): BattleState {
  const initial = {
    ...createBattleState([
      wang({ speed: 200, ...wangOverrides }),
      createUnit('other', { speed: 1 }),
    ]),
    ...stateOverrides,
  }
  const started = startBattleSequence(initial, extensions)
  if (!started.ok) throw new Error(`Could not start Wang Dahai test: ${started.reason}`)
  return started.state
}

function finishAction(
  state: BattleState,
  actorId: typeof WANG_DAHAI_UNIT_ID | ReturnType<typeof unitId>,
  name: string,
  endsTurn: boolean,
  extensions: BattleEngineExtensions = WANG_DAHAI_BATTLE_EXTENSIONS,
): BattleState {
  const actionId = `action:${name}` as ActionId
  const started = startBattleAction(state, { actionId, actorId, endsTurn })
  if (!started.ok) throw new Error(`Could not start ${name}: ${started.reason}`)
  const completed = completeBattleAction(started.state, actionId, extensions)
  if (!completed.ok) throw new Error(`Could not complete ${name}: ${completed.reason}`)
  return completed.state
}

function debuff(
  name: string,
  acquisitionOrder: number,
  stacks = 1,
): StatusBatch {
  return {
    batchId: `status-batch:${name}` as StatusBatchId,
    statusId: 'status:test-debuff' as StatusId,
    ownerUnitId: WANG_DAHAI_UNIT_ID,
    sourceUnitId: unitId('other'),
    stacks,
    effect: { calculation: 'perStack', value: -1 },
    remainingOwnerTurns: 3,
    acquiredAt: StatusAcquisitionTiming.Action,
    acquisitionGroupId: `group:${name}`,
    acquisitionOrder,
    skipNextTurnEndDecrement: false,
    stackPolicy: StackPolicy.Independent,
    category: StatusCategory.Debuff,
    canBeCleansed: false,
    canBeDispelled: false,
  }
}

describe('Wang Dahai base state', () => {
  it('creates the specified base attributes and zero resources', () => {
    const unit = createWangDahai()

    expect(unit).toMatchObject({
      id: WANG_DAHAI_UNIT_ID,
      name: '王大海',
      maximumHealth: 160,
      currentHealth: 160,
      baseAttackAtBattleEntry: 20,
      speed: 100,
      shield: 0,
      criticalRate: 0,
      criticalDamage: 0.5,
      energy: 0,
      momentum: 0,
      momentumPressure: 0,
    })
    expect(readSpecialCounter(unit, WANG_DAHAI_TIDE_COUNTER_ID)).toBe(0)
    expect(hasFreeMyriadRiversAtTurnEnd(unit)).toBe(false)
  })
})

describe('Wang Dahai turn-start passive', () => {
  it('gains two energy once per turn and can trigger again next turn', () => {
    const firstTurn = setup()
    expect(firstTurn.units.find((unit) => unit.id === WANG_DAHAI_UNIT_ID)?.energy)
      .toBe(2)
    expect(firstTurn.events.filter((event) => (
      event.type === 'RESOURCE_GAINED'
      && event.unitId === WANG_DAHAI_UNIT_ID
      && event.resourceType === ResourceType.Energy
    ))).toHaveLength(1)

    const sameTurn = finishAction(
      firstTurn,
      WANG_DAHAI_UNIT_ID,
      'wang-continues',
      false,
    )
    expect(sameTurn.personalTurn?.personalTurnId)
      .toBe(firstTurn.personalTurn?.personalTurnId)
    expect(sameTurn.units.find((unit) => unit.id === WANG_DAHAI_UNIT_ID)?.energy)
      .toBe(2)

    const otherTurn = finishAction(
      sameTurn,
      WANG_DAHAI_UNIT_ID,
      'wang-ends',
      true,
    )
    const secondTurn = finishAction(
      otherTurn,
      unitId('other'),
      'other-ends',
      true,
    )
    expect(secondTurn.personalTurn?.unitId).toBe(WANG_DAHAI_UNIT_ID)
    expect(secondTurn.units.find((unit) => unit.id === WANG_DAHAI_UNIT_ID)?.energy)
      .toBe(4)
  })

  it('fixes the free-skill marker at turn start and resets it next turn', () => {
    const marked = setup({ momentum: 10 })
    const initialWang = marked.units.find((unit) => unit.id === WANG_DAHAI_UNIT_ID)
    expect(initialWang?.energy).toBe(0)
    expect(initialWang && hasFreeMyriadRiversAtTurnEnd(initialWang)).toBe(true)

    const reduced = spendResource(marked, {
      unitId: WANG_DAHAI_UNIT_ID,
      resourceType: ResourceType.Momentum,
      amount: 10,
      reason: 'marker-test',
      sourceId: null,
      actionId: null,
      personalTurnId: marked.personalTurn?.personalTurnId ?? null,
      sequenceId: marked.personalTurn?.sequenceId ?? null,
      skillExecutionId: null,
      resourceTransactionId: null,
    })
    expect(reduced.ok).toBe(true)
    if (!reduced.ok) return
    const afterReduction = reduced.state.units.find(
      (unit) => unit.id === WANG_DAHAI_UNIT_ID,
    )
    expect(afterReduction?.momentum).toBe(0)
    expect(afterReduction && hasFreeMyriadRiversAtTurnEnd(afterReduction)).toBe(true)

    const otherTurn = finishAction(
      reduced.state,
      WANG_DAHAI_UNIT_ID,
      'marked-wang-ends',
      true,
    )
    const nextWangTurn = finishAction(
      otherTurn,
      unitId('other'),
      'marked-other-ends',
      true,
    )
    const resetWang = nextWangTurn.units.find(
      (unit) => unit.id === WANG_DAHAI_UNIT_ID,
    )
    expect(resetWang?.energy).toBe(2)
    expect(resetWang && hasFreeMyriadRiversAtTurnEnd(resetWang)).toBe(false)
  })
})

describe('Wang Dahai Rising Momentum passive', () => {
  it('gains momentum and removes one earliest debuff layer without attack gain', () => {
    const first = debuff('first', 1, 2)
    const second = debuff('second', 2)
    const awaiting = setup({}, {
      statusBatches: [first, second],
      statusAcquisitionOrders: [1, 2],
    })
    const actionId = 'action:debuff-rising' as ActionId
    const started = startBattleAction(awaiting, {
      actionId,
      actorId: WANG_DAHAI_UNIT_ID,
      endsTurn: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const result = applyWangDahaiRisingMomentum(started.state)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const unit = result.state.units.find((candidate) => (
      candidate.id === WANG_DAHAI_UNIT_ID
    ))
    expect(unit?.momentum).toBe(1)
    expect(unit?.temporaryAttributeModifiers).toEqual([])
    if (unit !== undefined) expect(getEffectiveAttack(unit)).toBe(21)
    expect(result.state.statusBatches).toEqual([
      expect.objectContaining({ batchId: first.batchId, stacks: 1 }),
      second,
    ])
    expect(result.events.findIndex((event) => event.type === 'RESOURCE_GAINED'))
      .toBeLessThan(result.events.findIndex((event) => (
        event.type === 'STATUS_REMOVED'
      )))
  })

  it('stacks attack gain on consecutive actions and clears it at turn end', () => {
    const awaiting = setup()
    const firstActionId = 'action:first-rising' as ActionId
    const firstStarted = startBattleAction(awaiting, {
      actionId: firstActionId,
      actorId: WANG_DAHAI_UNIT_ID,
      endsTurn: false,
    })
    expect(firstStarted.ok).toBe(true)
    if (!firstStarted.ok) return
    const first = applyWangDahaiRisingMomentum(firstStarted.state)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const firstUnit = first.state.units.find((unit) => unit.id === WANG_DAHAI_UNIT_ID)
    expect(firstUnit?.momentum).toBe(1)
    expect(firstUnit?.temporaryAttributeModifiers).toHaveLength(1)
    if (firstUnit !== undefined) expect(getEffectiveAttack(firstUnit)).toBe(23)

    const repeated = applyWangDahaiRisingMomentum(first.state)
    expect(repeated).toEqual({ ok: true, state: first.state, events: [] })
    const firstCompleted = completeBattleAction(
      first.state,
      firstActionId,
      WANG_DAHAI_BATTLE_EXTENSIONS,
    )
    expect(firstCompleted.ok).toBe(true)
    if (!firstCompleted.ok) return

    const secondActionId = 'action:second-rising' as ActionId
    const secondStarted = startBattleAction(firstCompleted.state, {
      actionId: secondActionId,
      actorId: WANG_DAHAI_UNIT_ID,
      endsTurn: true,
    })
    expect(secondStarted.ok).toBe(true)
    if (!secondStarted.ok) return
    const second = applyWangDahaiRisingMomentum(secondStarted.state)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const secondUnit = second.state.units.find((unit) => unit.id === WANG_DAHAI_UNIT_ID)
    expect(secondUnit?.momentum).toBe(2)
    expect(secondUnit?.temporaryAttributeModifiers).toHaveLength(2)
    if (secondUnit !== undefined) expect(getEffectiveAttack(secondUnit)).toBe(26)

    const ended = completeBattleAction(
      second.state,
      secondActionId,
      WANG_DAHAI_BATTLE_EXTENSIONS,
    )
    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    const endedUnit = ended.state.units.find((unit) => unit.id === WANG_DAHAI_UNIT_ID)
    expect(endedUnit?.baseAttackAtBattleEntry).toBe(20)
    expect(endedUnit?.temporaryAttributeModifiers).toEqual([])
    if (endedUnit !== undefined) expect(getEffectiveAttack(endedUnit)).toBe(22)
  })

  it('rolls momentum, modifiers, events, RNG, and the action back on failure', () => {
    const invalidModifier = {
      sourceId: WANG_DAHAI_UNIT_ID,
      attribute: 'attack',
      value: Number.NaN,
      duration: { kind: 'ownerTurns', remainingTurns: 1 },
    } as UnitState['temporaryAttributeModifiers'][number]
    const rng = createFixedSequenceRandomState([0.25])
    const awaiting = setup({
      temporaryAttributeModifiers: [invalidModifier],
    }, { rngState: rng })
    const actionId = 'action:failing-rising' as ActionId
    const started = startBattleAction(awaiting, {
      actionId,
      actorId: WANG_DAHAI_UNIT_ID,
      endsTurn: false,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const result = applyWangDahaiRisingMomentum(started.state)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('INVALID_TEMPORARY_MODIFIER_STATE')
    expect(result.state).toBe(awaiting)
    expect(result.state.units.find((unit) => unit.id === WANG_DAHAI_UNIT_ID)?.momentum)
      .toBe(0)
    expect(result.state.events).toBe(awaiting.events)
    expect(result.state.rngState).toBe(rng)
    expect(result.state.activeAction).toBeNull()
  })
})

describe('content extension composition', () => {
  it('keeps Wang Dahai and training dummy extensions working together', () => {
    const started = startBattleSequence(createBattleState([
      wang({ speed: 100 }),
      createTrainingDummy(),
    ]), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.state.personalTurn?.unitId).toBe(WANG_DAHAI_UNIT_ID)
    expect(started.state.units.find((unit) => unit.id === WANG_DAHAI_UNIT_ID)?.energy)
      .toBe(2)

    const completed = finishAction(
      started.state,
      WANG_DAHAI_UNIT_ID,
      'combined-wang-ends',
      true,
      GAME_CONTENT_BATTLE_EXTENSIONS,
    )
    const wangUnit = completed.units.find((unit) => unit.id === WANG_DAHAI_UNIT_ID)
    const dummyUnit = completed.units.find((unit) => unit.id === TRAINING_DUMMY_UNIT_ID)
    expect(completed.personalTurn?.unitId).toBe(WANG_DAHAI_UNIT_ID)
    expect(wangUnit).toMatchObject({ energy: 4, currentHealth: 150 })
    expect(dummyUnit).toMatchObject({ shield: 20, momentum: 5 })
  })
})
