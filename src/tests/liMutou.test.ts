import { describe, expect, it } from 'vitest'
import {
  endCurrentPersonalTurn,
  startBattleAction,
  startBattleSequence,
} from '../game/core/battleEngine'
import type { BattleState } from '../game/core/contexts'
import {
  Camp,
  DamageType,
  StackPolicy,
  StatusAcquisitionTiming,
  StatusCategory,
} from '../game/core/enums'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  ResourceTransactionId,
  SkillExecutionId,
  SkillId,
  StatusBatchId,
} from '../game/core/identifiers'
import { requestUnitPercentageMaximumHealthDamage } from '../game/core/vitality'
import { addStatusToBattle } from '../game/core/statusEngine'
import { resolveResourcePaidSkillTransaction } from '../game/core/resourceTransaction'
import { ResourceType } from '../game/core/resources'
import type { StatusBatch } from '../game/core/statuses'
import {
  getEffectiveAttack,
  getMomentumAttackLayers,
  getMomentumEffectLayers,
  getMomentumPressureLayers,
} from '../game/core/unitQueries'
import { createBattleState, createUnit, unitId } from './battleTestUtils'
import {
  createLiMutou,
  LI_MUTOU_AUTUMN_BRANCH_ID,
  LI_MUTOU_AUTUMN_STATUS_ID,
  LI_MUTOU_BATTLE_EXTENSIONS,
  LI_MUTOU_BLADE_DOMAIN_COUNTER_ID,
  LI_MUTOU_SPRING_BRANCH_ID,
  LI_MUTOU_SPRING_STATUS_ID,
  LI_MUTOU_UNIT_ID,
  useLiMutouFirstSkill,
  useLiMutouSecondSkill,
  useLiMutouThirdSkill,
} from '../game/content/characters/liMutou'

function li(overrides: Partial<ReturnType<typeof createLiMutou>> = {}) {
  return { ...createLiMutou(), ...overrides }
}

function setup(
  liOverrides: Partial<ReturnType<typeof createLiMutou>> = {},
  stateOverrides: Partial<BattleState> = {},
  enemyOverrides: Parameters<typeof createUnit>[1] = {},
): BattleState {
  const started = startBattleSequence({
    ...createBattleState([
      li({ speed: 300, ...liOverrides }),
      createUnit('enemy', { camp: Camp.Enemy, speed: 1, ...enemyOverrides }),
    ]),
    ...stateOverrides,
  }, LI_MUTOU_BATTLE_EXTENSIONS)
  if (!started.ok) throw new Error(started.reason)
  return started.state
}

function firstSkillRequest(name: string, branchId: typeof LI_MUTOU_SPRING_BRANCH_ID | typeof LI_MUTOU_AUTUMN_BRANCH_ID) {
  return {
    branchId,
    targetUnitId: unitId('enemy'),
    actionId: `action:${name}` as ActionId,
    skillExecutionId: `skill:${name}` as SkillExecutionId,
    attackId: `attack:${name}` as AttackId,
    damageEventId: `damage:${name}` as DamageEventId,
    resourceTransactionId: `resource:${name}` as ResourceTransactionId,
  }
}

function secondSkillRequest(name: string) {
  return {
    actionId: `action:${name}` as ActionId,
    skillExecutionId: `skill:${name}` as SkillExecutionId,
    resourceTransactionId: `resource:${name}` as ResourceTransactionId,
  }
}

function thirdSkillRequest(name: string) {
  return {
    targetUnitId: unitId('enemy'),
    actionId: `action:${name}` as ActionId,
    skillExecutionId: `skill:${name}` as SkillExecutionId,
    attackId: `attack:${name}` as AttackId,
    damageEventId: `damage:${name}` as DamageEventId,
    resourceTransactionId: `resource:${name}` as ResourceTransactionId,
  }
}

function status(
  name: string,
  statusId: typeof LI_MUTOU_SPRING_STATUS_ID | typeof LI_MUTOU_AUTUMN_STATUS_ID,
  acquisitionOrder: number,
): StatusBatch {
  return {
    batchId: `batch:${name}` as StatusBatchId,
    statusId,
    ownerUnitId: LI_MUTOU_UNIT_ID,
    sourceUnitId: LI_MUTOU_UNIT_ID,
    stacks: 1,
    effect: { calculation: 'total', value: 0 },
    remainingOwnerTurns: null,
    acquiredAt: StatusAcquisitionTiming.Action,
    acquisitionGroupId: `group:${name}`,
    acquisitionOrder,
    skipNextTurnEndDecrement: false,
    stackPolicy: StackPolicy.Independent,
    category: StatusCategory.Buff,
    canBeCleansed: false,
    canBeDispelled: false,
  }
}

