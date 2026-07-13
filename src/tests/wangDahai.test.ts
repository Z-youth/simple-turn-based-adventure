import { describe, expect, it } from 'vitest'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  ResourceTransactionId,
  SkillBranchId,
  SkillExecutionId,
  SkillId,
  SpecialCounterId,
  StatusBatchId,
  StatusId,
} from '../game/core/identifiers'
import {
  completeBattleAction,
  requestPlayerEndTurn,
  startBattleAction,
  startBattleSequence,
} from '../game/core/battleEngine'
import type { BattleEngineExtensions } from '../game/core/battleEngine'
import type { BattleState } from '../game/core/contexts'
import {
  Camp,
  StackPolicy,
  StatusAcquisitionTiming,
  StatusCategory,
} from '../game/core/enums'
import { createFixedSequenceRandomState } from '../game/core/rng'
import { gainResource, ResourceType, spendResource } from '../game/core/resources'
import {
  increaseSpecialCounter,
  readSpecialCounter,
} from '../game/core/specialCounters'
import type { StatusBatch } from '../game/core/statuses'
import {
  getEffectiveAttack,
  getEffectiveCriticalDamage,
  getEffectiveCriticalRate,
} from '../game/core/unitQueries'
import type { UnitState } from '../game/core/units'
import {
  combineBattleEngineExtensions,
  GAME_CONTENT_BATTLE_EXTENSIONS,
} from '../game/content/battleExtensions'
import { createTrainingDummy, TRAINING_DUMMY_UNIT_ID } from '../game/content/bosses/trainingDummy'
import {
  applyWangDahaiRisingMomentum,
  createWangDahai,
  getWangDahaiStackingWaveUseCount,
  hasFreeMyriadRiversAtTurnEnd,
  isWangDahaiActiveSkillAllowed,
  useWangDahaiFirstSkill,
  useWangDahaiThirdSkill,
  WANG_DAHAI_BATTLE_EXTENSIONS,
  WANG_DAHAI_FIRST_SKILL_ID,
  WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID,
  WANG_DAHAI_NEW_TIDE_BRANCH_ID,
  WANG_DAHAI_STACKING_WAVE_BRANCH_ID,
  WANG_DAHAI_STACKING_WAVE_SKILL_LOCK_ID,
  WANG_DAHAI_THIRD_SKILL_ID,
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
      createUnit('other', { camp: Camp.Enemy, speed: 1 }),
    ]),
    ...stateOverrides,
  }
  const started = startBattleSequence(initial, extensions)
  if (!started.ok) throw new Error(`Could not start Wang Dahai test: ${started.reason}`)
  return started.state
}

function firstSkillRequest(
  name: string,
  branchId: SkillBranchId,
  targetUnitId = unitId('other'),
) {
  return {
    branchId,
    targetUnitId,
    actionId: `action:${name}` as ActionId,
    skillExecutionId: `skill-execution:${name}` as SkillExecutionId,
    attackId: `attack:${name}` as AttackId,
    damageEventId: `damage:${name}` as DamageEventId,
    resourceTransactionId: `resource-transaction:${name}` as ResourceTransactionId,
  }
}

function thirdSkillRequest(name: string) {
  return {
    actionId: `action:${name}` as ActionId,
    skillExecutionId: `skill-execution:${name}` as SkillExecutionId,
    resourceTransactionId: `resource-transaction:${name}` as ResourceTransactionId,
  }
}

function setupFirstSkill(
  wangOverrides: Partial<UnitState> = {},
  targetOverrides: Partial<UnitState> = {},
  stateOverrides: Partial<BattleState> = {},
): BattleState {
  return setup(wangOverrides, {
    ...stateOverrides,
    units: [
      wang({ speed: 200, ...wangOverrides }),
      createUnit('other', {
        camp: Camp.Enemy,
        speed: 1,
        ...targetOverrides,
      }),
    ],
  })
}

function setupMyriadRivers(
  wangOverrides: Partial<UnitState> = {},
  enemies: readonly UnitState[] = [
    createUnit('other', { camp: Camp.Enemy, speed: 1 }),
  ],
  stateOverrides: Partial<BattleState> = {},
): BattleState {
  return setup(wangOverrides, {
    ...stateOverrides,
    units: [wang({ speed: 200, ...wangOverrides }), ...enemies],
  })
}

