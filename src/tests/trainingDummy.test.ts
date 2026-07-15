import { describe, expect, it } from 'vitest'
import type { NormalAttackRequest } from '../game/core/attacks'
import {
  completeBattleAction,
  startBattleAction,
  startBattleSequence,
} from '../game/core/battleEngine'
import type { BattleEngineExtensions } from '../game/core/battleEngine'
import {
  Camp,
  DamageType,
  Position,
  StackPolicy,
  StatusAcquisitionTiming,
  StatusCategory,
  TurnStartStage,
} from '../game/core/enums'
import type { BattleEvent } from '../game/core/events'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  ResourceTransactionId,
  SkillExecutionId,
  StatusBatchId,
  StatusId,
} from '../game/core/identifiers'
import { createFixedSequenceRandomState } from '../game/core/rng'
import { resolveSkillTransaction } from '../game/core/resolutionTransaction'
import { removeBattleStatus } from '../game/core/statusEngine'
import type { UnitState } from '../game/core/units'
import {
  requestUnitDefeat,
  requestUnitPercentageMaximumHealthDamage,
  requestUnitVitalState,
} from '../game/core/vitality'
import {
  applyTrainingDummyTurnStartPassives,
  createTrainingDummy,
  runTrainingDummyAutomaticTurn,
  TRAINING_DUMMY_BATTLE_EXTENSIONS,
  TRAINING_DUMMY_UNIT_ID,
} from '../game/content/bosses/trainingDummy'
import { createBattleState, createUnit, unitId } from './battleTestUtils'
import { createResolvingState, ids, skillRequest } from './combatTestUtils'

const passiveOnlyExtensions: BattleEngineExtensions = {
  applyUnitPassiveEffects:
    TRAINING_DUMMY_BATTLE_EXTENSIONS.applyUnitPassiveEffects,
}

function dummy(overrides: Partial<UnitState> = {}): UnitState {
  return { ...createTrainingDummy(), speed: 200, ...overrides }
}

function battleState(
  units: readonly UnitState[],
  randomValues?: readonly number[],
) {
  const initial = createBattleState(units)
  return randomValues === undefined
    ? initial
    : { ...initial, rngState: createFixedSequenceRandomState(randomValues) }
}

function startWithPassivesOnly(units: readonly UnitState[]) {
  const result = startBattleSequence(
    battleState(units),
    passiveOnlyExtensions,
  )
  if (!result.ok || result.state.personalTurn?.unitId !== TRAINING_DUMMY_UNIT_ID) {
    throw new Error('Could not start passive-only training dummy turn')
  }
  return result.state
}

function startAutomatic(
  units: readonly UnitState[],
  randomValues?: readonly number[],
) {
  const result = startBattleSequence(
    battleState(units, randomValues),
    TRAINING_DUMMY_BATTLE_EXTENSIONS,
  )
  if (!result.ok) throw new Error(result.reason)
  return result
}

function selectedTargetId(events: ReturnType<typeof startAutomatic>['events']) {
  return findDummyAttack(events)?.context.targetIds[0]
}

function findDummyAttack(events: readonly BattleEvent[]) {
  return events.find((event): event is Extract<
    BattleEvent,
    { type: 'ATTACK_STARTED' }
  > => (
    event.type === 'ATTACK_STARTED'
    && event.context.attackerId === TRAINING_DUMMY_UNIT_ID
  ))
}

function findDummyDamage(events: readonly BattleEvent[]) {
  return events.find((event): event is Extract<
    BattleEvent,
    { type: 'DAMAGE_CALCULATED' }
  > => (
    event.type === 'DAMAGE_CALCULATED'
    && event.damage.sourceUnitId === TRAINING_DUMMY_UNIT_ID
  ))
}

function vitalityContext() {
  return {
    skillExecutionId: 'skill-execution:vitality' as SkillExecutionId,
    attackId: 'attack:vitality' as AttackId,
    damageEventId: 'damage:vitality' as DamageEventId,
  }
}