function endTurn(state: BattleState): BattleState {
  const turn = state.personalTurn
  if (turn === null) throw new Error('Expected active turn')
  const ended = endCurrentPersonalTurn(
    state,
    turn.personalTurnId,
    LI_MUTOU_BATTLE_EXTENSIONS,
  )
  if (!ended.ok) throw new Error(ended.reason)
  return ended.state
}

function damageLiMutou(state: BattleState, percentage: number, name: string): BattleState {
  const result = requestUnitPercentageMaximumHealthDamage(state, {
    unitId: LI_MUTOU_UNIT_ID,
    percentage,
    skillExecutionId: `skill:${name}` as SkillExecutionId,
    attackId: `attack:${name}` as AttackId,
    damageEventId: `damage:${name}` as DamageEventId,
  })
  if (!result.ok) throw new Error(result.reason)
  return result.state
}

describe('Li Mutou base state and micro momentum', () => {
  it('defines the specified base state and all three momentum read ranges', () => {
    const base = createLiMutou()
    expect(base).toMatchObject({
      id: LI_MUTOU_UNIT_ID,
      name: '李木头',
      maximumHealth: 150,
      baseAttackAtBattleEntry: 20,
      speed: 95,
    })
    const low = { ...base, momentum: 8 }
    expect(getMomentumAttackLayers(low)).toBe(8)
    expect(getMomentumEffectLayers(low)).toBe(24)
    expect(getMomentumPressureLayers(low)).toBe(24)
    expect(getEffectiveAttack(low)).toBe(28)
    const middle = { ...base, momentum: 9 }
    expect(getMomentumAttackLayers(middle)).toBe(18)
    expect(getMomentumEffectLayers(middle)).toBe(9)
    expect(getEffectiveAttack(middle)).toBe(38)
    const high = { ...base, momentum: 16 }
    expect(getMomentumAttackLayers(high)).toBe(16)
    expect(getMomentumEffectLayers(high)).toBe(16)
    expect(getEffectiveAttack(high)).toBe(36)
  })

  it('reduces actual momentum before momentum pressure recalculation', () => {
    const state = setup({ momentum: 41 })

    expect(state.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID))
      .toMatchObject({ momentum: 39, momentumPressure: 0 })
    const reductionIndex = state.events.findIndex((event) => (
      event.type === 'RESOURCE_SPENT' && event.reason === 'liMutouMicroMomentum'
    ))
    const pressureIndex = state.events.findIndex((event) => (
      event.type === 'MOMENTUM_PRESSURE_RECALCULATED'
    ))
    expect(reductionIndex).toBeGreaterThan(-1)
    expect(reductionIndex).toBeLessThan(pressureIndex)

    const capped = setup({ momentum: 42 })
    expect(capped.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID))
      .toMatchObject({ momentum: 40, momentumPressure: 4 })
  })
})

