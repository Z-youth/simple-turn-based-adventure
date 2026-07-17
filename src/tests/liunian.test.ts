import { describe, expect, it } from 'vitest'
import { GAME_CONTENT_BATTLE_EXTENSIONS } from '../game/content/battleExtensions'
import {
  cleanupLiunianOnDeathOrLeave,
  createLiunian,
  getFlowTransferStacks,
  getLiunianActualMomentum,
  getLiunianBorrowedMomentum,
  getLiunianKanyuTargets,
  getLiunianTotalMomentum,
  isLiunianDomainActive,
  applyLiunianTurnEnd,
  LIUNIAN_HALVED_MOMENTUM_STATUS_ID,
  LIUNIAN_FLOW_TRANSFER_STATUS_ID,
  LIUNIAN_UNIT_ID,
  prepareLiunianFlowExchange,
  resolveLiunianFlowExchange,
  resolveLiunianMomentumGainTriggers,
  resolveLiunianDingxue,
  resolveLiunianDomain,
  resolveLiunianFlowChange,
  resolveLiunianKanyu,
  resolveLiunianNorthWind,
  resolveLiunianSouthWater,
} from '../game/content/characters/liunian'
import { createTrainingDummy, TRAINING_DUMMY_UNIT_ID } from '../game/content/bosses/trainingDummy'
import {
  startBattleAction,
  startBattleSequence,
  startTrainingBattle,
} from '../game/core/battleEngine'
import type { BattleState } from '../game/core/contexts'
import { Camp, PersonalTurnPhase, Position } from '../game/core/enums'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  ResourceTransactionId,
  PersonalTurnId,
  SkillExecutionId,
} from '../game/core/identifiers'
import { createFixedSequenceRandomState } from '../game/core/rng'
import { gainResource, loseResource, ResourceType } from '../game/core/resources'
import { getEffectiveAttack, getMomentumPressureLayers } from '../game/core/unitQueries'
import { addStatusToBattle, removeBattleStatus } from '../game/core/statusEngine'
import { createBattleState, createUnit } from './battleTestUtils'

function ids(prefix: string) {
  return {
    actionId: `${prefix}:action` as ActionId,
    skillExecutionId: `${prefix}:skill` as SkillExecutionId,
    attackId: `${prefix}:attack` as AttackId,
    damageEventId: `${prefix}:damage` as DamageEventId,
    resourceTransactionId: `${prefix}:resource` as ResourceTransactionId,
  }
}

function startLiunianBattle(
  allies: readonly ReturnType<typeof createUnit>[] = [],
  randomValues: readonly number[] | null = null,
): BattleState {
  const base = createBattleState([
    createLiunian(),
    ...allies,
    createTrainingDummy(),
  ])
  const state = randomValues === null
    ? base
    : { ...base, rngState: createFixedSequenceRandomState(randomValues) }
  const started = startTrainingBattle(state, GAME_CONTENT_BATTLE_EXTENSIONS)
  if (!started.ok) throw new Error(started.reason)
  return started.state
}

function updateLiunian(
  state: BattleState,
  update: (unit: ReturnType<typeof createLiunian>) => ReturnType<typeof createLiunian>,
): BattleState {
  return {
    ...state,
    units: state.units.map((unit) => unit.id === LIUNIAN_UNIT_ID
      ? update(unit as ReturnType<typeof createLiunian>)
      : unit),
  }
}

function startNextLiunianPersonalTurnForTest(
  state: BattleState,
  suffix: string,
): BattleState {
  if (state.personalTurn === null) throw new Error('Liunian personal turn is missing')
  return {
    ...state,
    personalTurn: {
      ...state.personalTurn,
      personalTurnId: `${state.personalTurn.personalTurnId}:${suffix}` as PersonalTurnId,
      startedActionIds: [],
      completedActionIds: [],
      countedActionCount: 0,
    },
  }
}