function normalAttack(
  name: string,
  targetId: ReturnType<typeof unitId>,
  overrides: Partial<NormalAttackRequest> = {},
): NormalAttackRequest {
  return {
    attackId: ids.attack(`attack:${name}`),
    damageType: DamageType.Normal,
    effectiveAttack: 20,
    multiplier: 1,
    fixedDamage: 0,
    criticalRate: 0,
    criticalDamage: 0.5,
    normalDamageIncrease: 0,
    targets: [{
      targetId,
      damageEventId: ids.damage(`damage:${name}`),
    }],
    ...overrides,
  }
}

describe('training dummy content', () => {
  it('creates a real infinite-health momentum boss', () => {
    expect(createTrainingDummy()).toMatchObject({
      id: TRAINING_DUMMY_UNIT_ID,
      name: '训练假人',
      camp: Camp.Enemy,
      isBoss: true,
      position: null,
      currentHealth: 1,
      maximumHealth: 1,
      hasInfiniteHealth: true,
      baseAttackAtBattleEntry: 5,
      speed: 1,
      shield: 0,
      momentum: 0,
      momentumPressure: 0,
      alive: true,
    })
  })

  it('applies its passive once and ignores repeated calls in the same turn', () => {
    const state = startWithPassivesOnly([
      dummy(),
      createUnit('player', { speed: 100 }),
    ])
    const beforeDuplicateEvents = state.events
    const duplicate = applyTrainingDummyTurnStartPassives(state)

    expect(state.units.find((unit) => unit.id === TRAINING_DUMMY_UNIT_ID))
      .toMatchObject({ shield: 20, momentum: 5 })
    expect(state.personalTurn?.unitPassiveEffectsApplied).toBe(true)
    expect(duplicate.ok).toBe(true)
    if (!duplicate.ok) return
    expect(duplicate.state).toBe(state)
    expect(duplicate.events).toEqual([])
    expect(duplicate.state.events).toBe(beforeDuplicateEvents)
    expect(duplicate.state.rngState).toBe(state.rngState)
  })

  it('does not repeat passives when automatic action follows manual passive entry', () => {
    const state = startWithPassivesOnly([
      dummy(),
      createUnit('player', { speed: 100 }),
    ])
    const result = runTrainingDummyAutomaticTurn(state)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === TRAINING_DUMMY_UNIT_ID))
      .toMatchObject({ shield: 20, momentum: 5 })
    expect(result.state.events.filter((event) => (
      event.type === 'SHIELD_GAINED'
      && event.reason === 'trainingDummySteadfast'
    ))).toHaveLength(1)
  })

  it('allows the passive once again on the next personal turn', () => {
    const first = startAutomatic([
      dummy(),
      createUnit('player', { speed: 100 }),
    ])
    expect(first.state.personalTurn?.unitId).toBe(unitId('player'))
    const playerActionId = 'action:player-pass' as ActionId
    const started = startBattleAction(first.state, {
      actionId: playerActionId,
      actorId: unitId('player'),
      endsTurn: true,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const completed = completeBattleAction(
      started.state,
      playerActionId,
      TRAINING_DUMMY_BATTLE_EXTENSIONS,
    )

    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.state.units.find((unit) => (
      unit.id === TRAINING_DUMMY_UNIT_ID
    ))).toMatchObject({ shield: 45, momentum: 10 })
    expect(completed.state.events.filter((event) => (
      event.type === 'SHIELD_GAINED'
      && event.reason === 'trainingDummySteadfast'
    ))).toHaveLength(2)
  })

  it('runs passive shield, passive momentum, pressure, status stage, and action in exact order', () => {
    const result = startAutomatic([
      dummy({ momentum: 20, momentumPressure: 7, shield: 3 }),
      createUnit('player', { speed: 100 }),
    ])
    const labels = result.events.map((event) => {
      if (event.type === 'MOMENTUM_PRESSURE_RECALCULATED') return 'pressure'
      if (event.type === 'SHIELD_GAINED'
        && event.reason === 'trainingDummySteadfast') return 'passiveShield'
      if (event.type === 'RESOURCE_GAINED'
        && event.reason === 'trainingDummyMomentum') return 'passiveMomentum'
      if (event.type === 'TURN_START_STAGE_COMPLETED') {
        return `completed:${event.stage}`
      }
      if (event.type === 'TURN_START_STAGE_ENTERED') {
        return `entered:${event.stage}`
      }
      if (event.type === 'ACTION_STARTED'
        && event.unitId === TRAINING_DUMMY_UNIT_ID) return 'action'
      return event.type
    })

    expect(labels.indexOf('passiveShield')).toBeLessThan(
      labels.indexOf('passiveMomentum'),
    )
    expect(labels.indexOf('passiveMomentum')).toBeLessThan(
      labels.indexOf('pressure'),
    )
    expect(labels.indexOf('pressure')).toBeLessThan(
      labels.indexOf(`completed:${TurnStartStage.SystemRules}`),
    )
    expect(labels.indexOf(`completed:${TurnStartStage.SystemRules}`)).toBeLessThan(
      labels.indexOf(`entered:${TurnStartStage.StatusEffects}`),
    )
    expect(labels.indexOf(`completed:${TurnStartStage.StatusEffects}`)).toBeLessThan(
      labels.indexOf('action'),
    )
  })

  it('automatically acts through generic battle progression', () => {
    const result = startAutomatic([
      dummy(),
      createUnit('player', { speed: 100 }),
    ])

    expect(result.state.personalTurn?.unitId).toBe(unitId('player'))
    expect(result.events.find((event) => (
      event.type === 'ACTION_COMPLETED'
      && event.unitId === TRAINING_DUMMY_UNIT_ID
    ))).toMatchObject({ countedActionCount: 1 })
    expect(result.events.filter((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
      && event.casterId === TRAINING_DUMMY_UNIT_ID
    ))).toHaveLength(1)
    expect(findDummyDamage(result.events)?.damage).toMatchObject({
      rawValue: 10,
      resolvedValue: 10,
    })
  })

  it('targets only a living player and uses replayable RNG for multiple targets', () => {
    const units = [
      dummy(),
      createUnit('dead', { speed: 100, currentHealth: 0, alive: false }),
      createUnit('first', { position: Position.Front1, speed: 90 }),
      createUnit('second', { position: Position.Front2, speed: 80 }),
      createUnit('enemy', { camp: Camp.Enemy, position: null, speed: 70 }),
    ]
    const first = startAutomatic(units, [0.75])
    const replay = startAutomatic(units, [0.75])

    expect(selectedTargetId(first.events)).toBe(unitId('second'))
    expect(selectedTargetId(replay.events)).toBe(unitId('second'))
    expect(first.state.rngState).toEqual(replay.state.rngState)
    expect(first.state.rngState.cursor).toBe(1)
  })

  it('uses a multiplier-1 normal attack and attack-start protection snapshot', () => {
    const result = startAutomatic([
      dummy(),
      createUnit('front', { position: Position.Front1, speed: 100 }),
      createUnit('back', { position: Position.Back1, speed: 90 }),
    ], [0.75])
    const attack = findDummyAttack(result.events)
    const damage = findDummyDamage(result.events)

    expect(attack?.context.protectionSnapshot).toContainEqual({
      targetId: unitId('back'),
      protectedByUnitId: unitId('front'),
      reduction: 0.5,
    })
    expect(damage?.damage).toMatchObject({
      targetUnitId: unitId('back'),
      damageType: DamageType.Normal,
      rawValue: 5,
      resolvedValue: 5,
    })
  })

  it('records shield absorption without health loss or death from normal damage', () => {
    const resolving = createResolvingState([
      createUnit('attacker', { speed: 300, baseAttackAtBattleEntry: 20 }),
      dummy({ speed: 1, shield: 5 }),
    ])
    const result = resolveSkillTransaction(resolving, skillRequest(resolving, [
      normalAttack('normal-infinite', TRAINING_DUMMY_UNIT_ID),
    ]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === TRAINING_DUMMY_UNIT_ID))
      .toMatchObject({ shield: 0, currentHealth: 1, alive: true })
    expect(result.events.find((event) => event.type === 'DAMAGE_CALCULATED')
      ?.damage).toMatchObject({
      shieldAbsorbed: 5,
      healthLost: 0,
      causedDeath: false,
    })
    expect(result.events.some((event) => event.type === 'UNIT_DIED')).toBe(false)
  })

  it('survives generic extra damage with structured records', () => {
    const resolving = createResolvingState([
      createUnit('attacker', { speed: 300 }),
      dummy({ speed: 1 }),
    ])
    const attack = normalAttack('extra-infinite', TRAINING_DUMMY_UNIT_ID, {
      targets: [{
        targetId: TRAINING_DUMMY_UNIT_ID,
        damageEventId: ids.damage('damage:extra-base'),
        extraDamage: {
          damageEventId: ids.damage('damage:extra-attached'),
          value: 50,
        },
      }],
    })
    const result = resolveSkillTransaction(
      resolving,
      skillRequest(resolving, [attack]),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === TRAINING_DUMMY_UNIT_ID))
      .toMatchObject({ currentHealth: 1, alive: true })
    expect(result.events.find((event) => event.type === 'EXTRA_DAMAGE_APPLIED')
      ?.damage).toMatchObject({
      resolvedValue: 50,
      healthLost: 0,
      causedDeath: false,
    })
    expect(result.events.some((event) => event.type === 'UNIT_DIED')).toBe(false)
  })

  it('applies momentum-pressure extra damage once per skill and target', () => {
    const resolving = createResolvingState([
      createUnit('attacker', {
        speed: 300,
        momentum: 20,
        momentumPressure: 2,
      }),
      dummy({ speed: 1, shield: 100 }),
    ])
    const result = resolveSkillTransaction(resolving, skillRequest(resolving, [
      normalAttack('pressure-first', TRAINING_DUMMY_UNIT_ID),
      normalAttack('pressure-second', TRAINING_DUMMY_UNIT_ID),
    ]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.filter((event) => (
      event.type === 'MOMENTUM_PRESSURE_TRIGGERED'
      && event.targetUnitId === TRAINING_DUMMY_UNIT_ID
    ))).toHaveLength(1)
    expect(result.events.filter((event) => (
      event.type === 'EXTRA_DAMAGE_APPLIED'
      && event.damage.extraDamageSource === 'momentumPressure'
    ))).toHaveLength(1)
    expect(result.state.units.find((unit) => unit.id === TRAINING_DUMMY_UNIT_ID))
      .toMatchObject({ currentHealth: 1, alive: true })
  })

  it('blocks a real percentage-maximum-health vitality change', () => {
    const initial = createBattleState([createTrainingDummy()])
    const result = requestUnitPercentageMaximumHealthDamage(initial, {
      unitId: TRAINING_DUMMY_UNIT_ID,
      percentage: 1,
      ...vitalityContext(),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state).toBe(initial)
    expect(result.events).toEqual([])
    expect(result.state.units[0]).toMatchObject({ currentHealth: 1, alive: true })
  })

  it.each(['execute', 'directDeath'] as const)(
    'blocks %s requests and repeated death without UNIT_DIED',
    (cause) => {
      const initial = createBattleState([createTrainingDummy()])
      const first = requestUnitDefeat(initial, {
        unitId: TRAINING_DUMMY_UNIT_ID,
        cause,
        ...vitalityContext(),
      })
      expect(first.ok).toBe(true)
      if (!first.ok) return
      const repeated = requestUnitDefeat(first.state, {
        unitId: TRAINING_DUMMY_UNIT_ID,
        cause,
        ...vitalityContext(),
      })

      expect(first.state).toBe(initial)
      expect(first.events).toEqual([])
      expect(repeated.ok).toBe(true)
      if (!repeated.ok) return
      expect(repeated.state).toBe(initial)
      expect(repeated.events).toEqual([])
      expect(initial.events.some((event) => event.type === 'UNIT_DIED')).toBe(false)
    },
  )

  it('blocks direct external health-zero and alive-false assignment', () => {
    const initial = createBattleState([createTrainingDummy()])
    const result = requestUnitVitalState(initial, {
      unitId: TRAINING_DUMMY_UNIT_ID,
      currentHealth: 0,
      alive: false,
      ...vitalityContext(),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state).toBe(initial)
    expect(result.events).toEqual([])
    expect(result.state.units[0]).toMatchObject({ currentHealth: 1, alive: true })
  })

  it('keeps infinite health intrinsic when a dispellable buff is removed', () => {
    const unit = createTrainingDummy()
    const initial = createBattleState([unit])
    const state = {
      ...initial,
      statusBatches: [{
        batchId: 'status-batch:dummy-buff' as StatusBatchId,
        statusId: 'status:dummy-buff' as StatusId,
        ownerUnitId: unit.id,
        sourceUnitId: unit.id,
        stacks: 1,
        effect: { calculation: 'total' as const, value: 1 },
        remainingOwnerTurns: null,
        acquiredAt: StatusAcquisitionTiming.External,
        acquisitionGroupId: 'dummy-buff',
        acquisitionOrder: 0,
        skipNextTurnEndDecrement: false,
        stackPolicy: StackPolicy.Independent,
        category: StatusCategory.Buff,
        canBeCleansed: false,
        canBeDispelled: true,
      }],
      statusAcquisitionOrders: [0],
    }
    const result = removeBattleStatus(state, {
      ownerUnitId: unit.id,
      mode: 'dispel',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.statusBatches).toEqual([])
    expect(result.state.units[0]).toMatchObject({
      hasInfiniteHealth: true,
      alive: true,
    })
  })

  it('fails without mutation when its first automatic action has no legal target', () => {
    const initial = battleState([
      dummy(),
      createUnit('dead', { speed: 100, currentHealth: 0, alive: false }),
    ])
    const result = startBattleSequence(
      initial,
      TRAINING_DUMMY_BATTLE_EXTENSIONS,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('TRAINING_DUMMY_NO_LIVING_PLAYER_TARGET')
    expect(result.state).toBe(initial)
    expect(result.events).toEqual([])
    expect(result.state.units).toBe(initial.units)
    expect(result.state.events).toBe(initial.events)
    expect(result.state.rngState).toBe(initial.rngState)
    expect(result.state.units.find((unit) => (
      unit.id === TRAINING_DUMMY_UNIT_ID
    ))).toMatchObject({ alive: true, momentum: 0, shield: 0 })
    expect(result.state.events.some((event) => (
      event.type === 'ATTACK_STARTED'
      || event.type === 'SKILL_RESOLUTION_STARTED'
    ))).toBe(false)
  })

  it('rolls back the automatic action after RNG is consumed and payment fails', () => {
    const staged = startBattleSequence(battleState([
      dummy(),
      createUnit('first', { position: Position.Front1, speed: 100 }),
      createUnit('second', { position: Position.Front2, speed: 90 }),
    ], [0.75]), passiveOnlyExtensions)
    expect(staged.ok).toBe(true)
    if (!staged.ok || staged.state.personalTurn === null) return
    const transactionId = `${staged.state.personalTurn.personalTurnId}`
      + ':training-dummy-revenge:resource'
    const initial = {
      ...staged.state,
      resourcePaymentRegistry: {
        ...staged.state.resourcePaymentRegistry,
        resourceTransactionIds: [
          ...staged.state.resourcePaymentRegistry.resourceTransactionIds,
          transactionId as ResourceTransactionId,
        ],
      },
    }
    const result = runTrainingDummyAutomaticTurn(initial)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('RESOURCE_TRANSACTION_ID_ALREADY_USED')
    expect(result.state).toBe(initial)
    expect(result.events).toEqual([])
    expect(result.state.units).toBe(initial.units)
    expect(result.state.events).toBe(initial.events)
    expect(result.state.rngState).toBe(initial.rngState)
    expect(result.state.personalTurn).toBe(initial.personalTurn)
    expect(result.state.personalTurn?.unitPassiveEffectsApplied).toBe(true)
  })

  it('stops successfully after a lethal automatic action leaves no living hostile units', () => {
    const initial = battleState([
      dummy({ criticalRate: 0.5 }),
      createUnit('last-player', { speed: 100, currentHealth: 5 }),
    ], [0.9])
    const result = startBattleSequence(
      initial,
      TRAINING_DUMMY_BATTLE_EXTENSIONS,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state).not.toBe(initial)
    expect(result.state.units.find((unit) => (
      unit.id === unitId('last-player')
    ))).toMatchObject({ currentHealth: 0, alive: false })
    expect(result.state.events.filter((event) => (
      event.type === 'DAMAGE_CALCULATED'
      && event.damage.targetUnitId === unitId('last-player')
    ))).toHaveLength(1)
    expect(result.state.events.filter((event) => (
      event.type === 'UNIT_DIED'
      && event.unitId === unitId('last-player')
    ))).toHaveLength(1)
    expect(result.state.events.filter((event) => (
      event.type === 'ACTION_COMPLETED'
      && event.unitId === TRAINING_DUMMY_UNIT_ID
    ))).toHaveLength(1)
    expect(result.state.events.filter((event) => (
      event.type === 'ATTACK_STARTED'
      && event.context.attackerId === TRAINING_DUMMY_UNIT_ID
    ))).toHaveLength(1)
    expect(result.state.events.filter((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
      && event.casterId === TRAINING_DUMMY_UNIT_ID
    ))).toHaveLength(1)
    expect(result.state.rngState.cursor).toBe(1)
    expect(result.state.rngState).not.toEqual(initial.rngState)
    expect(result.state.units.find((unit) => (
      unit.id === TRAINING_DUMMY_UNIT_ID
    ))).toMatchObject({ momentum: 5 })
    expect(result.state.events.some((event) => (
      'reason' in event
      && event.reason === 'TRAINING_DUMMY_NO_LIVING_PLAYER_TARGET'
    ))).toBe(false)
  })

  it('rolls the whole progression back when automatic action completion fails', () => {
    const initial = battleState([
      dummy(),
      createUnit('player', { speed: 100 }),
    ])
    const failingCompletionExtensions: BattleEngineExtensions = {
      applyUnitPassiveEffects:
        TRAINING_DUMMY_BATTLE_EXTENSIONS.applyUnitPassiveEffects,
      runAutomaticAction(state) {
        if (state.personalTurn?.unitId !== TRAINING_DUMMY_UNIT_ID) return null
        const actionId = 'action:test-failing-completion' as ActionId
        const started = startBattleAction(state, {
          actionId,
          actorId: TRAINING_DUMMY_UNIT_ID,
          endsTurn: true,
        })
        if (!started.ok) return started
        return completeBattleAction(
          started.state,
          'action:test-wrong-completion' as ActionId,
        )
      },
    }
    const result = startBattleSequence(initial, failingCompletionExtensions)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('ACTION_ID_DOES_NOT_MATCH_ACTIVE_ACTION')
    expect(result.state).toBe(initial)
    expect(result.events).toEqual([])
    expect(result.state.units).toBe(initial.units)
    expect(result.state.events).toBe(initial.events)
    expect(result.state.rngState).toBe(initial.rngState)
    expect(result.state.personalTurn).toBeNull()
  })
})