describe('Li Mutou first skill and seasonal states', () => {
  it('resolves 一叶春 in order and heals health lost after its turn ends', () => {
    const spring = useLiMutouFirstSkill(
      setup(),
      firstSkillRequest('spring', LI_MUTOU_SPRING_BRANCH_ID),
    )
    expect(spring.ok).toBe(true)
    if (!spring.ok) return
    expect(spring.state.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID))
      .toMatchObject({ energy: 2, momentum: 3 })
    expect(spring.state.units.find((unit) => unit.id === unitId('enemy'))?.currentHealth)
      .toBe(81.6)
    expect(spring.state.statusBatches).toHaveLength(1)
    expect(spring.state.statusBatches[0]).toMatchObject({
      statusId: LI_MUTOU_SPRING_STATUS_ID,
    })

    const damaged = damageLiMutou(spring.state, 0.2, 'spring-window')
    const nextLiTurn = endTurn(damaged)
    expect(nextLiTurn.personalTurn?.unitId).toBe(LI_MUTOU_UNIT_ID)
    expect(nextLiTurn.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID))
      .toMatchObject({ currentHealth: 135, momentum: 1 })
    expect(nextLiTurn.statusBatches).toEqual([])
    const healIndex = nextLiTurn.events.findIndex((event) => (
      event.type === 'HEALTH_RESTORED' && event.reason === 'liMutouSpringBlossom'
    ))
    const pressureIndex = nextLiTurn.events.map((event) => event.type)
      .lastIndexOf('MOMENTUM_PRESSURE_RECALCULATED')
    expect(pressureIndex).toBeLessThan(healIndex)
  })

  it('defers extra 春华 layers and gives each trigger a new health-loss window', () => {
    let state = setup({}, {
      statusBatches: [
        status('spring-first', LI_MUTOU_SPRING_STATUS_ID, 1),
        status('spring-second', LI_MUTOU_SPRING_STATUS_ID, 2),
      ],
      statusAcquisitionOrders: [1, 2],
    })
    expect(state.statusBatches).toHaveLength(2)
    state = endTurn(state)
    state = damageLiMutou(state, 0.2, 'first-window')
    state = endTurn(state)
    expect(state.personalTurn?.unitId).toBe(LI_MUTOU_UNIT_ID)
    expect(state.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID)?.currentHealth)
      .toBe(135)
    expect(state.statusBatches).toHaveLength(1)

    state = endTurn(state)
    state = damageLiMutou(state, 0.1, 'second-window')
    state = endTurn(state)
    expect(state.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID)?.currentHealth)
      .toBe(127.5)
    expect(state.statusBatches).toEqual([])
  })

  it('resolves 一叶秋 as two independent attacks and triggers one 秋实 per later sequence', () => {
    const autumn = useLiMutouFirstSkill(
      setup(),
      firstSkillRequest('autumn', LI_MUTOU_AUTUMN_BRANCH_ID),
    )
    expect(autumn.ok).toBe(true)
    if (!autumn.ok) return
    expect(autumn.events.filter((event) => event.type === 'DAMAGE_CALCULATED'))
      .toHaveLength(2)
    expect(autumn.state.units.find((unit) => unit.id === unitId('enemy'))?.currentHealth)
      .toBe(76)
    const added = addStatusToBattle(autumn.state, status(
      'autumn-deferred',
      LI_MUTOU_AUTUMN_STATUS_ID,
      1,
    ))
    expect(added.ok).toBe(true)
    if (!added.ok) return

    let state = endTurn(added.state)
    expect(state.personalTurn?.unitId).toBe(LI_MUTOU_UNIT_ID)
    expect(state.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID)?.energy)
      .toBe(4)
    expect(state.statusBatches).toHaveLength(1)
    state = endTurn(state)
    state = endTurn(state)
    expect(state.personalTurn?.unitId).toBe(LI_MUTOU_UNIT_ID)
    expect(state.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID)?.energy)
      .toBe(7)
    expect(state.statusBatches).toEqual([])
  })
})