describe('Liunian core rules', () => {
  it('creates the fourth momentum character with exact base attributes', () => {
    expect(createLiunian()).toMatchObject({
      id: LIUNIAN_UNIT_ID,
      name: '流年',
      currentHealth: 120,
      maximumHealth: 120,
      baseAttackAtBattleEntry: 10,
      speed: 120,
      flow: 0,
    })
  })

  it('starts with six borrowed momentum that does not increase attack', () => {
    const state = startLiunianBattle()
    const liunian = state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)
    expect(liunian).toBeDefined()
    if (liunian === undefined) return
    expect(getLiunianBorrowedMomentum(liunian)).toBe(6)
    expect(getLiunianTotalMomentum(liunian)).toBe(6)
    expect(getEffectiveAttack(liunian)).toBe(10)
    expect(getMomentumPressureLayers(liunian)).toBe(6)
    expect(state.events).toContainEqual(expect.objectContaining({
      type: 'SPECIAL_COUNTER_CHANGED',
      unitId: LIUNIAN_UNIT_ID,
      counterId: 'counter:liunian:borrowed-momentum',
      operation: 'increase',
      amount: 6,
      effectId: 'liunianBorrowMomentum',
    }))
  })

  it('uses borrowed momentum first when momentum is lost or transferred', () => {
    let state = startLiunianBattle()
    state = updateLiunian(state, (unit) => ({ ...unit, momentum: 5 }))
    const lost = loseResource(state, {
      unitId: LIUNIAN_UNIT_ID,
      resourceType: ResourceType.Momentum,
      amount: 8,
      reason: 'test', sourceId: 'test', sourceUnitId: LIUNIAN_UNIT_ID,
      effectId: 'test', actionId: null, personalTurnId: null, sequenceId: null,
      skillExecutionId: null, resourceTransactionId: null,
    })
    expect(lost.ok).toBe(true)
    if (!lost.ok) return
    const liunian = lost.state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)
    expect(liunian).toBeDefined()
    if (liunian === undefined) return
    expect(getLiunianBorrowedMomentum(liunian)).toBe(0)
    expect(liunian.momentum).toBe(3)
    expect(getLiunianTotalMomentum(liunian)).toBe(3)
  })

  it('requires forty normal momentum for the full +20 attack cap', () => {
    const unit = { ...createLiunian(), momentum: 39 }
    expect(getEffectiveAttack(unit)).toBe(29.5)
    expect(getEffectiveAttack({ ...unit, momentum: 40 })).toBe(30)
  })

  it.each([
    [0.49, 7, 1],
    [0.5, 6, 0],
  ] as const)(
    'uses < 0.5 for one multi-layer teammate momentum event at RNG %s',
    (randomValue, expectedMomentum, expectedTriggers) => {
    const ally = createUnit('ally', { position: Position.Front1 })
    let state = startLiunianBattle([ally], [randomValue])
    const gained = gainResource(state, {
      unitId: ally.id,
      resourceType: ResourceType.Momentum,
      amount: 7,
      reason: 'allySkill', sourceId: 'ally', sourceUnitId: ally.id,
      effectId: 'allySkill', actionId: null, personalTurnId: null,
      sequenceId: null, skillExecutionId: null, resourceTransactionId: null,
    })
    expect(gained.ok).toBe(true)
    if (!gained.ok) return
    const triggered = resolveLiunianMomentumGainTriggers(gained.state)
    expect(triggered.ok).toBe(true)
    if (!triggered.ok) return
    const liunian = triggered.state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)
    expect(liunian === undefined ? 0 : getLiunianTotalMomentum(liunian))
      .toBe(expectedMomentum)
    expect(triggered.state.rngState.cursor).toBe(1)
    expect(triggered.events.filter((event) => event.type === 'PASSIVE_TRIGGERED'))
      .toHaveLength(expectedTriggers)
    expect(triggered.state.events.filter((event) => (
      event.type === 'RESOURCE_GAINED'
      && event.unitId === ally.id
      && event.resourceType === ResourceType.Momentum
    ))).toHaveLength(1)
  })

  it('rechecks the over-18 branch and grants only living flowing teammates momentum', () => {
    const flowing = createUnit('flowing', { position: Position.Front1 })
    const plain = createUnit('plain', { position: Position.Front2 })
    const deadFlowing = createUnit('dead-flowing', {
      position: Position.Back1,
      alive: false,
      currentHealth: 0,
    })
    let state = startLiunianBattle([flowing, plain, deadFlowing])
    state = updateLiunian(state, (unit) => ({ ...unit, momentum: 13 }))
    const flowBatch = (ownerUnitId: typeof flowing.id, order: number) => ({
      batchId: `flowing:${order}` as never,
      statusId: LIUNIAN_FLOW_TRANSFER_STATUS_ID,
      ownerUnitId,
      sourceUnitId: LIUNIAN_UNIT_ID,
      stacks: 1,
      effect: { calculation: 'perStack' as const, value: 1 },
      remainingOwnerTurns: null,
      acquiredAt: 'action' as const,
      acquisitionGroupId: `flowing:${order}`,
      acquisitionOrder: order,
      skipNextTurnEndDecrement: false,
      stackPolicy: 'mergeEquivalent' as const,
      category: 'buff' as const,
      canBeCleansed: false,
      canBeDispelled: false,
    })
    state = {
      ...state,
      statusBatches: [
        flowBatch(flowing.id, 1),
        flowBatch(deadFlowing.id, 2),
        flowBatch(LIUNIAN_UNIT_ID, 3),
      ],
      statusAcquisitionOrders: [1, 2, 3],
    }
    const gained = gainResource(state, {
      unitId: LIUNIAN_UNIT_ID, resourceType: ResourceType.Momentum, amount: 1,
      reason: 'crossThreshold', sourceId: 'test', sourceUnitId: LIUNIAN_UNIT_ID,
      effectId: 'test', actionId: null, personalTurnId: null, sequenceId: null,
      skillExecutionId: null, resourceTransactionId: null,
    })
    expect(gained.ok).toBe(true)
    if (!gained.ok) return
    const result = resolveLiunianMomentumGainTriggers(gained.state)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === flowing.id)?.momentum).toBe(1)
    expect(result.state.units.find((unit) => unit.id === plain.id)?.momentum).toBe(0)
    expect(result.state.units.find((unit) => unit.id === deadFlowing.id)?.momentum).toBe(0)
    expect(result.state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)?.momentum).toBe(14)
  })
})

