import { describe, expect, it } from 'vitest'
import {
  Camp,
  DamageType,
  PersonalTurnPhase,
  Position,
  UnitSystem,
} from '../game/core/enums'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  ResourceTransactionId,
  SkillExecutionId,
  SkillId,
} from '../game/core/identifiers'
import type { AttackRequest, SkillResolutionRequest } from '../game/core/attacks'
import type { BattleState } from '../game/core/contexts'
import {
  completeBattleAction,
  endCurrentPersonalTurn,
  startBattleAction,
  startBattleSequence,
} from '../game/core/battleEngine'
import { resolveResourcePaidSkillTransaction } from '../game/core/resourceTransaction'
import {
  clearMomentumPressure,
  recalculateMomentumPressure,
} from '../game/core/momentumPressure'
import { createBattleState, createUnit, unitId } from './battleTestUtils'
import { ResourceType, spendResource } from '../game/core/resources'

const actionId = 'action:pressure' as ActionId
const executionId = 'skill-execution:pressure' as SkillExecutionId

function startPressureTurn(
  momentum: number,
  targetOverrides = {},
  actorOverrides = {},
) {
  const result = startBattleSequence(createBattleState([
    createUnit('actor', {
      speed: 200,
      momentum,
      position: Position.Front1,
      ...actorOverrides,
    }),
    createUnit('target', {
      camp: Camp.Enemy,
      speed: 1,
      position: null,
      ...targetOverrides,
    }),
  ]))
  if (!result.ok) throw new Error('Could not start pressure turn')
  return result.state
}

function startSkill(state: BattleState): BattleState {
  const action = startBattleAction(state, {
    actionId,
    actorId: unitId('actor'),
    skillExecutionId: executionId,
    endsTurn: false,
  })
  if (!action.ok) throw new Error('Could not start pressure skill')
  return action.state
}

function normalAttack(
  name: string,
  targets: readonly string[],
  overrides = {},
): AttackRequest {
  return {
    attackId: `attack:${name}` as AttackId,
    damageType: DamageType.Normal,
    effectiveAttack: 0,
    multiplier: 1,
    fixedDamage: 0,
    criticalRate: 0,
    criticalDamage: 0.5,
    normalDamageIncrease: 0,
    targets: targets.map((target) => ({
      targetId: unitId(target),
      damageEventId: `damage:${name}:${target}` as DamageEventId,
    })),
    ...overrides,
  }
}

function resolve(
  state: BattleState,
  attacks: readonly AttackRequest[],
) {
  if (state.personalTurn === null || state.activeAction === null) {
    throw new Error('Missing pressure action')
  }
  const skill: SkillResolutionRequest = {
    actionId,
    personalTurnId: state.personalTurn.personalTurnId,
    sequenceId: state.activeAction.sequenceId,
    skillExecutionId: executionId,
    skillId: 'skill:pressure' as SkillId,
    casterId: unitId('actor'),
    attacks,
  }
  return resolveResourcePaidSkillTransaction(state, {
    resourceTransactionId: 'resource:pressure' as ResourceTransactionId,
    actionId,
    personalTurnId: state.personalTurn.personalTurnId,
    sequenceId: state.activeAction.sequenceId,
    skillExecutionId: executionId,
    payerUnitId: unitId('actor'),
    costs: [],
  }, skill)
}