describe('Li Mutou blade domain and later skills', () => {
  const bladeDomain = [{
    counterId: LI_MUTOU_BLADE_DOMAIN_COUNTER_ID,
    value: 1,
  }]

  it('opens 刀域 with an action that does not end the turn and rejects reopening it', () => {
    const opened = useLiMutouSecondSkill(
      setup({ energy: 4 }),
      secondSkillRequest('blade-domain-open'),
    )
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    expect(opened.state.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID))
      .toMatchObject({ energy: 2, specialCounters: bladeDomain })
    expect(opened.state.personalTurn).toMatchObject({
      unitId: LI_MUTOU_UNIT_ID,
      countedActionCount: 1,
    })
    expect(opened.state.activeAction).toBeNull()

    const repeated = useLiMutouSecondSkill(
      opened.state,
      secondSkillRequest('blade-domain-repeated'),
    )
    expect(repeated).toMatchObject({
      ok: false,
      reason: 'LI_MUTOU_BLADE_DOMAIN_ALREADY_ACTIVE',
    })
  })

  it('triggers and pays for 刀域 after each 一叶秋 attack', () => {
    const result = useLiMutouFirstSkill(
      setup({ energy: 4, momentum: 5, specialCounters: bladeDomain }),
      firstSkillRequest('blade-domain-autumn', LI_MUTOU_AUTUMN_BRANCH_ID),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const extraEvents = result.events.filter((event) => (
      event.type === 'EXTRA_DAMAGE_APPLIED'
    ))
    expect(extraEvents).toHaveLength(2)
    expect(extraEvents.map((event) => event.damage.resolvedValue)).toEqual([21, 21])
    expect(result.events.filter((event) => (
      event.type === 'RESOURCE_SPENT' && event.reason === 'liMutouBladeDomain'
    ))).toHaveLength(2)
    expect(result.state.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID))
      .toMatchObject({ energy: 3, momentum: 7 })
  })

  it('keeps the ordinary attack but cancels 刀域 and its cost when that attack kills', () => {
    const result = useLiMutouFirstSkill(
      setup({ energy: 0, specialCounters: bladeDomain }, {}, {
        currentHealth: 10,
        maximumHealth: 10,
      }),
      firstSkillRequest('blade-domain-death', LI_MUTOU_SPRING_BRANCH_ID),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.filter((event) => event.type === 'DAMAGE_CALCULATED'))
      .toHaveLength(1)
    expect(result.events.filter((event) => event.type === 'EXTRA_DAMAGE_APPLIED'))
      .toHaveLength(0)
    expect(result.events.filter((event) => (
      event.type === 'RESOURCE_SPENT' && event.reason === 'liMutouBladeDomain'
    ))).toHaveLength(0)
    expect(result.state.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID)?.energy)
      .toBe(2)
  })

  it('does not use energy reserved for the current skill when checking 刀域', () => {
    const started = startBattleAction(
      setup({ energy: 2, specialCounters: bladeDomain }),
      {
        actionId: 'action:blade-domain-reserved' as ActionId,
        actorId: LI_MUTOU_UNIT_ID,
        skillExecutionId: 'skill:blade-domain-reserved' as SkillExecutionId,
        countsAsAction: true,
        endsTurn: false,
      },
    )
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null || started.state.activeAction === null) return
    const resolved = resolveResourcePaidSkillTransaction(started.state, {
      resourceTransactionId: 'resource:blade-domain-reserved' as ResourceTransactionId,
      actionId: started.state.activeAction.actionId,
      personalTurnId: started.state.personalTurn.personalTurnId,
      sequenceId: started.state.activeAction.sequenceId,
      skillExecutionId: 'skill:blade-domain-reserved' as SkillExecutionId,
      payerUnitId: LI_MUTOU_UNIT_ID,
      costs: [{ resourceType: ResourceType.Energy, amount: 2 }],
    }, {
      skillExecutionId: 'skill:blade-domain-reserved' as SkillExecutionId,
      skillId: 'skill:blade-domain-reserved' as SkillId,
      actionId: started.state.activeAction.actionId,
      personalTurnId: started.state.personalTurn.personalTurnId,
      sequenceId: started.state.activeAction.sequenceId,
      casterId: LI_MUTOU_UNIT_ID,
      attacks: [{
        attackId: 'attack:blade-domain-reserved' as AttackId,
        damageType: DamageType.Normal,
        effectiveAttack: 0,
        multiplier: 0,
        fixedDamage: 0,
        criticalRate: 0,
        criticalDamage: 0.5,
        normalDamageIncrease: 0,
        targets: [{
          targetId: unitId('enemy'),
          damageEventId: 'damage:blade-domain-reserved' as DamageEventId,
          extraDamage: {
            damageEventId: 'damage:blade-domain-reserved:extra' as DamageEventId,
            value: 3,
            resourceCostAfterDamage: {
              unitId: LI_MUTOU_UNIT_ID,
              resourceType: ResourceType.Energy,
              amount: 1,
              reason: 'liMutouBladeDomain',
            },
          },
        }],
      }],
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.events.filter((event) => event.type === 'DAMAGE_CALCULATED'))
      .toHaveLength(1)
    expect(resolved.events.filter((event) => event.type === 'EXTRA_DAMAGE_APPLIED'))
      .toHaveLength(0)
    expect(resolved.state.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID)?.energy)
      .toBe(0)
  })

  it('uses all recorded energy attacks, limits free 刀域 triggers to six, then directly sets resources', () => {
    const result = useLiMutouThirdSkill(
      setup({ energy: 8, momentum: 5, specialCounters: bladeDomain }, {}, {
        hasInfiniteHealth: true,
      }),
      thirdSkillRequest('third-skill'),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.filter((event) => event.type === 'DAMAGE_CALCULATED'))
      .toHaveLength(8)
    expect(result.events.filter((event) => event.type === 'EXTRA_DAMAGE_APPLIED'))
      .toHaveLength(6)
    expect(result.events.filter((event) => (
      event.type === 'RESOURCE_SPENT' && event.reason === 'liMutouBladeDomain'
    ))).toHaveLength(0)
    const resourceSet = result.events.filter((event) => event.type === 'RESOURCE_SET')
    expect(resourceSet).toHaveLength(2)
    expect(resourceSet.map((event) => event.resourceType)).toEqual([
      ResourceType.Momentum,
      ResourceType.Energy,
    ])
    expect(result.state.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID))
      .toMatchObject({ momentum: 6, energy: 2 })
  })

  it('closes 刀域 at Li Mutou turn end only when energy is depleted', () => {
    const closed = endTurn(setup({ energy: 0, specialCounters: bladeDomain }))
    expect(closed.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID)?.specialCounters)
      .toEqual([])

    const retained = endTurn(setup({ energy: 1, specialCounters: bladeDomain }))
    expect(retained.units.find((unit) => unit.id === LI_MUTOU_UNIT_ID)?.specialCounters)
      .toEqual(bladeDomain)
  })
})