describe('Liunian skills and domain', () => {
  it('computes Kanyu legal targets and applies refreshing halved momentum', () => {
    const ally = createUnit('ally', { momentum: 2, position: Position.Front1 })
    let state = startLiunianBattle([ally])
    state = {
      ...state,
      units: state.units.map((unit) => unit.id === TRAINING_DUMMY_UNIT_ID
        ? { ...unit, momentum: 4 }
        : unit),
    }
    expect(getLiunianKanyuTargets(state).map((unit) => unit.id))
      .toEqual([TRAINING_DUMMY_UNIT_ID])
    const used = resolveLiunianKanyu(state, {
      targetUnitId: TRAINING_DUMMY_UNIT_ID,
      ...ids('kanyu'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(used.ok, used.ok ? '' : used.reason).toBe(true)
    if (!used.ok) return
    const dummy = used.state.units.find((unit) => unit.id === TRAINING_DUMMY_UNIT_ID)
    expect(dummy === undefined ? 0 : getLiunianActualMomentum(used.state, dummy)).toBe(2)
    const firstBatch = used.state.statusBatches.find((batch) => (
      batch.statusId === LIUNIAN_HALVED_MOMENTUM_STATUS_ID
    ))
    expect(firstBatch).toBeDefined()
    if (firstBatch === undefined || dummy === undefined) return
    const refreshed = addStatusToBattle(used.state, {
      ...firstBatch,
      batchId: `${firstBatch.batchId}:refresh` as never,
      acquisitionOrder: firstBatch.acquisitionOrder + 1,
      remainingOwnerTurns: 1,
    })
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return
    expect(refreshed.state.statusBatches.filter((batch) => (
      batch.statusId === LIUNIAN_HALVED_MOMENTUM_STATUS_ID
    ))).toHaveLength(1)
    const gained = gainResource(refreshed.state, {
      unitId: dummy.id, resourceType: ResourceType.Momentum, amount: 2,
      reason: 'test', sourceId: 'test', sourceUnitId: LIUNIAN_UNIT_ID,
      effectId: 'test', actionId: null, personalTurnId: null, sequenceId: null,
      skillExecutionId: null, resourceTransactionId: null,
    })
    expect(gained.ok).toBe(true)
    if (!gained.ok) return
    const changedDummy = gained.state.units.find((unit) => unit.id === dummy.id)
    expect(changedDummy === undefined
      ? 0
      : getLiunianActualMomentum(gained.state, changedDummy)).toBe(3)
    const cleansed = removeBattleStatus(gained.state, {
      ownerUnitId: dummy.id,
      mode: 'cleanse',
    })
    expect(cleansed.ok).toBe(true)
    if (!cleansed.ok) return
    const restoredDummy = cleansed.state.units.find((unit) => unit.id === dummy.id)
    expect(restoredDummy === undefined
      ? 0
      : getLiunianActualMomentum(cleansed.state, restoredDummy)).toBe(6)
  })

  it('resolves Dingxue in energy, momentum, flow, damage order', () => {
    const state = startLiunianBattle()
    const used = resolveLiunianDingxue(state, {
      targetUnitId: TRAINING_DUMMY_UNIT_ID,
      ...ids('dingxue'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(used.ok, used.ok ? '' : used.reason).toBe(true)
    if (!used.ok) return
    const liunian = used.state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)
    expect(liunian).toMatchObject({ energy: 1, flow: 1 })
    expect(liunian === undefined ? 0 : getLiunianTotalMomentum(liunian)).toBe(8)
    const sequence = used.events.filter((event) => (
      event.type === 'RESOURCE_GAINED' || event.type === 'DAMAGE_CALCULATED'
    )).map((event) => event.type === 'RESOURCE_GAINED' ? event.resourceType : 'damage')
    expect(sequence.slice(0, 4)).toEqual(['energy', 'momentum', 'flow', 'damage'])
  })

  it('opens the domain without ending the turn and disables reopening', () => {
    let state = startLiunianBattle()
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 2 }))
    const opened = resolveLiunianDomain(state, ids('domain'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const liunian = opened.state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)
    expect(liunian === undefined ? false : isLiunianDomainActive(liunian)).toBe(true)
    expect(opened.state.personalTurn?.unitId).toBe(LIUNIAN_UNIT_ID)
    expect(resolveLiunianDomain(opened.state, ids('again')).ok).toBe(false)
  })

  it('stacks flow transfer on one ally and clears only the old ally when switching', () => {
    const first = createUnit('first', { position: Position.Front1 })
    const second = createUnit('second', { position: Position.Front2 })
    let state = startLiunianBattle([first, second])
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 5 }))
    const opened = resolveLiunianDomain(state, ids('domain'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const once = resolveLiunianFlowChange(opened.state, {
      targetUnitId: first.id, ...ids('flow-1'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(once.ok).toBe(true)
    if (!once.ok) return
    const nextTurn = startNextLiunianPersonalTurnForTest(once.state, 'next')
    const twice = resolveLiunianFlowChange(nextTurn, {
      targetUnitId: first.id, ...ids('flow-2'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(twice.ok).toBe(true)
    if (!twice.ok) return
    expect(getFlowTransferStacks(twice.state, LIUNIAN_UNIT_ID)).toBe(2)
    expect(getFlowTransferStacks(twice.state, first.id)).toBe(2)
    const thirdTurn = startNextLiunianPersonalTurnForTest(twice.state, 'third')
    const switched = resolveLiunianFlowChange(thirdTurn, {
      targetUnitId: second.id, ...ids('flow-3'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(switched.ok).toBe(true)
    if (!switched.ok) return
    expect(getFlowTransferStacks(switched.state, LIUNIAN_UNIT_ID)).toBe(3)
    expect(getFlowTransferStacks(switched.state, first.id)).toBe(0)
    expect(getFlowTransferStacks(switched.state, second.id)).toBe(1)
    expect(switched.events).toContainEqual(expect.objectContaining({
      type: 'STATUS_REMOVED',
      ownerUnitId: first.id,
      sourceUnitId: LIUNIAN_UNIT_ID,
      effectId: 'skill:liunian:flow-change',
    }))
  })

  it('accepts only actively selected living teammates as Flow Change targets', () => {
    const first = createUnit('first', { position: Position.Front1 })
    const second = createUnit('second', { position: Position.Front2 })
    const dead = createUnit('dead', {
      position: Position.Back1,
      alive: false,
      currentHealth: 0,
    })
    let state = startLiunianBattle([first, second, dead])
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 3 }))
    const opened = resolveLiunianDomain(state, ids('domain'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    for (const invalidTarget of [
      LIUNIAN_UNIT_ID,
      TRAINING_DUMMY_UNIT_ID,
      dead.id,
    ]) {
      const invalid = resolveLiunianFlowChange(opened.state, {
        targetUnitId: invalidTarget,
        ...ids(`invalid-${invalidTarget}`),
      }, GAME_CONTENT_BATTLE_EXTENSIONS)
      expect(invalid.ok).toBe(false)
      expect(invalid.state).toBe(opened.state)
    }
    const selected = resolveLiunianFlowChange(opened.state, {
      targetUnitId: second.id,
      ...ids('selected-second'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(selected.ok).toBe(true)
    if (!selected.ok) return
    expect(getFlowTransferStacks(selected.state, first.id)).toBe(0)
    expect(getFlowTransferStacks(selected.state, second.id)).toBe(1)
  })

  it('allows Flow Change once per personal turn and restores it next turn', () => {
    const ally = createUnit('ally', { position: Position.Front1 })
    let state = startLiunianBattle([ally])
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 3 }))
    const opened = resolveLiunianDomain(state, ids('domain'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const first = resolveLiunianFlowChange(opened.state, {
      targetUnitId: ally.id, ...ids('flow-first'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const sameTurn = resolveLiunianFlowChange(first.state, {
      targetUnitId: ally.id, ...ids('flow-same-turn'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(sameTurn.ok).toBe(false)
    if (!sameTurn.ok) {
      expect(sameTurn.reason).toBe('LIUNIAN_FLOW_CHANGE_ALREADY_USED_THIS_TURN')
    }
    expect(sameTurn.state).toBe(first.state)
    const nextTurn = startNextLiunianPersonalTurnForTest(first.state, 'next')
    const restored = resolveLiunianFlowChange(nextTurn, {
      targetUnitId: ally.id, ...ids('flow-next-turn'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(getFlowTransferStacks(restored.state, ally.id)).toBe(2)
  })

  it('rolls back a flow target switch when its energy payment fails', () => {
    const first = createUnit('first', { position: Position.Front1 })
    const second = createUnit('second', { position: Position.Front2 })
    let state = startLiunianBattle([first, second])
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 2 }))
    const opened = resolveLiunianDomain(state, ids('domain'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const flowed = resolveLiunianFlowChange(opened.state, {
      targetUnitId: first.id, ...ids('flow'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(flowed.ok).toBe(true)
    if (!flowed.ok) return
    const nextTurn = startNextLiunianPersonalTurnForTest(flowed.state, 'next')
    const failed = resolveLiunianFlowChange(nextTurn, {
      targetUnitId: second.id, ...ids('switch'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(failed.ok).toBe(false)
    expect(failed.state).toBe(nextTurn)
    expect(getFlowTransferStacks(failed.state, first.id)).toBe(1)
    expect(getFlowTransferStacks(failed.state, second.id)).toBe(0)
  })

  it('blocks actions until a forced flow exchange is resolved', () => {
    const ally = createUnit('ally', { momentum: 4, position: Position.Front1 })
    let state = startLiunianBattle([ally])
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 2 }))
    const opened = resolveLiunianDomain(state, ids('domain'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok || opened.state.personalTurn === null) return
    const flowed = resolveLiunianFlowChange(opened.state, {
      targetUnitId: ally.id, ...ids('flow'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(flowed.ok).toBe(true)
    if (!flowed.ok || flowed.state.personalTurn === null) return
    const pending = prepareLiunianFlowExchange(
      flowed.state,
      flowed.state.personalTurn,
    )
    expect(pending.ok).toBe(true)
    if (!pending.ok) return
    expect(pending.state.pendingForcedChoice?.kind).toBe('liunianFlowExchange')
    const blocked = startBattleAction(pending.state, {
      actionId: 'blocked:action' as ActionId,
      actorId: LIUNIAN_UNIT_ID,
      skillExecutionId: null,
      countsAsAction: true,
      endsTurn: true,
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.reason).toBe('FORCED_CHOICE_PENDING')
    const resolved = resolveLiunianFlowExchange(pending.state, 'otherLoses')
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.state.pendingForcedChoice).toBeNull()
  })

  it('repeats North Wind twice after two independent successful rolls', () => {
    let state = startLiunianBattle([], [0.1, 0.1])
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 1 }))
    const opened = resolveLiunianDomain(state, ids('domain'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const used = resolveLiunianNorthWind(opened.state, {
      targetUnitId: TRAINING_DUMMY_UNIT_ID,
      ...ids('north'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(used.ok, used.ok ? '' : used.reason).toBe(true)
    if (!used.ok) return
    expect(used.events.filter((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
      && event.skillId === 'skill:liunian:north-wind'
    ))).toHaveLength(3)
    expect(used.events.filter((event) => (
      event.type === 'RESOURCE_GAINED'
      && event.resourceType === ResourceType.Energy
      && event.reason === 'liunianNorthWind'
    ))).toHaveLength(3)
    expect(used.state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)?.energy).toBe(3)
    const consumed = used.events.filter((event) => (
      event.type === 'RESOURCE_GAINED'
      && event.reason === 'liunianNorthWindNextAllyTurn'
    )).length
    expect(consumed).toBe(1)
    expect(used.state.pendingEffects).toHaveLength(2)
    expect(used.state.rngState.cursor).toBe(2)
  })

  it('stops North Wind after the first repeat roll fails', () => {
    let state = startLiunianBattle([], [0.9])
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 1 }))
    const opened = resolveLiunianDomain(state, ids('domain'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const used = resolveLiunianNorthWind(opened.state, {
      targetUnitId: TRAINING_DUMMY_UNIT_ID,
      ...ids('north-single'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(used.ok, used.ok ? '' : used.reason).toBe(true)
    if (!used.ok) return
    expect(used.events.filter((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
      && event.skillId === 'skill:liunian:north-wind'
    ))).toHaveLength(1)
    expect(used.events.filter((event) => (
      event.type === 'RESOURCE_GAINED'
      && event.resourceType === ResourceType.Energy
      && event.reason === 'liunianNorthWind'
    ))).toHaveLength(1)
    expect(used.state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)?.energy).toBe(1)
    expect(used.state.rngState.cursor).toBe(1)
  })

  it('releases North Wind once more after success and stops on the next failure', () => {
    let state = startLiunianBattle([], [0.1, 0.9])
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 1 }))
    const opened = resolveLiunianDomain(state, ids('domain'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const used = resolveLiunianNorthWind(opened.state, {
      targetUnitId: TRAINING_DUMMY_UNIT_ID,
      ...ids('north-success-fail'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(used.ok, used.ok ? '' : used.reason).toBe(true)
    if (!used.ok) return
    expect(used.events.filter((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
      && event.skillId === 'skill:liunian:north-wind'
    ))).toHaveLength(2)
    expect(used.events.filter((event) => (
      event.type === 'RESOURCE_GAINED'
      && event.resourceType === ResourceType.Energy
      && event.reason === 'liunianNorthWind'
    ))).toHaveLength(2)
    expect(used.state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)?.energy).toBe(2)
    expect(used.state.rngState.cursor).toBe(2)
  })

  it('rolls back the whole North Wind chain when fixed RNG is exhausted', () => {
    let state = startLiunianBattle([], [])
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 1 }))
    const opened = resolveLiunianDomain(state, ids('domain'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const failed = resolveLiunianNorthWind(opened.state, {
      targetUnitId: TRAINING_DUMMY_UNIT_ID,
      ...ids('north-rng'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(failed.ok).toBe(false)
    expect(failed.state).toBe(opened.state)
  })

  it('cancels North Wind repeats when the fixed target dies', () => {
    const finiteEnemy = createUnit('fragile', {
      camp: Camp.Enemy,
      position: null,
      currentHealth: 1,
      maximumHealth: 1,
    })
    let state = createBattleState([createLiunian(), finiteEnemy])
    state = { ...state, rngState: createFixedSequenceRandomState([0]) }
    const started = startBattleSequence(state, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    state = updateLiunian(started.state, (unit) => ({ ...unit, energy: 1 }))
    const opened = resolveLiunianDomain(state, ids('domain'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const used = resolveLiunianNorthWind(opened.state, {
      targetUnitId: finiteEnemy.id,
      ...ids('north-death'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(used.ok, used.ok ? '' : used.reason).toBe(true)
    if (!used.ok) return
    expect(used.events.filter((event) => event.type === 'SKILL_RESOLUTION_STARTED'))
      .toHaveLength(1)
  })

  it('South Water heals only the actively selected living ally and ends the turn', () => {
    const firstAlly = createUnit('first-ally', {
      position: Position.Front1,
      currentHealth: 50,
      maximumHealth: 100,
    })
    const selectedAlly = createUnit('selected-ally', {
      position: Position.Front2,
      currentHealth: 40,
      maximumHealth: 100,
    })
    let state = startLiunianBattle([firstAlly, selectedAlly])
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 2 }))
    const opened = resolveLiunianDomain(state, ids('domain'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const originalTurnId = opened.state.personalTurn?.personalTurnId
    const healed = resolveLiunianSouthWater(opened.state, {
      targetUnitId: selectedAlly.id, ...ids('water-select'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(healed.ok).toBe(true)
    if (!healed.ok) return
    expect(healed.state.units.find((unit) => unit.id === firstAlly.id)?.currentHealth)
      .toBe(50)
    expect(healed.state.units.find((unit) => unit.id === selectedAlly.id)?.currentHealth)
      .toBe(45)
    expect(healed.state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)).toMatchObject({
      currentHealth: 120,
      energy: 0,
    })
    expect(healed.events).toContainEqual(expect.objectContaining({
      type: 'HEALTH_RESTORED',
      unitId: selectedAlly.id,
      amount: 5,
      skillExecutionId: ids('water-select').skillExecutionId,
    }))
    expect(healed.events.filter((event) => (
      event.type === 'HEALTH_RESTORED'
      && event.skillExecutionId === ids('water-select').skillExecutionId
    ))).toHaveLength(1)
    expect(healed.events.some((event) => (
      event.type === 'RESOURCE_GAINED'
      && event.reason === 'liunianSouthWaterFlowTransfer'
    ))).toBe(false)
    expect(healed.events).toContainEqual(expect.objectContaining({
      type: 'TURN_ENDED',
      unitId: LIUNIAN_UNIT_ID,
      personalTurnId: originalTurnId,
    }))
  })

  it('rejects Liunian, enemies, dead allies and off-field allies as South Water targets', () => {
    const livingAlly = createUnit('living-ally', { position: Position.Front1 })
    const deadAlly = createUnit('dead-ally', {
      position: Position.Front2,
      currentHealth: 0,
      alive: false,
    })
    const offFieldAlly = createUnit('off-field-ally', { position: Position.Back1 })
    let state = startLiunianBattle([livingAlly, deadAlly])
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 2 }))
    const opened = resolveLiunianDomain(state, ids('domain-invalid'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const withOffField = {
      ...opened.state,
      offFieldUnits: [{ unit: offFieldAlly, statusBatches: [] }],
    }
    for (const targetUnitId of [
      LIUNIAN_UNIT_ID,
      TRAINING_DUMMY_UNIT_ID,
      deadAlly.id,
      offFieldAlly.id,
    ]) {
      const rejected = resolveLiunianSouthWater(withOffField, {
        targetUnitId,
        ...ids(`water-invalid:${targetUnitId}`),
      }, GAME_CONTENT_BATTLE_EXTENSIONS)
      expect(rejected.ok).toBe(false)
      expect(rejected.state).toBe(withOffField)
    }
  })

  it('applies every South Water flow-transfer result using calculated healing', () => {
    const ally = createUnit('flow-ally', {
      position: Position.Front1,
      currentHealth: 99,
      maximumHealth: 100,
    })
    let state = startLiunianBattle([ally])
    state = updateLiunian(state, (unit) => ({
      ...unit,
      energy: 3,
      currentHealth: 100,
    }))
    const opened = resolveLiunianDomain(state, ids('domain-flow'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const flowed = resolveLiunianFlowChange(opened.state, {
      targetUnitId: ally.id,
      ...ids('flow-water'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(flowed.ok).toBe(true)
    if (!flowed.ok) return
    const stacked = {
      ...flowed.state,
      rngState: createFixedSequenceRandomState([0.9]),
      statusBatches: flowed.state.statusBatches.map((batch) => (
        batch.statusId === LIUNIAN_FLOW_TRANSFER_STATUS_ID
          && batch.ownerUnitId === ally.id
          ? { ...batch, stacks: 2 }
          : batch
      )),
    }
    const healed = resolveLiunianSouthWater(stacked, {
      targetUnitId: ally.id,
      ...ids('water-flow'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(healed.ok).toBe(true)
    if (!healed.ok) return
    expect(healed.state.units.find((unit) => unit.id === ally.id)).toMatchObject({
      currentHealth: 100,
      momentum: 2,
    })
    expect(healed.state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)?.currentHealth)
      .toBe(105)
    expect(healed.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'HEALTH_RESTORED', unitId: ally.id, amount: 1,
        reason: 'liunianSouthWater',
      }),
      expect.objectContaining({
        type: 'HEALTH_RESTORED', unitId: LIUNIAN_UNIT_ID, amount: 5,
        reason: 'liunianSouthWaterFlowTransfer',
      }),
      expect.objectContaining({
        type: 'RESOURCE_GAINED', unitId: ally.id, resourceType: ResourceType.Momentum,
        amount: 2, reason: 'liunianSouthWaterFlowTransfer',
      }),
    ]))
  })

  it('records understandable zero-healing feedback for South Water', () => {
    const ally = createUnit('full-health-ally', {
      position: Position.Front1,
      currentHealth: 100,
      maximumHealth: 100,
    })
    let state = startLiunianBattle([ally])
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 3 }))
    const opened = resolveLiunianDomain(state, ids('domain-zero'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const flowed = resolveLiunianFlowChange(opened.state, {
      targetUnitId: ally.id,
      ...ids('flow-zero'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(flowed.ok).toBe(true)
    if (!flowed.ok) return
    const healed = resolveLiunianSouthWater(flowed.state, {
      targetUnitId: ally.id,
      ...ids('water-zero'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(healed.ok).toBe(true)
    if (!healed.ok) return
    expect(healed.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'HEALTH_RESTORED', unitId: ally.id, amount: 0,
      }),
      expect.objectContaining({
        type: 'HEALTH_RESTORED', unitId: LIUNIAN_UNIT_ID, amount: 0,
      }),
    ]))
  })

  it('cleans domain, flow transfer, forced choice and queued gains on death or leave', () => {
    const ally = createUnit('ally', { position: Position.Front1 })
    let state = startLiunianBattle([ally])
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 2 }))
    const opened = resolveLiunianDomain(state, ids('domain'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const flowed = resolveLiunianFlowChange(opened.state, {
      targetUnitId: ally.id, ...ids('flow'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(flowed.ok).toBe(true)
    if (!flowed.ok) return
    const dirty = {
      ...flowed.state,
      pendingEffects: [{
        effectId: 'liunianNorthWindNextAllyTurn', timing: 'x',
        ownerUnitId: LIUNIAN_UNIT_ID, acquisitionOrder: 0, payload: {},
      }],
      pendingForcedChoice: {
        choiceId: 'x', unitId: ally.id, kind: 'liunianFlowExchange',
      },
    }
    const cleaned = cleanupLiunianOnDeathOrLeave(dirty)
    expect(cleaned.ok).toBe(true)
    if (!cleaned.ok) return
    expect(cleaned.state.pendingEffects).toEqual([])
    expect(cleaned.state.pendingForcedChoice).toBeNull()
    expect(cleaned.state.statusBatches.some((batch) => (
      batch.statusId === LIUNIAN_FLOW_TRANSFER_STATUS_ID
    ))).toBe(false)
  })

  it('deducts flow at Liunian turn end and closes the domain at zero', () => {
    const ally = createUnit('ally', { position: Position.Front1 })
    let state = startLiunianBattle([ally])
    state = updateLiunian(state, (unit) => ({ ...unit, energy: 2 }))
    const opened = resolveLiunianDomain(state, ids('domain'), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const flowed = resolveLiunianFlowChange(opened.state, {
      targetUnitId: ally.id, ...ids('flow'),
    }, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(flowed.ok).toBe(true)
    if (!flowed.ok || flowed.state.personalTurn === null) return
    const endingTurn = {
      ...flowed.state.personalTurn,
      phase: PersonalTurnPhase.EndingUnitSpecificEffects,
    }
    const ended = applyLiunianTurnEnd({
      ...flowed.state,
      personalTurn: endingTurn,
    }, endingTurn)
    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    const liunian = ended.state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)
    expect(liunian === undefined ? true : isLiunianDomainActive(liunian)).toBe(false)
    expect(ended.state.statusBatches.some((batch) => (
      batch.statusId === LIUNIAN_FLOW_TRANSFER_STATUS_ID
    ))).toBe(false)
  })
})