function completePlainWangAction(
  state: BattleState,
  name: string,
  extensions: BattleEngineExtensions = WANG_DAHAI_BATTLE_EXTENSIONS,
) {
  const actionId = `action:${name}` as ActionId
  const started = startBattleAction(state, {
    actionId,
    actorId: WANG_DAHAI_UNIT_ID,
    countsAsAction: true,
    endsTurn: false,
  })
  if (!started.ok) throw new Error(`Could not start ${name}: ${started.reason}`)
  return completeBattleAction(started.state, actionId, extensions)
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

describe('Wang Dahai first skill branches', () => {
  it('resolves New Tide resources and damage in order and ends the turn', () => {
    const awaiting = setupFirstSkill()
    const turnId = awaiting.personalTurn?.personalTurnId
    const result = useWangDahaiFirstSkill(
      awaiting,
      firstSkillRequest('new-tide-values', WANG_DAHAI_NEW_TIDE_BRANCH_ID),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const wangUnit = result.state.units.find((unit) => (
      unit.id === WANG_DAHAI_UNIT_ID
    ))
    const target = result.state.units.find((unit) => unit.id === unitId('other'))
    expect(wangUnit).toMatchObject({ energy: 4, momentum: 2 })
    expect(target?.currentHealth).toBe(76)
    expect(result.state.personalTurn?.personalTurnId).not.toBe(turnId)
    expect(result.events.find((event) => event.type === 'ACTION_STARTED'))
      .toMatchObject({ endsTurn: true })
    expect(result.events.find((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
    ))).toMatchObject({
      context: {
        branchId: WANG_DAHAI_NEW_TIDE_BRANCH_ID,
        targetIds: [unitId('other')],
      },
    })
    const energyIndex = result.events.findIndex((event) => (
      event.type === 'RESOURCE_GAINED'
      && event.reason === 'wangDahaiNewTide'
      && event.resourceType === ResourceType.Energy
    ))
    const momentumIndex = result.events.findIndex((event) => (
      event.type === 'RESOURCE_GAINED'
      && event.reason === 'wangDahaiNewTide'
      && event.resourceType === ResourceType.Momentum
    ))
    const attackIndex = result.events.findIndex((event) => (
      event.type === 'ATTACK_STARTED'
    ))
    expect(energyIndex).toBeLessThan(momentumIndex)
    expect(momentumIndex).toBeLessThan(attackIndex)
  })

  it('resolves Stacking Wave at half attack, keeps the turn, and applies its lock', () => {
    const awaiting = setupFirstSkill()
    const turnId = awaiting.personalTurn?.personalTurnId
    const result = useWangDahaiFirstSkill(
      awaiting,
      firstSkillRequest('stacking-values', WANG_DAHAI_STACKING_WAVE_BRANCH_ID),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const wangUnit = result.state.units.find((unit) => (
      unit.id === WANG_DAHAI_UNIT_ID
    ))
    const target = result.state.units.find((unit) => unit.id === unitId('other'))
    expect(wangUnit).toMatchObject({ energy: 1, momentum: 3 })
    expect(target?.currentHealth).toBe(88.5)
    expect(result.state.personalTurn?.personalTurnId).toBe(turnId)
    expect(result.state.personalTurn?.countedActionCount).toBe(1)
    expect(result.events.find((event) => event.type === 'ACTION_STARTED'))
      .toMatchObject({ endsTurn: false })
    expect(result.events.findIndex((event) => event.type === 'ACTION_COMPLETED'))
      .toBeLessThan(result.events.findIndex((event) => (
        event.type === 'RESOURCE_GAINED'
        && event.reason === 'wangDahaiStackingWave'
      )))
    expect(wangUnit && readSpecialCounter(
      wangUnit,
      WANG_DAHAI_STACKING_WAVE_SKILL_LOCK_ID,
    )).toBe(1)
  })

  it('uses the momentum snapshot from before Rising Momentum for New Tide', () => {
    const awaiting = setupFirstSkill(
      { momentum: 1 },
      { momentum: 5, currentHealth: 200, maximumHealth: 200 },
    )
    const result = useWangDahaiFirstSkill(
      awaiting,
      firstSkillRequest('new-tide-snapshot', WANG_DAHAI_NEW_TIDE_BRANCH_ID),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === unitId('other')))
      .toMatchObject({ currentHealth: 175, momentum: 4 })
    const damageIndex = result.events.findIndex((event) => (
      event.type === 'DAMAGE_CALCULATED'
    ))
    const reductionIndex = result.events.findIndex((event) => (
      event.type === 'RESOURCE_SPENT'
      && event.unitId === unitId('other')
      && event.reason === 'wangDahaiNewTide'
    ))
    expect(damageIndex).toBeLessThan(reductionIndex)

    const highSnapshot = setupFirstSkill(
      { momentum: 2 },
      { momentum: 5, currentHealth: 200, maximumHealth: 200 },
    )
    const highResult = useWangDahaiFirstSkill(
      highSnapshot,
      firstSkillRequest('new-tide-high-snapshot', WANG_DAHAI_NEW_TIDE_BRANCH_ID),
    )
    expect(highResult.ok).toBe(true)
    if (highResult.ok) {
      expect(highResult.state.units.find((unit) => unit.id === unitId('other'))?.momentum)
        .toBe(5)
    }
  })

  it('grants 2, 4, 6, and 6 stacking momentum on consecutive uses', () => {
    let state = setupFirstSkill(
      { energy: 3 },
      { currentHealth: 1000, maximumHealth: 1000 },
    )
    const gains: number[] = []
    for (let use = 1; use <= 4; use += 1) {
      const result = useWangDahaiFirstSkill(
        state,
        firstSkillRequest(`stacking-${use}`, WANG_DAHAI_STACKING_WAVE_BRANCH_ID),
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      gains.push(...result.events.flatMap((event) => (
        event.type === 'RESOURCE_GAINED'
        && event.reason === 'wangDahaiStackingWave'
          ? [event.amount]
          : []
      )))
      state = result.state
    }

    const wangUnit = state.units.find((unit) => unit.id === WANG_DAHAI_UNIT_ID)
    expect(gains).toEqual([2, 4, 6, 6])
    expect(wangUnit && getWangDahaiStackingWaveUseCount(wangUnit)).toBe(4)
    expect(wangUnit).toMatchObject({ energy: 1, momentum: 2 })
    expect(state.personalTurn?.countedActionCount).toBe(4)
  })

  it('locks other active skills after Stacking Wave and resets next turn', () => {
    const first = useWangDahaiFirstSkill(
      setupFirstSkill(),
      firstSkillRequest('locking', WANG_DAHAI_STACKING_WAVE_BRANCH_ID),
    )
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const lockedUnit = first.state.units.find((unit) => (
      unit.id === WANG_DAHAI_UNIT_ID
    ))
    if (lockedUnit === undefined) return
    expect(isWangDahaiActiveSkillAllowed(
      lockedUnit,
      'skill:other' as SkillId,
    )).toBe(false)
    expect(isWangDahaiActiveSkillAllowed(
      lockedUnit,
      WANG_DAHAI_FIRST_SKILL_ID,
      WANG_DAHAI_NEW_TIDE_BRANCH_ID,
    )).toBe(false)
    expect(isWangDahaiActiveSkillAllowed(
      lockedUnit,
      WANG_DAHAI_FIRST_SKILL_ID,
      WANG_DAHAI_STACKING_WAVE_BRANCH_ID,
    )).toBe(true)
    const blocked = useWangDahaiFirstSkill(
      first.state,
      firstSkillRequest('blocked-new-tide', WANG_DAHAI_NEW_TIDE_BRANCH_ID),
    )
    expect(blocked).toMatchObject({
      ok: false,
      state: first.state,
      reason: 'WANG_DAHAI_ACTIVE_SKILL_LOCKED',
    })

    const ended = requestPlayerEndTurn(first.state, { hasLegalAction: false },
      WANG_DAHAI_BATTLE_EXTENSIONS)
    expect(ended.status).toBe('turnEnded')
    if (ended.status !== 'turnEnded') return
    const nextWangTurn = finishAction(
      ended.state,
      unitId('other'),
      'target-ends-for-lock-reset',
      true,
    )
    const resetUnit = nextWangTurn.units.find((unit) => (
      unit.id === WANG_DAHAI_UNIT_ID
    ))
    if (resetUnit === undefined) return
    expect(getWangDahaiStackingWaveUseCount(resetUnit)).toBe(0)
    expect(readSpecialCounter(
      resetUnit,
      WANG_DAHAI_STACKING_WAVE_SKILL_LOCK_ID,
    )).toBe(0)
    expect(isWangDahaiActiveSkillAllowed(
      resetUnit,
      'skill:other' as SkillId,
    )).toBe(true)
  })
})

describe('Wang Dahai first skill rollback', () => {
  it('rolls Rising Momentum back when Stacking Wave lacks energy', () => {
    const awaiting = setupFirstSkill({ energy: 0, momentum: 10 })
    const result = useWangDahaiFirstSkill(
      awaiting,
      firstSkillRequest('insufficient-energy', WANG_DAHAI_STACKING_WAVE_BRANCH_ID),
    )

    expect(result).toMatchObject({
      ok: false,
      state: awaiting,
      reason: 'INSUFFICIENT_RESOURCE',
    })
    expect(result.state.events).toBe(awaiting.events)
    expect(result.state.rngState).toBe(awaiting.rngState)
  })

  it('rejects an invalid target without changing battle state', () => {
    const awaiting = setupFirstSkill()
    const result = useWangDahaiFirstSkill(
      awaiting,
      firstSkillRequest(
        'invalid-target',
        WANG_DAHAI_NEW_TIDE_BRANCH_ID,
        unitId('missing'),
      ),
    )

    expect(result).toMatchObject({
      ok: false,
      state: awaiting,
      reason: 'WANG_DAHAI_FIRST_SKILL_INVALID_TARGET',
    })
  })

  it('rolls Rising Momentum and payment back when target validation fails', () => {
    const awaiting = setupFirstSkill({}, { shield: Number.NaN })
    const result = useWangDahaiFirstSkill(
      awaiting,
      firstSkillRequest('target-validation-failure', WANG_DAHAI_NEW_TIDE_BRANCH_ID),
    )

    expect(result).toMatchObject({
      ok: false,
      state: awaiting,
      reason: 'INVALID_UNIT_NUMERIC_STATE',
    })
    expect(result.state.units).toBe(awaiting.units)
    expect(result.state.events).toBe(awaiting.events)
  })

  it('rolls the action back when damage validation fails', () => {
    const awaiting = setupFirstSkill({
      criticalRate: 1,
      criticalDamage: Number.MAX_VALUE,
    })
    const result = useWangDahaiFirstSkill(
      awaiting,
      firstSkillRequest('damage-failure', WANG_DAHAI_NEW_TIDE_BRANCH_ID),
    )

    expect(result).toMatchObject({
      ok: false,
      state: awaiting,
      reason: 'INVALID_NUMERIC_INPUT',
    })
    expect(result.state.units).toBe(awaiting.units)
  })

  it('rolls payment, damage, RNG, and action back after a post-damage failure', () => {
    const rng = createFixedSequenceRandomState([0.1])
    const awaiting = setupFirstSkill(
      { criticalRate: 0.5, momentum: 1 },
      { currentHealth: 200, maximumHealth: 200, momentum: 0 },
      { rngState: rng },
    )
    const result = useWangDahaiFirstSkill(
      awaiting,
      firstSkillRequest('rng-then-failure', WANG_DAHAI_NEW_TIDE_BRANCH_ID),
    )

    expect(result).toMatchObject({
      ok: false,
      state: awaiting,
      reason: 'INSUFFICIENT_RESOURCE',
    })
    expect(result.state.rngState).toBe(rng)
    expect(result.state.rngState.cursor).toBe(0)
    expect(result.state.units).toBe(awaiting.units)
    expect(result.state.events).toBe(awaiting.events)
    expect(result.state.activeAction).toBeNull()
  })

  it('rolls the stacking count, lock, resources, and action back when completion fails', () => {
    const awaiting = setupFirstSkill()
    const failingExtensions = combineBattleEngineExtensions(
      WANG_DAHAI_BATTLE_EXTENSIONS,
      {
        applyAfterActionEffects(state) {
          return {
            ok: false,
            state,
            events: [],
            reason: 'TEST_AFTER_ACTION_FAILURE',
          }
        },
      },
    )
    const result = useWangDahaiFirstSkill(
      awaiting,
      firstSkillRequest('completion-failure', WANG_DAHAI_STACKING_WAVE_BRANCH_ID),
      failingExtensions,
    )

    expect(result).toMatchObject({
      ok: false,
      state: awaiting,
      reason: 'TEST_AFTER_ACTION_FAILURE',
    })
    expect(result.state.units).toBe(awaiting.units)
    expect(result.state.events).toBe(awaiting.events)
    expect(result.state.rngState).toBe(awaiting.rngState)
  })
})

describe('Wang Dahai first skill lethal and pressure behavior', () => {
  it('keeps lethal state and triggers momentum pressure once per execution target', () => {
    const request = firstSkillRequest(
      'lethal-pressure',
      WANG_DAHAI_NEW_TIDE_BRANCH_ID,
    )
    const result = useWangDahaiFirstSkill(
      setupFirstSkill(
        { momentum: 40 },
        { currentHealth: 10, maximumHealth: 10, momentum: 5 },
      ),
      request,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === unitId('other')))
      .toMatchObject({ alive: false, currentHealth: 0, momentum: 5 })
    expect(result.events.filter((event) => (
      event.type === 'MOMENTUM_PRESSURE_TRIGGERED'
      && event.skillExecutionId === request.skillExecutionId
      && event.targetUnitId === request.targetUnitId
    ))).toHaveLength(1)
    expect(result.events.filter((event) => (
      event.type === 'UNIT_DIED' && event.unitId === request.targetUnitId
    ))).toHaveLength(1)
  })
})

describe('Wang Dahai automatic Myriad Rivers', () => {
  it('does not trigger below ten momentum', () => {
    const awaiting = setupMyriadRivers({ momentum: 9 })
    const completed = completePlainWangAction(awaiting, 'myriad-below-threshold')

    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.state.units.find((unit) => (
      unit.id === WANG_DAHAI_UNIT_ID
    ))?.momentum).toBe(9)
    expect(completed.state.units.find((unit) => unit.id === unitId('other')))
      .toMatchObject({ currentHealth: 100 })
    expect(completed.events.some((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
      && event.skillId === WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID
    ))).toBe(false)
  })

  it('hits all living enemies once at ten momentum and then reduces ten momentum', () => {
    const awaiting = setupMyriadRivers({ momentum: 10 })
    const completed = completePlainWangAction(awaiting, 'myriad-threshold')

    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.state.units.find((unit) => (
      unit.id === WANG_DAHAI_UNIT_ID
    ))).toMatchObject({ energy: 0, momentum: 0 })
    expect(completed.state.units.find((unit) => unit.id === unitId('other')))
      .toMatchObject({ currentHealth: 70 })
    expect(completed.events.filter((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
      && event.skillId === WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID
    ))).toHaveLength(1)
    const damageIndex = completed.events.findIndex((event) => (
      event.type === 'DAMAGE_CALCULATED'
    ))
    const reductionIndex = completed.events.findIndex((event) => (
      event.type === 'RESOURCE_SPENT'
      && event.reason === 'wangDahaiMyriadRivers'
    ))
    expect(damageIndex).toBeLessThan(reductionIndex)
    expect(completed.state.completedSkillResolution).toBeNull()
  })

  it('rolls critical RNG independently for every living enemy', () => {
    const rng = createFixedSequenceRandomState([0.1, 0.9])
    const awaiting = setupMyriadRivers(
      { momentum: 10, criticalRate: 0.5 },
      [
        createUnit('enemy-one', { camp: Camp.Enemy, speed: 2 }),
        createUnit('enemy-two', { camp: Camp.Enemy, speed: 1 }),
      ],
      { rngState: rng },
    )
    const completed = completePlainWangAction(awaiting, 'myriad-multi-target')

    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.state.units.find((unit) => unit.id === unitId('enemy-one')))
      .toMatchObject({ currentHealth: 55 })
    expect(completed.state.units.find((unit) => unit.id === unitId('enemy-two')))
      .toMatchObject({ currentHealth: 70 })
    expect(completed.events.flatMap((event) => (
      event.type === 'CRITICAL_ROLLED' ? [event.critical] : []
    ))).toEqual([true, false])
    expect(completed.state.rngState.cursor).toBe(2)
    expect(completed.events.filter((event) => (
      event.type === 'DAMAGE_CALCULATED'
    ))).toHaveLength(2)
  })

  it('does not create an action, retrigger Rising Momentum, or recurse after action', () => {
    const awaiting = setupMyriadRivers(
      { momentum: 10, energy: 1 },
      [createUnit('other', {
        camp: Camp.Enemy,
        speed: 1,
        currentHealth: 500,
        maximumHealth: 500,
      })],
    )
    const result = useWangDahaiFirstSkill(
      awaiting,
      firstSkillRequest('myriad-no-action', WANG_DAHAI_STACKING_WAVE_BRANCH_ID),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.filter((event) => event.type === 'ACTION_STARTED'))
      .toHaveLength(1)
    expect(result.events.filter((event) => event.type === 'ACTION_COMPLETED'))
      .toHaveLength(1)
    expect(result.events.filter((event) => (
      event.type === 'RESOURCE_GAINED'
      && event.reason === 'wangDahaiRisingMomentum'
    ))).toHaveLength(1)
    expect(result.events.filter((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
      && event.skillId === WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID
    ))).toHaveLength(1)
    expect(result.state.personalTurn?.countedActionCount).toBe(1)
  })

  it('can trigger once after each consecutive Stacking Wave action', () => {
    let state = setupMyriadRivers(
      { momentum: 20, energy: 2 },
      [createUnit('other', {
        camp: Camp.Enemy,
        speed: 1,
        currentHealth: 1000,
        maximumHealth: 1000,
      })],
    )
    for (let use = 1; use <= 2; use += 1) {
      const result = useWangDahaiFirstSkill(
        state,
        firstSkillRequest(
          `myriad-consecutive-${use}`,
          WANG_DAHAI_STACKING_WAVE_BRANCH_ID,
        ),
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.events.filter((event) => (
        event.type === 'SKILL_RESOLUTION_STARTED'
        && event.skillId === WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID
      ))).toHaveLength(1)
      state = result.state
    }

    expect(state.events.filter((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
      && event.skillId === WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID
    ))).toHaveLength(2)
    expect(state.personalTurn?.countedActionCount).toBe(2)
    expect(state.units.find((unit) => unit.id === WANG_DAHAI_UNIT_ID)?.momentum)
      .toBe(8)
  })

  it('skips normally when the original action has killed every enemy', () => {
    const result = useWangDahaiFirstSkill(
      setupMyriadRivers(
        { momentum: 10 },
        [createUnit('other', {
          camp: Camp.Enemy,
          speed: 1,
          currentHealth: 1,
          maximumHealth: 1,
        })],
      ),
      firstSkillRequest('myriad-no-enemies', WANG_DAHAI_NEW_TIDE_BRANCH_ID),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === unitId('other')))
      .toMatchObject({ alive: false, currentHealth: 0 })
    expect(result.events.filter((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
      && event.skillId === WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID
    ))).toHaveLength(0)
    expect(result.state.units.find((unit) => (
      unit.id === WANG_DAHAI_UNIT_ID
    ))?.momentum).toBe(12)
  })

  it('keeps damage when resource protection prevents momentum reduction', () => {
    const protectionId = 'counter:test:myriad-protection' as SpecialCounterId
    const awaiting = setupMyriadRivers({
      momentum: 10,
      specialCounters: [{ counterId: protectionId, value: 1 }],
      resourceReductionProtections: [{
        resourceType: ResourceType.Momentum,
        counterId: protectionId,
        minimumCounterValue: 1,
      }],
    })
    const completed = completePlainWangAction(awaiting, 'myriad-protected')

    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.state.units.find((unit) => (
      unit.id === WANG_DAHAI_UNIT_ID
    ))?.momentum).toBe(10)
    expect(completed.state.units.find((unit) => unit.id === unitId('other')))
      .toMatchObject({ currentHealth: 70 })
    expect(completed.events.filter((event) => (
      event.type === 'RESOURCE_REDUCTION_PREVENTED'
      && event.reason === 'wangDahaiMyriadRivers'
    ))).toHaveLength(1)
  })

  it('rolls the original action back when automatic damage fails', () => {
    const awaiting = setupMyriadRivers({
      momentum: 10,
      criticalRate: 1,
      criticalDamage: Number.MAX_VALUE,
    })
    const completed = completePlainWangAction(awaiting, 'myriad-damage-failure')

    expect(completed).toMatchObject({
      ok: false,
      state: awaiting,
      reason: 'INVALID_NUMERIC_INPUT',
    })
    expect(completed.state.units).toBe(awaiting.units)
    expect(completed.state.events).toBe(awaiting.events)
    expect(completed.state.rngState).toBe(awaiting.rngState)
  })

  it('rolls the original action back when automatic critical RNG is exhausted', () => {
    const rng = createFixedSequenceRandomState([])
    const awaiting = setupMyriadRivers(
      { momentum: 10, criticalRate: 0.5 },
      undefined,
      { rngState: rng },
    )
    const completed = completePlainWangAction(awaiting, 'myriad-rng-failure')

    expect(completed).toMatchObject({
      ok: false,
      state: awaiting,
      reason: 'RANDOM_SOURCE_EXHAUSTED',
    })
    expect(completed.state.units).toBe(awaiting.units)
    expect(completed.state.events).toBe(awaiting.events)
    expect(completed.state.rngState).toBe(rng)
    expect(completed.state.rngState.cursor).toBe(0)
  })
})