describe('momentum pressure turn lifecycle', () => {
  it.each([
    [10, 0, 0, 0],
    [10, 19, 0, 0],
    [10, 20, 2, 10],
    [10, 39, 3, 15],
    [20, 39, 0, 0],
    [20, 40, 4, 20],
    [20, 79, 7, 35],
  ])('with base attack %s recalculates momentum %s as pressure %s and shield %s', (
    baseAttackAtBattleEntry,
    momentum,
    pressure,
    shield,
  ) => {
    const state = startPressureTurn(momentum, {}, { baseAttackAtBattleEntry })
    const actor = state.units.find((unit) => unit.id === unitId('actor'))

    expect(actor).toMatchObject({ momentum, momentumPressure: pressure, shield })
    expect(state.events.filter((event) => (
      event.type === 'MOMENTUM_PRESSURE_RECALCULATED'
    )).at(-1)).toMatchObject({ momentum, after: pressure })
    expect(state.events.some((event) => (
      event.type === 'SHIELD_GAINED' && event.unitId === unitId('actor')
    ))).toBe(shield > 0)
    expect(state.events.some((event) => (
      (event.type === 'RESOURCE_GAINED' || event.type === 'RESOURCE_SPENT')
      && event.resourceType === ResourceType.MomentumPressure
    ))).toBe(false)
  })

  it('places recalculation and shield inside the SystemRules stage', () => {
    const state = startPressureTurn(20)
    const labels = state.events.map((event) => event.type === 'TURN_START_STAGE_ENTERED'
      || event.type === 'TURN_START_STAGE_COMPLETED'
      ? `${event.type}:${event.stage}`
      : event.type)

    expect(labels.indexOf('TURN_START_STAGE_ENTERED:systemRules'))
      .toBeLessThan(labels.indexOf('MOMENTUM_PRESSURE_RECALCULATED'))
    expect(labels.indexOf('MOMENTUM_PRESSURE_RECALCULATED'))
      .toBeLessThan(labels.indexOf('SHIELD_GAINED'))
    expect(labels.indexOf('SHIELD_GAINED'))
      .toBeLessThan(labels.indexOf('TURN_START_STAGE_COMPLETED:systemRules'))
  })

  it('only recalculates the current turn owner', () => {
    const started = startBattleSequence(createBattleState([
      createUnit('actor', { speed: 200, momentum: 20 }),
      createUnit('later', {
        speed: 100,
        position: Position.Front2,
        momentum: 30,
        momentumPressure: 7,
      }),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok) return

    expect(started.state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({ momentumPressure: 2 })
    expect(started.state.units.find((unit) => unit.id === unitId('later')))
      .toMatchObject({ momentumPressure: 7, shield: 0 })
  })

  it('replaces an old pressure value and adds generated shield to existing shield', () => {
    const state = startPressureTurn(20, {}, {
      momentumPressure: 7,
      shield: 4,
    })

    expect(state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({ momentumPressure: 2, shield: 14 })
    expect(state.events.filter((event) => (
      event.type === 'MOMENTUM_PRESSURE_RECALCULATED'
    )).at(-1)).toMatchObject({ before: 7, after: 2 })
    expect(state.events.filter((event) => event.type === 'SHIELD_GAINED').at(-1))
      .toMatchObject({ amount: 10, before: 4, after: 14 })
  })

  it('rejects momentum-pressure shield overflow without changing units or events', () => {
    const initial = createBattleState([
      createUnit('actor', {
        speed: 200,
        momentum: 20,
        shield: Number.MAX_SAFE_INTEGER,
      }),
    ])
    const result = startBattleSequence(initial)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('MOMENTUM_PRESSURE_SHIELD_OVERFLOW')
      expect(result.state.units).toBe(initial.units)
      expect(result.state.events).toBe(initial.events)
      expect(result.state.rngState).toBe(initial.rngState)
      expect(result.events).toEqual([])
    }
  })

  it('recalculates each new owner turn and grants shield again', () => {
    const started = startBattleSequence(createBattleState([
      createUnit('actor', { speed: 200, momentum: 20 }),
      createUnit('other', { speed: 100, position: Position.Front2 }),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    const afterActor = endCurrentPersonalTurn(
      started.state,
      started.state.personalTurn.personalTurnId,
    )
    expect(afterActor.ok).toBe(true)
    if (!afterActor.ok || afterActor.state.personalTurn === null) return
    const nextActor = endCurrentPersonalTurn(
      afterActor.state,
      afterActor.state.personalTurn.personalTurnId,
    )

    expect(nextActor.ok).toBe(true)
    if (!nextActor.ok) return
    expect(nextActor.state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({ momentumPressure: 2, shield: 20 })
  })

  it('replaces the previous turn pressure after momentum changes', () => {
    const started = startBattleSequence(createBattleState([
      createUnit('actor', { speed: 200, momentum: 40 }),
      createUnit('other', { speed: 100, position: Position.Front2 }),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    expect(started.state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({ momentumPressure: 4 })
    const afterActor = endCurrentPersonalTurn(
      started.state,
      started.state.personalTurn.personalTurnId,
    )
    expect(afterActor.ok).toBe(true)
    if (!afterActor.ok || afterActor.state.personalTurn === null) return
    const reduced = spendResource(afterActor.state, {
      unitId: unitId('actor'),
      resourceType: ResourceType.Momentum,
      amount: 20,
      reason: 'testBetweenTurns',
      sourceId: null,
      actionId: null,
      personalTurnId: afterActor.state.personalTurn.personalTurnId,
      sequenceId: afterActor.state.personalTurn.sequenceId,
      skillExecutionId: null,
      resourceTransactionId: null,
    })
    expect(reduced.ok).toBe(true)
    if (!reduced.ok) return
    const nextActor = endCurrentPersonalTurn(
      reduced.state,
      afterActor.state.personalTurn.personalTurnId,
    )

    expect(nextActor.ok).toBe(true)
    if (!nextActor.ok) return
    expect(nextActor.state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({ momentum: 20, momentumPressure: 2 })
  })

  it('clears pressure only inside SpecialVariables and preserves other resources', () => {
    const state = startPressureTurn(20)
    if (state.personalTurn === null) return
    const ended = endCurrentPersonalTurn(state, state.personalTurn.personalTurnId)

    expect(ended.ok).toBe(true)
    if (!ended.ok) return
    const actor = ended.state.units.find((unit) => unit.id === unitId('actor'))
    expect(actor).toMatchObject({
      momentum: 20,
      momentumPressure: 0,
      energy: 0,
      intent: 0,
      magic: 0,
    })
    const labels = ended.events.map((event) => event.type === 'TURN_END_STAGE_ENTERED'
      || event.type === 'TURN_END_STAGE_COMPLETED'
      ? `${event.type}:${event.stage}`
      : event.type)
    expect(labels.indexOf('TURN_END_STAGE_ENTERED:specialVariables'))
      .toBeLessThan(labels.indexOf('MOMENTUM_PRESSURE_CLEARED'))
    expect(labels.indexOf('MOMENTUM_PRESSURE_CLEARED'))
      .toBeLessThan(labels.indexOf('TURN_END_STAGE_COMPLETED:specialVariables'))
  })

  it('does not run a new pressure recalculation for a dead unit', () => {
    const started = startBattleSequence(createBattleState([
      createUnit('living', { speed: 200, momentum: 0 }),
      createUnit('dead', {
        speed: 100,
        position: Position.Front2,
        momentum: 20,
        alive: false,
        currentHealth: 0,
      }),
    ]))
    expect(started.ok).toBe(true)
    if (!started.ok) return

    expect(started.events.some((event) => (
      event.type === 'MOMENTUM_PRESSURE_RECALCULATED'
      && event.unitId === unitId('dead')
    ))).toBe(false)
  })

  it('rejects direct recalculation or clearing outside controlled stages', () => {
    const state = startPressureTurn(20)
    if (state.personalTurn === null) return
    const recalculated = recalculateMomentumPressure(
      state,
      unitId('actor'),
      state.personalTurn,
    )
    const cleared = clearMomentumPressure(
      state,
      unitId('actor'),
      state.personalTurn,
    )

    expect(recalculated).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'NOT_AT_MOMENTUM_PRESSURE_RECALCULATION_BOUNDARY',
    })
    expect(cleared).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'NOT_AT_MOMENTUM_PRESSURE_CLEAR_BOUNDARY',
    })
  })

  it('clears an already-zero pressure as an immutable no-op without an event', () => {
    const state = startPressureTurn(0)
    if (state.personalTurn === null) return
    const turn = {
      ...state.personalTurn,
      phase: PersonalTurnPhase.EndingSpecialVariables,
    }
    const controlledState = { ...state, personalTurn: turn }
    const result = clearMomentumPressure(
      controlledState,
      unitId('actor'),
      turn,
    )

    expect(result).toEqual({
      ok: true,
      state: controlledState,
      events: [],
      changed: false,
    })
    expect(result.state.units).toBe(controlledState.units)
    expect(result.state.events).toBe(controlledState.events)
  })

  it('does not calculate momentum pressure for another unit system', () => {
    const started = startBattleSequence(createBattleState([
      createUnit('actor', {
        system: UnitSystem.Intent,
        momentum: 20,
        momentumPressure: 0,
      }),
    ]))

    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.state.units[0]).toMatchObject({
      momentumPressure: 0,
      shield: 0,
    })
    expect(started.events.some((event) => (
      event.type === 'MOMENTUM_PRESSURE_RECALCULATED'
    ))).toBe(false)
  })
})

describe('momentum pressure extra damage', () => {
  it('adds three extra damage per pressure and bypasses shield', () => {
    const state = startSkill(startPressureTurn(80, { shield: 100 }))
    const result = resolve(state, [normalAttack('basic', ['target'])])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ shield: 100, currentHealth: 76 })
    const pressureDamage = result.events.find((event) => (
      event.type === 'EXTRA_DAMAGE_APPLIED'
      && event.damage.extraDamageSource === 'momentumPressure'
    ))
    expect(pressureDamage).toMatchObject({
      damage: { resolvedValue: 24, critical: false, shieldAbsorbed: 0 },
    })
    const labels = result.events.map((event) => event.type)
    expect(labels.indexOf('MOMENTUM_PRESSURE_TRIGGERED'))
      .toBeLessThan(labels.indexOf('EXTRA_DAMAGE_APPLIED'))
    expect(result.events.find((event) => event.type === 'ATTACK_STARTED'))
      .toMatchObject({ context: { momentumPressureSnapshot: 8 } })
    expect(result.state.rngState.cursor).toBe(state.rngState.cursor)
    expect(result.events.filter((event) => event.type === 'ATTACK_STARTED'))
      .toHaveLength(1)
    expect(result.events.filter((event) => event.type === 'ATTACK_COMPLETED'))
      .toHaveLength(1)
  })

  it('makes generated shield available to the immediately following skill', () => {
    const state = startSkill(startPressureTurn(20))
    const result = resolve(state, [normalAttack('self', ['actor'], {
      effectiveAttack: 2,
    })])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({ shield: 8, currentHealth: 94 })
  })

  it('triggers when normal damage is zero and ignores ordinary modifiers and protection', () => {
    const initial = createBattleState([
      createUnit('actor', { speed: 200, momentum: 80 }),
      createUnit('front', { camp: Camp.Enemy, speed: 2, position: Position.Front1 }),
      createUnit('target', {
        camp: Camp.Enemy,
        speed: 1,
        position: Position.Back1,
        normalDamageReductionSources: [{
          sourceId: unitId('reduction'),
          reduction: 1,
        }],
      }),
    ])
    const turn = startBattleSequence(initial)
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    const state = startSkill(turn.state)
    const result = resolve(state, [normalAttack('zero-protected', ['target'], {
      normalDamageIncrease: 10,
    })])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === unitId('target'))?.currentHealth)
      .toBe(76)
  })

  it('does not trigger for a missed attack or zero pressure', () => {
    const missedState = startSkill(startPressureTurn(20))
    const missed = resolve(missedState, [normalAttack('miss', ['target'], {
      targets: [{
        targetId: unitId('target'),
        damageEventId: 'damage:miss' as DamageEventId,
        hit: false,
      }],
    })])
    const zeroState = startSkill(startPressureTurn(0))
    const zero = resolve(zeroState, [normalAttack('zero-pressure', ['target'])])

    expect(missed.ok).toBe(true)
    expect(zero.ok).toBe(true)
    if (!missed.ok || !zero.ok) return
    expect(missed.events.some((event) => event.type === 'MOMENTUM_PRESSURE_TRIGGERED'))
      .toBe(false)
    expect(zero.events.some((event) => event.type === 'MOMENTUM_PRESSURE_TRIGGERED'))
      .toBe(false)
  })

  it('uses one per-target lock across multiple attacks', () => {
    const state = startSkill(startPressureTurn(40))
    const result = resolve(state, [
      normalAttack('first', ['target']),
      normalAttack('second', ['target']),
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.filter((event) => event.type === 'MOMENTUM_PRESSURE_TRIGGERED'))
      .toHaveLength(1)
    expect(result.state.units.find((unit) => unit.id === unitId('target'))?.currentHealth)
      .toBe(88)
    expect(result.state).not.toHaveProperty('triggerLocks')
  })

  it('triggers independently for each group target', () => {
    const initial = createBattleState([
      createUnit('actor', { speed: 200, momentum: 40 }),
      createUnit('first', { camp: Camp.Enemy, speed: 2, position: null }),
      createUnit('second', { camp: Camp.Enemy, speed: 1, position: null }),
    ])
    const turn = startBattleSequence(initial)
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    const result = resolve(startSkill(turn.state), [
      normalAttack('group', ['first', 'second']),
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.filter((event) => event.type === 'MOMENTUM_PRESSURE_TRIGGERED'))
      .toHaveLength(2)
    expect(result.state.units.filter((unit) => unit.camp === Camp.Enemy)
      .map((unit) => unit.currentHealth)).toEqual([88, 88])
  })

  it('allows shield-value damage to trigger pressure under the same lock', () => {
    const state = startSkill(startPressureTurn(40, { shield: 50 }))
    const shieldAttack: AttackRequest = {
      attackId: 'attack:shield-value' as AttackId,
      damageType: DamageType.ShieldValue,
      baseValue: 0,
      normalDamageIncrease: 0,
      targets: [{
        targetId: unitId('target'),
        damageEventId: 'damage:shield-value' as DamageEventId,
      }],
    }
    const result = resolve(state, [
      shieldAttack,
      normalAttack('normal-after-shield', ['target']),
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.filter((event) => event.type === 'MOMENTUM_PRESSURE_TRIGGERED'))
      .toHaveLength(1)
    expect(result.state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ shield: 50, currentHealth: 88 })
  })

  it('keeps generic and pressure extra damage distinct in fixed order', () => {
    const state = startSkill(startPressureTurn(40))
    const attack = normalAttack('two-extra', ['target'], {
      targets: [{
        targetId: unitId('target'),
        damageEventId: 'damage:two-extra' as DamageEventId,
        extraDamage: {
          damageEventId: 'damage:generic-extra' as DamageEventId,
          value: 4,
        },
      }],
    })
    const result = resolve(state, [attack])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const extraSources = result.events
      .filter((event) => event.type === 'EXTRA_DAMAGE_APPLIED')
      .map((event) => event.damage.extraDamageSource)
    expect(extraSources).toEqual(['generic', 'momentumPressure'])
    expect(result.state.units.find((unit) => unit.id === unitId('target'))?.currentHealth)
      .toBe(84)
  })

  it('causes only one death and locked later hits remain harmless', () => {
    const state = startSkill(startPressureTurn(40, { currentHealth: 6 }))
    const result = resolve(state, [
      normalAttack('pressure-lethal', ['target']),
      normalAttack('locked-after-death', ['target']),
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.filter((event) => event.type === 'UNIT_DIED')).toHaveLength(1)
    expect(result.state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ currentHealth: 0, alive: false })
  })

  it('cancels pressure extra when the normal attack removes its target', () => {
    const state = startSkill(startPressureTurn(20, { currentHealth: 5 }))
    const result = resolve(state, [normalAttack('normal-lethal', ['target'], {
      effectiveAttack: 10,
    })])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.filter((event) => event.type === 'UNIT_DIED')).toHaveLength(1)
    expect(result.events.filter((event) => (
      event.type === 'EXTRA_DAMAGE_APPLIED'
      && event.damage.extraDamageSource === 'momentumPressure'
    ))).toHaveLength(0)
  })

  it('finishes locked attacks after caster death without changing its resources', () => {
    const initial = createBattleState([
      createUnit('actor', {
        speed: 200,
        momentum: 40,
        currentHealth: 5,
        energy: 3,
      }),
      createUnit('target', { camp: Camp.Enemy, speed: 1, position: null }),
    ])
    const turn = startBattleSequence(initial)
    expect(turn.ok).toBe(true)
    if (!turn.ok) return
    const state = startSkill(turn.state)
    const result = resolve(state, [
      normalAttack('self-fatal', ['actor'], { effectiveAttack: 10 }),
      normalAttack('after-caster-death', ['target']),
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === unitId('actor')))
      .toMatchObject({ alive: false, energy: 3, momentum: 40 })
    expect(result.state.units.find((unit) => unit.id === unitId('target'))?.currentHealth)
      .toBe(88)
  })

  it('releases trigger locks when a later attack fails and the transaction rolls back', () => {
    const state = startSkill(startPressureTurn(20))
    const failed = resolve(state, [
      normalAttack('pressure-before-failure', ['target']),
      normalAttack('overflow', ['target'], {
        effectiveAttack: Number.MAX_VALUE,
        multiplier: 2,
      }),
    ])
    const retried = resolve(state, [normalAttack('retry-pressure', ['target'])])

    expect(failed.ok).toBe(false)
    expect(failed.state).toBe(state.actionRollbackState)
    expect(retried.ok).toBe(true)
    if (!retried.ok) return
    expect(retried.events.filter((event) => event.type === 'MOMENTUM_PRESSURE_TRIGGERED'))
      .toHaveLength(1)
  })

  it('still allows action completion after a successful pressure skill', () => {
    const state = startSkill(startPressureTurn(20))
    const resolved = resolve(state, [normalAttack('complete', ['target'])])
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const completed = completeBattleAction(resolved.state, actionId)

    expect(completed.ok).toBe(true)
  })
})