describe('Wang Dahai Moonlit Tide', () => {
  it('spends five energy, applies two-turn critical buffs, gains two Tide, and keeps the turn', () => {
    const awaiting = setupFirstSkill({ energy: 3 })
    const turnId = awaiting.personalTurn?.personalTurnId
    const result = useWangDahaiThirdSkill(
      awaiting,
      thirdSkillRequest('moonlit-tide-values'),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const unit = result.state.units.find((candidate) => (
      candidate.id === WANG_DAHAI_UNIT_ID
    ))
    expect(unit).toMatchObject({ energy: 0, momentum: 1 })
    expect(unit && readSpecialCounter(unit, WANG_DAHAI_TIDE_COUNTER_ID)).toBe(2)
    if (unit !== undefined) {
      expect(getEffectiveCriticalRate(unit)).toBe(0.2)
      expect(getEffectiveCriticalDamage(unit)).toBe(1)
      expect(unit.temporaryAttributeModifiers.filter((modifier) => (
        modifier.sourceId === WANG_DAHAI_THIRD_SKILL_ID
      ))).toEqual([
        expect.objectContaining({
          attribute: 'criticalRate',
          value: 0.2,
          duration: { kind: 'ownerTurns', remainingTurns: 2 },
        }),
        expect.objectContaining({
          attribute: 'criticalDamage',
          value: 0.5,
          duration: { kind: 'ownerTurns', remainingTurns: 2 },
        }),
      ])
    }
    expect(result.state.personalTurn?.personalTurnId).toBe(turnId)
    expect(result.events.find((event) => event.type === 'ACTION_STARTED'))
      .toMatchObject({ endsTurn: false })
  })

  it('counts duration only at Wang Dahai turn end and removes buffs after two owner turns', () => {
    const used = useWangDahaiThirdSkill(
      setupFirstSkill({ energy: 3 }),
      thirdSkillRequest('moonlit-tide-duration'),
    )
    expect(used.ok).toBe(true)
    if (!used.ok) return

    const firstEnd = requestPlayerEndTurn(
      used.state,
      { hasLegalAction: false },
      WANG_DAHAI_BATTLE_EXTENSIONS,
    )
    expect(firstEnd.status).toBe('turnEnded')
    if (firstEnd.status !== 'turnEnded') return
    const afterFirstEnd = firstEnd.state.units.find((unit) => (
      unit.id === WANG_DAHAI_UNIT_ID
    ))
    expect(afterFirstEnd && readSpecialCounter(
      afterFirstEnd,
      WANG_DAHAI_TIDE_COUNTER_ID,
    )).toBe(1)
    expect(afterFirstEnd?.temporaryAttributeModifiers.filter((modifier) => (
      modifier.sourceId === WANG_DAHAI_THIRD_SKILL_ID
    ))).toEqual([
      expect.objectContaining({ duration: { kind: 'ownerTurns', remainingTurns: 1 } }),
      expect.objectContaining({ duration: { kind: 'ownerTurns', remainingTurns: 1 } }),
    ])

    const nextWangTurn = finishAction(
      firstEnd.state,
      unitId('other'),
      'moonlit-duration-other-end',
      true,
    )
    const duringSecondTurn = nextWangTurn.units.find((unit) => (
      unit.id === WANG_DAHAI_UNIT_ID
    ))
    expect(duringSecondTurn?.temporaryAttributeModifiers.filter((modifier) => (
      modifier.sourceId === WANG_DAHAI_THIRD_SKILL_ID
    ))).toHaveLength(2)

    const secondEnd = requestPlayerEndTurn(
      nextWangTurn,
      { hasLegalAction: false },
      WANG_DAHAI_BATTLE_EXTENSIONS,
    )
    expect(secondEnd.status).toBe('turnEnded')
    if (secondEnd.status !== 'turnEnded') return
    const afterSecondEnd = secondEnd.state.units.find((unit) => (
      unit.id === WANG_DAHAI_UNIT_ID
    ))
    expect(afterSecondEnd && readSpecialCounter(
      afterSecondEnd,
      WANG_DAHAI_TIDE_COUNTER_ID,
    )).toBe(0)
    expect(afterSecondEnd?.temporaryAttributeModifiers.filter((modifier) => (
      modifier.sourceId === WANG_DAHAI_THIRD_SKILL_ID
    ))).toEqual([])
  })

  it('rolls payment, Rising Momentum, buffs, Tide, events, and RNG back on failure', () => {
    const awaiting = setupFirstSkill({
      energy: 3,
      specialCounters: [{
        counterId: WANG_DAHAI_TIDE_COUNTER_ID,
        value: Number.MAX_SAFE_INTEGER,
      }],
    })
    const result = useWangDahaiThirdSkill(
      awaiting,
      thirdSkillRequest('moonlit-tide-failure'),
    )

    expect(result).toMatchObject({
      ok: false,
      state: awaiting,
      reason: 'SPECIAL_COUNTER_VALUE_OUT_OF_RANGE',
    })
    expect(result.state.units).toBe(awaiting.units)
    expect(result.state.events).toBe(awaiting.events)
    expect(result.state.rngState).toBe(awaiting.rngState)
    expect(result.state.activeAction).toBeNull()
  })
})

describe('Wang Dahai Tide protection', () => {
  it('protects skill and external momentum reductions while allowing gains', () => {
    const used = useWangDahaiThirdSkill(
      setupFirstSkill({ energy: 3 }),
      thirdSkillRequest('tide-protection'),
    )
    expect(used.ok).toBe(true)
    if (!used.ok || used.state.personalTurn === null) return
    const turn = used.state.personalTurn
    const skillSpend = spendResource(used.state, {
      unitId: WANG_DAHAI_UNIT_ID,
      resourceType: ResourceType.Momentum,
      amount: 1,
      reason: 'skillPayment',
      sourceId: String(WANG_DAHAI_THIRD_SKILL_ID),
      actionId: null,
      personalTurnId: turn.personalTurnId,
      sequenceId: turn.sequenceId,
      skillExecutionId: null,
      resourceTransactionId: null,
    })
    expect(skillSpend.ok).toBe(true)
    if (!skillSpend.ok) return
    const externalSpend = spendResource(skillSpend.state, {
      unitId: WANG_DAHAI_UNIT_ID,
      resourceType: ResourceType.Momentum,
      amount: 1,
      reason: 'externalReduction',
      sourceId: null,
      actionId: null,
      personalTurnId: turn.personalTurnId,
      sequenceId: turn.sequenceId,
      skillExecutionId: null,
      resourceTransactionId: null,
    })
    expect(externalSpend.ok).toBe(true)
    if (!externalSpend.ok) return
    const gained = gainResource(externalSpend.state, {
      unitId: WANG_DAHAI_UNIT_ID,
      resourceType: ResourceType.Momentum,
      amount: 2,
      reason: 'tideGainAllowed',
      sourceId: null,
      actionId: null,
      personalTurnId: turn.personalTurnId,
      sequenceId: turn.sequenceId,
      skillExecutionId: null,
      resourceTransactionId: null,
    })
    expect(gained.ok).toBe(true)
    if (!gained.ok) return
    expect(gained.state.units.find((unit) => (
      unit.id === WANG_DAHAI_UNIT_ID
    ))?.momentum).toBe(3)
    expect([
      ...skillSpend.events,
      ...externalSpend.events,
    ].filter((event) => event.type === 'RESOURCE_REDUCTION_PREVENTED'))
      .toHaveLength(2)
  })

  it('decreases one Tide each owner turn and restores momentum reduction at zero', () => {
    const used = useWangDahaiThirdSkill(
      setupFirstSkill({ energy: 3 }),
      thirdSkillRequest('tide-expiration'),
    )
    expect(used.ok).toBe(true)
    if (!used.ok) return
    const firstEnd = requestPlayerEndTurn(
      used.state,
      { hasLegalAction: false },
      WANG_DAHAI_BATTLE_EXTENSIONS,
    )
    expect(firstEnd.status).toBe('turnEnded')
    if (firstEnd.status !== 'turnEnded') return
    const nextWangTurn = finishAction(
      firstEnd.state,
      unitId('other'),
      'tide-expiration-other-end',
      true,
    )
    const protectedSpend = spendResource(nextWangTurn, {
      unitId: WANG_DAHAI_UNIT_ID,
      resourceType: ResourceType.Momentum,
      amount: 1,
      reason: 'stillProtected',
      sourceId: null,
      actionId: null,
      personalTurnId: nextWangTurn.personalTurn?.personalTurnId ?? null,
      sequenceId: nextWangTurn.personalTurn?.sequenceId ?? null,
      skillExecutionId: null,
      resourceTransactionId: null,
    })
    expect(protectedSpend.ok).toBe(true)
    if (!protectedSpend.ok) return
    expect(protectedSpend.events).toEqual([
      expect.objectContaining({ type: 'RESOURCE_REDUCTION_PREVENTED' }),
    ])
    const secondEnd = requestPlayerEndTurn(
      protectedSpend.state,
      { hasLegalAction: false },
      WANG_DAHAI_BATTLE_EXTENSIONS,
    )
    expect(secondEnd.status).toBe('turnEnded')
    if (secondEnd.status !== 'turnEnded') return
    const unit = secondEnd.state.units.find((candidate) => (
      candidate.id === WANG_DAHAI_UNIT_ID
    ))
    expect(unit && readSpecialCounter(unit, WANG_DAHAI_TIDE_COUNTER_ID)).toBe(0)
    const allowedSpend = spendResource(secondEnd.state, {
      unitId: WANG_DAHAI_UNIT_ID,
      resourceType: ResourceType.Momentum,
      amount: 1,
      reason: 'protectionExpired',
      sourceId: null,
      actionId: null,
      personalTurnId: secondEnd.state.personalTurn?.personalTurnId ?? null,
      sequenceId: secondEnd.state.personalTurn?.sequenceId ?? null,
      skillExecutionId: null,
      resourceTransactionId: null,
    })
    expect(allowedSpend.ok).toBe(true)
    if (allowedSpend.ok) {
      expect(allowedSpend.events).toEqual([
        expect.objectContaining({ type: 'RESOURCE_SPENT', amount: 1 }),
      ])
    }
  })
})

describe('Wang Dahai free turn-end Myriad Rivers', () => {
  it('triggers once from the fixed marker and does not reduce momentum', () => {
    const awaiting = setupMyriadRivers({ momentum: 10 })
    const ended = requestPlayerEndTurn(
      awaiting,
      { hasLegalAction: false },
      WANG_DAHAI_BATTLE_EXTENSIONS,
    )

    expect(ended.status).toBe('turnEnded')
    if (ended.status !== 'turnEnded') return
    expect(ended.events.filter((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
      && event.skillId === WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID
      && event.actionId === null
    ))).toHaveLength(1)
    expect(ended.events.filter((event) => (
      event.type === 'RESOURCE_SPENT'
      && event.reason === 'wangDahaiMyriadRivers'
    ))).toHaveLength(0)
    expect(ended.state.units.find((unit) => (
      unit.id === WANG_DAHAI_UNIT_ID
    ))?.momentum).toBe(10)
    expect(ended.state.units.find((unit) => unit.id === unitId('other')))
      .toMatchObject({ currentHealth: 70 })
  })

  it('orders ordinary Myriad Rivers, free Myriad Rivers, Tide loss, and common turn end', () => {
    const used = useWangDahaiThirdSkill(
      setupMyriadRivers(
        { momentum: 10, energy: 5 },
        [createUnit('other', {
          camp: Camp.Enemy,
          speed: 1,
          currentHealth: 1000,
          maximumHealth: 1000,
        })],
      ),
      thirdSkillRequest('ordinary-then-free'),
    )
    expect(used.ok).toBe(true)
    if (!used.ok) return
    const ended = requestPlayerEndTurn(
      used.state,
      { hasLegalAction: false },
      WANG_DAHAI_BATTLE_EXTENSIONS,
    )
    expect(ended.status).toBe('turnEnded')
    if (ended.status !== 'turnEnded') return
    const events = ended.state.events
    const ordinaryIndex = events.findIndex((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
      && event.skillId === WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID
      && event.actionId !== null
    ))
    const freeIndex = events.findIndex((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
      && event.skillId === WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID
      && event.actionId === null
    ))
    const tideLossIndex = events.findIndex((event) => (
      event.type === 'SPECIAL_COUNTER_CHANGED'
      && event.counterId === WANG_DAHAI_TIDE_COUNTER_ID
      && event.operation === 'decrease'
    ))
    const commonModifierIndex = events.findIndex((event) => (
      event.type === 'TEMPORARY_ATTRIBUTE_CHANGED'
      && event.operation === 'durationDecremented'
    ))
    expect(ordinaryIndex).toBeLessThan(freeIndex)
    expect(freeIndex).toBeLessThan(tideLossIndex)
    expect(tideLossIndex).toBeLessThan(commonModifierIndex)
    const unit = ended.state.units.find((candidate) => (
      candidate.id === WANG_DAHAI_UNIT_ID
    ))
    expect(unit?.momentum).toBe(11)
    expect(unit && readSpecialCounter(unit, WANG_DAHAI_TIDE_COUNTER_ID)).toBe(1)
  })

  it('skips without a living enemy and still completes Tide and turn-end processing', () => {
    const awaiting = setupMyriadRivers({
      momentum: 10,
      specialCounters: [{ counterId: WANG_DAHAI_TIDE_COUNTER_ID, value: 1 }],
    })
    const noEnemies: BattleState = {
      ...awaiting,
      units: awaiting.units.map((unit) => unit.id === unitId('other')
        ? { ...unit, currentHealth: 0, alive: false }
        : unit),
    }
    const ended = requestPlayerEndTurn(
      noEnemies,
      { hasLegalAction: false },
      WANG_DAHAI_BATTLE_EXTENSIONS,
    )

    expect(ended.status).toBe('turnEnded')
    if (ended.status !== 'turnEnded') return
    expect(ended.events.some((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
      && event.skillId === WANG_DAHAI_MYRIAD_RIVERS_SKILL_ID
      && event.actionId === null
    ))).toBe(false)
    const unit = ended.state.units.find((candidate) => (
      candidate.id === WANG_DAHAI_UNIT_ID
    ))
    expect(unit && readSpecialCounter(unit, WANG_DAHAI_TIDE_COUNTER_ID)).toBe(0)
  })

  it('rolls free damage and RNG back without undoing an already committed action', () => {
    const rng = createFixedSequenceRandomState([])
    const marked = setupMyriadRivers(
      { momentum: 10, criticalRate: 0.5 },
      undefined,
      { rngState: rng },
    )
    const reduced = spendResource(marked, {
      unitId: WANG_DAHAI_UNIT_ID,
      resourceType: ResourceType.Momentum,
      amount: 10,
      reason: 'avoidOrdinaryMyriad',
      sourceId: null,
      actionId: null,
      personalTurnId: marked.personalTurn?.personalTurnId ?? null,
      sequenceId: marked.personalTurn?.sequenceId ?? null,
      skillExecutionId: null,
      resourceTransactionId: null,
    })
    expect(reduced.ok).toBe(true)
    if (!reduced.ok) return
    const committed = completePlainWangAction(reduced.state, 'free-rng-committed')
    expect(committed.ok).toBe(true)
    if (!committed.ok) return
    const ended = requestPlayerEndTurn(
      committed.state,
      { hasLegalAction: false },
      WANG_DAHAI_BATTLE_EXTENSIONS,
    )

    expect(ended).toMatchObject({
      status: 'invalid',
      state: committed.state,
      reason: 'RANDOM_SOURCE_EXHAUSTED',
    })
    expect(ended.state.personalTurn?.completedActionIds).toEqual([
      'action:free-rng-committed',
    ])
    expect(ended.state.units).toBe(committed.state.units)
    expect(ended.state.events).toBe(committed.state.events)
    expect(ended.state.rngState).toBe(rng)
  })

  it('rolls free damage calculation failure back to the committed action', () => {
    const marked = setupMyriadRivers({
      momentum: 10,
      criticalRate: 1,
      criticalDamage: Number.MAX_VALUE,
    })
    const reduced = spendResource(marked, {
      unitId: WANG_DAHAI_UNIT_ID,
      resourceType: ResourceType.Momentum,
      amount: 10,
      reason: 'avoidOrdinaryMyriadForDamageFailure',
      sourceId: null,
      actionId: null,
      personalTurnId: marked.personalTurn?.personalTurnId ?? null,
      sequenceId: marked.personalTurn?.sequenceId ?? null,
      skillExecutionId: null,
      resourceTransactionId: null,
    })
    expect(reduced.ok).toBe(true)
    if (!reduced.ok) return
    const committed = completePlainWangAction(
      reduced.state,
      'free-damage-committed',
    )
    expect(committed.ok).toBe(true)
    if (!committed.ok) return
    const ended = requestPlayerEndTurn(
      committed.state,
      { hasLegalAction: false },
      WANG_DAHAI_BATTLE_EXTENSIONS,
    )

    expect(ended).toMatchObject({
      status: 'invalid',
      state: committed.state,
      reason: 'INVALID_NUMERIC_INPUT',
    })
    expect(ended.state.units).toBe(committed.state.units)
    expect(ended.state.events).toBe(committed.state.events)
    expect(ended.state.personalTurn?.completedActionIds).toEqual([
      'action:free-damage-committed',
    ])
  })

  it('rolls the whole turn-end hook back when a later unit effect fails', () => {
    const marked = setupMyriadRivers({ momentum: 10 })
    const reduced = spendResource(marked, {
      unitId: WANG_DAHAI_UNIT_ID,
      resourceType: ResourceType.Momentum,
      amount: 10,
      reason: 'prepareTurnEndRollback',
      sourceId: null,
      actionId: null,
      personalTurnId: marked.personalTurn?.personalTurnId ?? null,
      sequenceId: marked.personalTurn?.sequenceId ?? null,
      skillExecutionId: null,
      resourceTransactionId: null,
    })
    expect(reduced.ok).toBe(true)
    if (!reduced.ok || reduced.state.personalTurn === null) return
    const tide = increaseSpecialCounter(reduced.state, {
      unitId: WANG_DAHAI_UNIT_ID,
      counterId: WANG_DAHAI_TIDE_COUNTER_ID,
      amount: 1,
      actionId: null,
      personalTurnId: reduced.state.personalTurn.personalTurnId,
      sequenceId: reduced.state.personalTurn.sequenceId,
      skillExecutionId: null,
    })
    expect(tide.ok).toBe(true)
    if (!tide.ok) return
    const committed = completePlainWangAction(tide.state, 'turn-end-hook-committed')
    expect(committed.ok).toBe(true)
    if (!committed.ok) return
    const failingExtensions = combineBattleEngineExtensions(
      WANG_DAHAI_BATTLE_EXTENSIONS,
      {
        applyUnitTurnEndEffects(state) {
          return {
            ok: false,
            state,
            events: [],
            reason: 'TEST_LATE_TURN_END_FAILURE',
          }
        },
      },
    )
    const ended = requestPlayerEndTurn(
      committed.state,
      { hasLegalAction: false },
      failingExtensions,
    )

    expect(ended).toMatchObject({
      status: 'invalid',
      state: committed.state,
      reason: 'TEST_LATE_TURN_END_FAILURE',
    })
    const unit = ended.state.units.find((candidate) => (
      candidate.id === WANG_DAHAI_UNIT_ID
    ))
    expect(unit && readSpecialCounter(unit, WANG_DAHAI_TIDE_COUNTER_ID)).toBe(1)
    expect(ended.state.units.find((candidate) => candidate.id === unitId('other')))
      .toMatchObject({ currentHealth: 100 })
    expect(ended.state.personalTurn?.completedActionIds).toEqual([
      'action:turn-end-hook-committed',
    ])
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

  it('keeps Moonlit Tide, Wang turn end, and training dummy automation composed', () => {
    const started = startBattleSequence(createBattleState([
      wang({ speed: 100, energy: 3 }),
      createTrainingDummy(),
    ]), GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const used = useWangDahaiThirdSkill(
      started.state,
      thirdSkillRequest('combined-moonlit-tide'),
      GAME_CONTENT_BATTLE_EXTENSIONS,
    )
    expect(used.ok).toBe(true)
    if (!used.ok) return
    const ended = requestPlayerEndTurn(
      used.state,
      { hasLegalAction: false },
      GAME_CONTENT_BATTLE_EXTENSIONS,
    )
    expect(ended.status).toBe('turnEnded')
    if (ended.status !== 'turnEnded') return

    const wangUnit = ended.state.units.find((unit) => (
      unit.id === WANG_DAHAI_UNIT_ID
    ))
    const dummyUnit = ended.state.units.find((unit) => (
      unit.id === TRAINING_DUMMY_UNIT_ID
    ))
    expect(ended.state.personalTurn?.unitId).toBe(WANG_DAHAI_UNIT_ID)
    expect(wangUnit && readSpecialCounter(
      wangUnit,
      WANG_DAHAI_TIDE_COUNTER_ID,
    )).toBe(1)
    expect(wangUnit).toMatchObject({ energy: 2, currentHealth: 150 })
    expect(dummyUnit).toMatchObject({ shield: 20, momentum: 5 })
  })
})
