import { describe, expect, it } from 'vitest'
import {
  BattlePhase,
  Camp,
  DamageType,
  PersonalTurnPhase,
  Position,
} from '../game/core/enums'
import type {
  NormalAttackRequest,
  ShieldValueAttackRequest,
} from '../game/core/attacks'
import { resolveSkillTransaction } from '../game/core/resolutionTransaction'
import { createFixedSequenceRandomState } from '../game/core/rng'
import {
  completeBattleAction,
  resolveBattleSkill,
  startBattleAction,
  startBattleSequence,
} from '../game/core/battleEngine'
import { resolveResourcePaidSkillTransaction } from '../game/core/resourceTransaction'
import type { ResourceTransactionId } from '../game/core/identifiers'
import { createBattleState, createUnit, unitId } from './battleTestUtils'
import { createResolvingState, ids, skillRequest } from './combatTestUtils'

function actor(overrides = {}) {
  return createUnit('actor', {
    speed: 200,
    position: Position.Front1,
    ...overrides,
  })
}

function enemy(name: string, overrides = {}) {
  return createUnit(name, {
    camp: Camp.Enemy,
    position: null,
    speed: 1,
    ...overrides,
  })
}

function normalAttack(
  name: string,
  targetNames: readonly string[],
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
    targets: targetNames.map((targetName) => ({
      targetId: unitId(targetName),
      damageEventId: ids.damage(`damage:${name}:${targetName}`),
    })),
    ...overrides,
  }
}

function shieldValueAttack(
  name: string,
  targetNames: readonly string[],
  overrides: Partial<ShieldValueAttackRequest> = {},
): ShieldValueAttackRequest {
  return {
    attackId: ids.attack(`attack:${name}`),
    damageType: DamageType.ShieldValue,
    baseValue: 20,
    normalDamageIncrease: 0,
    targets: targetNames.map((targetName) => ({
      targetId: unitId(targetName),
      damageEventId: ids.damage(`damage:${name}:${targetName}`),
    })),
    ...overrides,
  }
}

describe('multi-target and multi-hit skill resolution', () => {
  it('rolls critical per target in explicit request order', () => {
    const state = createResolvingState([
      actor(),
      enemy('first'),
      enemy('second'),
    ], createFixedSequenceRandomState([0.1, 0.9]))
    const attack = normalAttack('group', ['first', 'second'], {
      criticalRate: 0.5,
    })
    const result = resolveSkillTransaction(state, skillRequest(state, [attack]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const rolls = result.events.filter((event) => event.type === 'CRITICAL_ROLLED')
    expect(rolls.map((event) => [event.targetId, event.critical])).toEqual([
      [unitId('first'), true],
      [unitId('second'), false],
    ])
    expect(result.state.rngState.cursor).toBe(2)
  })

  it('creates independent attack contexts and rounds each hit separately', () => {
    const state = createResolvingState([actor(), enemy('target')])
    const attacks = [
      normalAttack('first', ['target'], {
        effectiveAttack: 15.6,
        multiplier: 0.8,
      }),
      normalAttack('second', ['target'], {
        effectiveAttack: 15.6,
        multiplier: 0.8,
      }),
    ]
    const result = resolveSkillTransaction(state, skillRequest(state, attacks))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const started = result.events.filter((event) => event.type === 'ATTACK_STARTED')
    const damage = result.events.filter((event) => event.type === 'DAMAGE_CALCULATED')
    expect(started.map((event) => event.context.attackIndex)).toEqual([0, 1])
    expect(damage.map((event) => event.damage.resolvedValue)).toEqual([12.5, 12.5])
    expect(result.state.units.find((unit) => unit.id === unitId('target'))?.currentHealth)
      .toBe(75)
  })

  it('does not skip later confirmed targets when an earlier target dies', () => {
    const state = createResolvingState([
      actor(),
      enemy('fragile', { currentHealth: 5 }),
      enemy('later'),
    ])
    const result = resolveSkillTransaction(state, skillRequest(state, [
      normalAttack('group', ['fragile', 'later']),
    ]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === unitId('fragile'))?.alive)
      .toBe(false)
    expect(result.state.units.find((unit) => unit.id === unitId('later'))?.currentHealth)
      .toBe(80)
  })

  it('stops later single-target hits after the target is removed', () => {
    const state = createResolvingState([
      actor(),
      enemy('target', { currentHealth: 10 }),
    ])
    const result = resolveSkillTransaction(state, skillRequest(state, [
      normalAttack('first', ['target']),
      normalAttack('second', ['target']),
    ]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.filter((event) => event.type === 'UNIT_DIED')).toHaveLength(1)
    expect(result.events.filter((event) => (
      event.type === 'DAMAGE_CALCULATED'
      && event.damage.targetUnitId === unitId('target')
    ))).toHaveLength(1)
    const healthEvents = result.events.filter((event) => event.type === 'HEALTH_LOST')
    expect(healthEvents).toHaveLength(1)
    expect(result.state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ currentHealth: 0, alive: false })
  })

  it('continues group multi-hit attacks for surviving targets after one target dies', () => {
    const state = createResolvingState([
      actor(),
      enemy('fragile', { currentHealth: 5 }),
      enemy('survivor'),
    ])
    const result = resolveSkillTransaction(state, skillRequest(state, [
      normalAttack('first-group', ['fragile', 'survivor']),
      normalAttack('second-group', ['fragile', 'survivor']),
    ]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const damageTargets = result.events
      .filter((event) => event.type === 'DAMAGE_CALCULATED')
      .map((event) => event.damage.targetUnitId)
    expect(damageTargets).toEqual([
      unitId('fragile'),
      unitId('survivor'),
      unitId('survivor'),
    ])
    expect(result.state.units.find((unit) => unit.id === unitId('fragile')))
      .toMatchObject({ currentHealth: 0, alive: false })
    expect(result.state.units.find((unit) => unit.id === unitId('survivor')))
      .toMatchObject({ currentHealth: 60, alive: true })
  })

  it('finishes a locked skill even if its caster dies during the first attack', () => {
    const state = createResolvingState([
      actor({ currentHealth: 10 }),
      enemy('target'),
    ])
    const result = resolveSkillTransaction(state, skillRequest(state, [
      normalAttack('self-fatal', ['actor']),
      normalAttack('after-death', ['target']),
    ]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === unitId('actor'))?.alive)
      .toBe(false)
    expect(result.state.units.find((unit) => unit.id === unitId('target'))?.currentHealth)
      .toBe(80)
    expect(result.events.at(-1)?.type).toBe('SKILL_RESOLUTION_COMPLETED')
  })

  it('skips the dead caster action-after and turn-end effects after its skill finishes', () => {
    const state = createResolvingState([
      actor({ currentHealth: 10 }),
      enemy('target'),
    ])
    const resolved = resolveSkillTransaction(state, skillRequest(state, [
      normalAttack('self-fatal', ['actor']),
      normalAttack('after-death', ['target']),
    ]))
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const completed = completeBattleAction(resolved.state, ids.action, {
      applyAfterActionEffects(current) {
        return {
          ok: false,
          state: current,
          events: [],
          reason: 'DEAD_CASTER_AFTER_ACTION_MUST_NOT_RUN',
        }
      },
    })

    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.events.some((event) => (
      event.type === 'TURN_END_STAGE_ENTERED'
    ))).toBe(false)
    expect(completed.state.personalTurn?.unitId).toBe(unitId('target'))
  })
})

describe('shield-value attacks', () => {
  it('does not roll critical and applies increase, reduction, and shield overflow', () => {
    const state = createResolvingState([
      actor({ shield: 99 }),
      enemy('target', {
        shield: 5,
        normalDamageReductionSources: [{
          sourceId: unitId('reduction'),
          reduction: 0.5,
        }],
      }),
    ], createFixedSequenceRandomState([]))
    const attack = shieldValueAttack('shield-value', ['target'], {
      baseValue: 20,
      normalDamageIncrease: 0.2,
    })
    const result = resolveSkillTransaction(state, skillRequest(state, [attack]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.some((event) => event.type === 'CRITICAL_ROLLED')).toBe(false)
    expect(result.state.rngState.cursor).toBe(0)
    expect(result.state.units.find((unit) => unit.id === unitId('actor'))?.shield)
      .toBe(99)
    expect(result.state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ shield: 0, currentHealth: 93 })
  })
})

describe('generic extra damage', () => {
  it('bypasses shield without a second attack or critical roll', () => {
    const state = createResolvingState([
      actor(),
      enemy('target', {
        shield: 100,
        normalDamageReductionSources: [{
          sourceId: unitId('reduction'),
          reduction: 0.9,
        }],
      }),
    ])
    const attack = normalAttack('extra', ['target'], {
      normalDamageIncrease: 2,
      targets: [{
        targetId: unitId('target'),
        damageEventId: ids.damage('damage:normal'),
        extraDamage: {
          damageEventId: ids.damage('damage:extra'),
          value: 12,
        },
      }],
    })
    const result = resolveSkillTransaction(state, skillRequest(state, [attack]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.filter((event) => event.type === 'ATTACK_STARTED')).toHaveLength(1)
    expect(result.events.filter((event) => event.type === 'EXTRA_DAMAGE_APPLIED'))
      .toHaveLength(1)
    expect(result.state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ shield: 94, currentHealth: 88 })
  })

  it('does not apply extra damage when the original attack did not hit', () => {
    const state = createResolvingState([actor(), enemy('target')])
    const result = resolveSkillTransaction(state, skillRequest(state, [
      normalAttack('miss', ['target'], {
        targets: [{
          targetId: unitId('target'),
          damageEventId: ids.damage('damage:miss'),
          hit: false,
          extraDamage: {
            damageEventId: ids.damage('damage:miss-extra'),
            value: 50,
          },
        }],
      }),
    ]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === unitId('target'))?.currentHealth)
      .toBe(100)
    expect(result.events.some((event) => event.type === 'EXTRA_DAMAGE_APPLIED'))
      .toBe(false)
  })

  it('uses one per-target lock across multiple attacks in one skill execution', () => {
    const state = createResolvingState([actor(), enemy('target')])
    const extra = {
      damageEventId: ids.damage('damage:extra:first'),
      value: 12,
      triggerLockId: ids.lock('limited-extra'),
    }
    const first = normalAttack('first', ['target'], {
      targets: [{
        targetId: unitId('target'),
        damageEventId: ids.damage('damage:first'),
        extraDamage: extra,
      }],
    })
    const second = normalAttack('second', ['target'], {
      targets: [{
        targetId: unitId('target'),
        damageEventId: ids.damage('damage:second'),
        extraDamage: {
          ...extra,
          damageEventId: ids.damage('damage:extra:second'),
        },
      }],
    })
    const result = resolveSkillTransaction(state, skillRequest(state, [first, second]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.filter((event) => event.type === 'EXTRA_DAMAGE_APPLIED'))
      .toHaveLength(1)
    expect(result.state.units.find((unit) => unit.id === unitId('target'))?.currentHealth)
      .toBe(48)
    expect(result.state.activeSkill).toBeNull()
    expect(result.state).not.toHaveProperty('triggerLocks')
  })

  it('cancels attached extra damage when the normal attack removes its target', () => {
    const state = createResolvingState([
      actor(),
      enemy('target', { currentHealth: 5 }),
    ])
    const result = resolveSkillTransaction(state, skillRequest(state, [
      normalAttack('lethal', ['target'], {
        targets: [{
          targetId: unitId('target'),
          damageEventId: ids.damage('damage:lethal'),
          extraDamage: {
            damageEventId: ids.damage('damage:after-death'),
            value: 12,
          },
        }],
      }),
    ]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.filter((event) => event.type === 'UNIT_DIED')).toHaveLength(1)
    expect(result.events.some((event) => event.type === 'EXTRA_DAMAGE_APPLIED'))
      .toBe(false)
  })

  it('does not emit extra damage when its resolved value is zero', () => {
    const state = createResolvingState([actor(), enemy('target')])
    const result = resolveSkillTransaction(state, skillRequest(state, [
      normalAttack('zero-extra', ['target'], {
        targets: [{
          targetId: unitId('target'),
          damageEventId: ids.damage('damage:zero-extra-normal'),
          extraDamage: {
            damageEventId: ids.damage('damage:zero-extra'),
            value: 0,
          },
        }],
      }),
    ]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.some((event) => event.type === 'EXTRA_DAMAGE_APPLIED'))
      .toBe(false)
  })

  it('allows extra damage to cause the only death and later locked hits do not repeat it', () => {
    const state = createResolvingState([
      actor(),
      enemy('target', { currentHealth: 10 }),
    ])
    const first = normalAttack('extra-lethal', ['target'], {
      effectiveAttack: 0,
      targets: [{
        targetId: unitId('target'),
        damageEventId: ids.damage('damage:extra-lethal-normal'),
        extraDamage: {
          damageEventId: ids.damage('damage:extra-lethal'),
          value: 10,
        },
      }],
    })
    const result = resolveSkillTransaction(state, skillRequest(state, [
      first,
      normalAttack('locked-after-extra-death', ['target']),
    ]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.filter((event) => event.type === 'UNIT_DIED'))
      .toHaveLength(1)
    expect(result.events.filter((event) => event.type === 'EXTRA_DAMAGE_APPLIED'))
      .toHaveLength(1)
    expect(result.state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ currentHealth: 0, alive: false })
  })
})

describe('position protection across attacks', () => {
  it('shares one group snapshot, then refreshes it for the next attack', () => {
    const state = createResolvingState([
      enemy('actor', { speed: 200 }),
      createUnit('front', {
        position: Position.Front1,
        currentHealth: 50,
        speed: 10,
      }),
      createUnit('back', {
        position: Position.Back1,
        currentHealth: 200,
        maximumHealth: 200,
        speed: 5,
      }),
    ])
    const group = normalAttack('group', ['front', 'back'], {
      effectiveAttack: 100,
    })
    const next = normalAttack('next', ['back'], { effectiveAttack: 100 })
    const result = resolveSkillTransaction(state, skillRequest(state, [group, next]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const backDamage = result.events
      .filter((event) => event.type === 'DAMAGE_CALCULATED')
      .filter((event) => event.damage.targetUnitId === unitId('back'))
      .map((event) => event.damage.resolvedValue)
    expect(backDamage).toEqual([50, 100])
    expect(result.state.units.find((unit) => unit.id === unitId('back'))?.currentHealth)
      .toBe(50)
  })

  it('applies protection to shield-value damage but not extra damage', () => {
    const state = createResolvingState([
      enemy('actor', { speed: 200 }),
      createUnit('front', { position: Position.Front1 }),
      createUnit('back', { position: Position.Back1, shield: 0 }),
    ])
    const shieldAttack = shieldValueAttack('shield', ['back'], { baseValue: 20 })
    const normal = normalAttack('normal', ['back'], {
      effectiveAttack: 0,
      targets: [{
        targetId: unitId('back'),
        damageEventId: ids.damage('damage:zero'),
        extraDamage: {
          damageEventId: ids.damage('damage:direct'),
          value: 20,
        },
      }],
    })
    const result = resolveSkillTransaction(state, skillRequest(state, [
      shieldAttack,
      normal,
    ]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === unitId('back'))?.currentHealth)
      .toBe(70)
  })

  it('keeps protection results stable when group target order is reversed', () => {
    const units = [
      enemy('actor', { speed: 200 }),
      createUnit('front', { position: Position.Front1 }),
      createUnit('back', { position: Position.Back1 }),
    ]
    const forwardState = createResolvingState(units)
    const reversedState = createResolvingState(units)
    const forward = resolveSkillTransaction(forwardState, skillRequest(
      forwardState,
      [normalAttack('forward', ['front', 'back'])],
    ))
    const reversed = resolveSkillTransaction(reversedState, skillRequest(
      reversedState,
      [normalAttack('reversed', ['back', 'front'])],
    ))

    expect(forward.ok).toBe(true)
    expect(reversed.ok).toBe(true)
    if (!forward.ok || !reversed.ok) return
    const valuesByTarget = (events: typeof forward.events) => Object.fromEntries(
      events
        .filter((event) => event.type === 'DAMAGE_CALCULATED')
        .map((event) => [event.damage.targetUnitId, event.damage.resolvedValue]),
    )
    expect(valuesByTarget(forward.events)).toEqual(valuesByTarget(reversed.events))
    expect(valuesByTarget(forward.events)).toEqual({ front: 20, back: 10 })
  })
})

describe('transaction rollback and validation', () => {
  it('rolls back units, events, and RNG when a later random read fails', () => {
    const state = createResolvingState([
      actor(),
      enemy('first'),
      enemy('second'),
    ], createFixedSequenceRandomState([0.1]))
    const result = resolveSkillTransaction(state, skillRequest(state, [
      normalAttack('group', ['first', 'second'], { criticalRate: 0.5 }),
    ]))

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'RANDOM_SOURCE_EXHAUSTED',
    })
    expect(state.rngState.cursor).toBe(0)
    expect(state.units.find((unit) => unit.id === unitId('first'))?.currentHealth)
      .toBe(100)
  })

  it('rolls back the first attack and RNG when the second attack calculation fails', () => {
    const state = createResolvingState([
      actor(),
      enemy('target', { shield: 5 }),
    ], createFixedSequenceRandomState([0.1, 0.9]))
    const request = skillRequest(state, [
      normalAttack('committed-only-on-success', ['target'], { criticalRate: 0.5 }),
      normalAttack('overflow', ['target'], {
        effectiveAttack: Number.MAX_VALUE,
        multiplier: 2,
        criticalRate: 0.5,
      }),
    ])
    const result = resolveSkillTransaction(state, request)

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'INVALID_NUMERIC_INPUT',
    })
    expect(state.rngState.cursor).toBe(0)
    expect(state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ currentHealth: 100, shield: 5 })
  })

  it('retries from the same RNG position after a failed transaction', () => {
    const state = createResolvingState([
      actor(),
      enemy('target'),
    ], createFixedSequenceRandomState([0.1, 0.9]))
    const failingRequest = skillRequest(state, [
      normalAttack('first-roll', ['target'], { criticalRate: 0.5 }),
      normalAttack('overflow-retry', ['target'], {
        effectiveAttack: Number.MAX_VALUE,
        multiplier: 2,
        criticalRate: 0.5,
      }),
    ])
    const firstFailure = resolveSkillTransaction(state, failingRequest)
    const repeatedFailure = resolveSkillTransaction(state, failingRequest)
    const successfulRetry = resolveSkillTransaction(state, skillRequest(state, [
      normalAttack('first-roll', ['target'], { criticalRate: 0.5 }),
    ]))

    expect(firstFailure).toEqual(repeatedFailure)
    expect(firstFailure.state).toBe(state)
    expect(state.rngState.cursor).toBe(0)
    expect(successfulRetry.ok).toBe(true)
    if (!successfulRetry.ok) return
    expect(successfulRetry.events.find((event) => event.type === 'CRITICAL_ROLLED'))
      .toMatchObject({ critical: true, rngConsumed: true })
    expect(successfulRetry.state.rngState.cursor).toBe(1)
  })

  it('rolls back normal damage, events, and RNG when extra damage calculation fails', () => {
    const state = createResolvingState([
      actor(),
      enemy('target', { shield: 5 }),
    ], createFixedSequenceRandomState([0.1]))
    const attack = normalAttack('extra-overflow', ['target'], {
      criticalRate: 0.5,
      targets: [{
        targetId: unitId('target'),
        damageEventId: ids.damage('damage:before-extra-failure'),
        extraDamage: {
          damageEventId: ids.damage('damage:extra-overflow'),
          value: Number.MAX_VALUE,
        },
      }],
    })
    const result = resolveSkillTransaction(state, skillRequest(state, [attack]))

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'INVALID_NUMERIC_INPUT',
    })
    expect(state.rngState.cursor).toBe(0)
    expect(state.units.find((unit) => unit.id === unitId('target')))
      .toMatchObject({ currentHealth: 100, shield: 5 })
  })

  it.each([
    ['request NaN', (state: ReturnType<typeof createResolvingState>) => ({
      state,
      attack: normalAttack('nan-request', ['target'], { multiplier: Number.NaN }),
    })],
    ['request Infinity', (state: ReturnType<typeof createResolvingState>) => ({
      state,
      attack: normalAttack('infinite-request', ['target'], {
        fixedDamage: Number.POSITIVE_INFINITY,
      }),
    })],
    ['unit health NaN', (state: ReturnType<typeof createResolvingState>) => ({
      state: {
        ...state,
        units: state.units.map((unit) => unit.id === unitId('target')
          ? { ...unit, currentHealth: Number.NaN }
          : unit),
      },
      attack: normalAttack('nan-health', ['target']),
    })],
    ['unit shield Infinity', (state: ReturnType<typeof createResolvingState>) => ({
      state: {
        ...state,
        units: state.units.map((unit) => unit.id === unitId('target')
          ? { ...unit, shield: Number.POSITIVE_INFINITY }
          : unit),
      },
      attack: normalAttack('infinite-shield', ['target']),
    })],
    ['unit reduction NaN', (state: ReturnType<typeof createResolvingState>) => ({
      state: {
        ...state,
        units: state.units.map((unit) => unit.id === unitId('target')
          ? {
              ...unit,
              normalDamageReductionSources: [{
                sourceId: unitId('bad-reduction'),
                reduction: Number.NaN,
              }],
            }
          : unit),
      },
      attack: normalAttack('nan-reduction', ['target']),
    })],
  ])('rejects %s before consuming RNG', (_label, arrange) => {
    const initial = createResolvingState([
      actor(),
      enemy('target'),
    ], createFixedSequenceRandomState([0.1]))
    const arranged = arrange(initial)
    const result = resolveSkillTransaction(
      arranged.state,
      skillRequest(arranged.state, [{ ...arranged.attack, criticalRate: 0.5 }]),
    )

    expect(result.ok).toBe(false)
    expect(result.state).toBe(arranged.state)
    expect(result.events).toEqual([])
    expect(arranged.state.rngState.cursor).toBe(0)
  })

  it('rejects a non-skill-resolution boundary before consuming RNG', () => {
    const resolving = createResolvingState([
      actor(),
      enemy('target'),
    ], createFixedSequenceRandomState([0.1]))
    const invalidState = {
      ...resolving,
      phase: BattlePhase.AwaitingAction,
      personalTurn: resolving.personalTurn === null ? null : {
        ...resolving.personalTurn,
        phase: PersonalTurnPhase.AwaitingAction,
      },
    }
    const result = resolveSkillTransaction(invalidState, skillRequest(
      invalidState,
      [normalAttack('wrong-boundary', ['target'], { criticalRate: 0.5 })],
    ))

    expect(result).toEqual({
      ok: false,
      state: invalidState,
      events: [],
      reason: 'NOT_AT_SKILL_RESOLUTION_BOUNDARY',
    })
    expect(invalidState.rngState.cursor).toBe(0)
  })

  it.each([
    ['duplicate target', 'DUPLICATE_TARGET_ID'],
    ['missing target', 'TARGET_NOT_FOUND'],
    ['dead target', 'TARGET_INVALID_BEFORE_SKILL_START'],
    ['NaN value', 'INVALID_NUMERIC_INPUT'],
  ])('rejects %s atomically with %s', (scenario, reason) => {
    const state = createResolvingState([
      actor(),
      enemy('target'),
      enemy('dead', { alive: false, currentHealth: 0 }),
    ])
    let attack = normalAttack('invalid', ['target'])
    if (scenario === 'duplicate target') {
      attack = {
        ...attack,
        targets: [attack.targets[0], {
          ...attack.targets[0],
          damageEventId: ids.damage('damage:duplicate-target'),
        }],
      }
    } else if (scenario === 'missing target') {
      attack = normalAttack('invalid', ['missing'])
    } else if (scenario === 'dead target') {
      attack = normalAttack('invalid', ['dead'])
    } else {
      attack = { ...attack, multiplier: Number.NaN }
    }

    const result = resolveSkillTransaction(state, skillRequest(state, [attack]))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe(reason)
    expect(result.state).toBe(state)
    expect(result.events).toEqual([])
  })

  it('rejects duplicate attack and damage event IDs before mutation', () => {
    const state = createResolvingState([actor(), enemy('target')])
    const first = normalAttack('same', ['target'])
    const duplicateAttack = resolveSkillTransaction(
      state,
      skillRequest(state, [first, { ...first }]),
    )
    const duplicateDamage = resolveSkillTransaction(state, skillRequest(state, [
      first,
      normalAttack('other', ['target'], {
        targets: [{
          targetId: unitId('target'),
          damageEventId: first.targets[0].damageEventId,
        }],
      }),
    ]))

    expect(duplicateAttack.ok).toBe(false)
    if (!duplicateAttack.ok) expect(duplicateAttack.reason).toBe('ATTACK_ID_ALREADY_USED')
    expect(duplicateDamage.ok).toBe(false)
    if (!duplicateDamage.ok) {
      expect(duplicateDamage.reason).toBe('DAMAGE_EVENT_ID_ALREADY_USED')
    }
  })

  it('rejects context ID mismatches at the phase-two boundary', () => {
    const state = createResolvingState([actor(), enemy('target')])
    const request = skillRequest(state, [normalAttack('one', ['target'])])
    const variants = [
      { ...request, actionId: 'wrong-action' as typeof request.actionId },
      { ...request, personalTurnId: 'wrong-turn' as typeof request.personalTurnId },
      { ...request, sequenceId: 'wrong-sequence' as typeof request.sequenceId },
      { ...request, casterId: unitId('wrong-caster') },
      {
        ...request,
        skillExecutionId: 'wrong-execution' as typeof request.skillExecutionId,
      },
    ]
    const reasons = variants.map((variant) => {
      const result = resolveSkillTransaction(state, variant)
      return result.ok ? null : result.reason
    })

    expect(reasons).toEqual([
      'ACTION_ID_MISMATCH',
      'PERSONAL_TURN_ID_MISMATCH',
      'SEQUENCE_ID_MISMATCH',
      'CASTER_ID_MISMATCH',
      'SKILL_EXECUTION_ID_MISMATCH',
    ])
  })

  it('rejects replaying a completed skill execution', () => {
    const state = createResolvingState([actor(), enemy('target')])
    const request = skillRequest(state, [normalAttack('one', ['target'])])
    const first = resolveSkillTransaction(state, request)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const repeated = resolveSkillTransaction(first.state, request)
    expect(repeated.ok).toBe(false)
    if (!repeated.ok) {
      expect(repeated.reason).toBe('SKILL_EXECUTION_ID_ALREADY_USED')
      expect(repeated.state).toBe(first.state)
    }
  })

  it('does not mutate input units or event arrays on success', () => {
    const state = createResolvingState([actor(), enemy('target')])
    const oldUnits = state.units
    const oldEvents = state.events
    const result = resolveSkillTransaction(state, skillRequest(state, [
      normalAttack('one', ['target']),
    ]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(state.units).toBe(oldUnits)
    expect(state.events).toBe(oldEvents)
    expect(state.units.find((unit) => unit.id === unitId('target'))?.currentHealth)
      .toBe(100)
    expect(result.state.units).not.toBe(oldUnits)
    expect(result.state.events).not.toBe(oldEvents)
  })
})

describe('structured event order', () => {
  it('orders skill, attack, damage, shield, health, extra, and completion events', () => {
    const state = createResolvingState([
      actor(),
      enemy('target', { shield: 5, currentHealth: 30 }),
    ])
    const attack = normalAttack('ordered', ['target'], {
      targets: [{
        targetId: unitId('target'),
        damageEventId: ids.damage('damage:ordered'),
        extraDamage: {
          damageEventId: ids.damage('damage:ordered-extra'),
          value: 3,
        },
      }],
    })
    const result = resolveSkillTransaction(state, skillRequest(state, [attack]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.events.map((event) => event.type)).toEqual([
      'SKILL_RESOLUTION_STARTED',
      'ATTACK_STARTED',
      'CRITICAL_ROLLED',
      'DAMAGE_CALCULATED',
      'SHIELD_ABSORBED',
      'HEALTH_LOST',
      'EXTRA_DAMAGE_APPLIED',
      'ATTACK_COMPLETED',
      'SKILL_RESOLUTION_COMPLETED',
    ])
  })

  it('omits zero shield and health fact events while retaining flow events', () => {
    const noShieldState = createResolvingState([actor(), enemy('no-shield')])
    const noShield = resolveSkillTransaction(noShieldState, skillRequest(
      noShieldState,
      [normalAttack('no-shield', ['no-shield'])],
    ))
    const fullShieldState = createResolvingState([
      actor(),
      enemy('full-shield', { shield: 100 }),
    ])
    const fullShield = resolveSkillTransaction(fullShieldState, skillRequest(
      fullShieldState,
      [normalAttack('full-shield', ['full-shield'])],
    ))
    const zeroState = createResolvingState([actor(), enemy('zero')])
    const zero = resolveSkillTransaction(zeroState, skillRequest(
      zeroState,
      [normalAttack('zero', ['zero'], { effectiveAttack: 0 })],
    ))

    expect(noShield.ok).toBe(true)
    expect(fullShield.ok).toBe(true)
    expect(zero.ok).toBe(true)
    if (!noShield.ok || !fullShield.ok || !zero.ok) return
    expect(noShield.events.some((event) => event.type === 'SHIELD_ABSORBED'))
      .toBe(false)
    expect(fullShield.events.some((event) => event.type === 'HEALTH_LOST'))
      .toBe(false)
    expect(zero.events.some((event) => (
      event.type === 'SHIELD_ABSORBED' || event.type === 'HEALTH_LOST'
    ))).toBe(false)
    expect(zero.events.map((event) => event.type)).toEqual([
      'SKILL_RESOLUTION_STARTED',
      'ATTACK_STARTED',
      'CRITICAL_ROLLED',
      'DAMAGE_CALCULATED',
      'ATTACK_COMPLETED',
      'SKILL_RESOLUTION_COMPLETED',
    ])
  })
})

describe('skill completion gate', () => {
  it('rejects completing a skill action before its resolution succeeds', () => {
    const state = createResolvingState([actor(), enemy('target')])
    const result = completeBattleAction(state, ids.action)

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'SKILL_RESOLUTION_NOT_COMPLETED',
    })
  })

  it('does not accept a fabricated completion field or event without the ID registry', () => {
    const state = createResolvingState([actor(), enemy('target')])
    if (state.activeAction === null || state.personalTurn === null) return
    const forgedState = {
      ...state,
      completedSkillResolution: {
        skillExecutionId: ids.skillExecution,
        actionId: ids.action,
        personalTurnId: state.personalTurn.personalTurnId,
        sequenceId: state.activeAction.sequenceId,
      },
      events: [...state.events, {
        type: 'SKILL_RESOLUTION_COMPLETED' as const,
        skillExecutionId: ids.skillExecution,
        actionId: ids.action,
        skillId: ids.skill,
        casterId: unitId('actor'),
      }],
    }
    const result = completeBattleAction(forgedState, ids.action)

    expect(result).toEqual({
      ok: false,
      state: forgedState,
      events: [],
      reason: 'SKILL_RESOLUTION_NOT_COMPLETED',
    })
  })

  it('allows action completion only after the matching skill completes', () => {
    const state = createResolvingState([actor(), enemy('target')])
    const resolved = resolveBattleSkill(state, skillRequest(state, [
      normalAttack('gate-success', ['target']),
    ]))

    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const completed = completeBattleAction(resolved.state, ids.action)
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.state.activeAction).toBeNull()
    expect(completed.state.completedSkillResolution).toBeNull()
  })

  it('skips a unit killed by the skill after completing the turn-ending action', () => {
    const sequence = startBattleSequence(createBattleState([
      actor(),
      enemy('next', { speed: 100, currentHealth: 10 }),
      enemy('survivor', { speed: 50 }),
    ]))
    expect(sequence.ok).toBe(true)
    if (!sequence.ok || sequence.state.personalTurn === null) return
    const action = startBattleAction(sequence.state, {
      actionId: ids.action,
      actorId: unitId('actor'),
      skillExecutionId: ids.skillExecution,
      endsTurn: true,
    })
    expect(action.ok).toBe(true)
    if (!action.ok) return
    if (action.state.personalTurn === null || action.state.activeAction === null) return
    const skill = skillRequest(action.state, [normalAttack('kill-next', ['next'])])
    const resolved = resolveResourcePaidSkillTransaction(action.state, {
      resourceTransactionId: 'resource:kill-next' as ResourceTransactionId,
      actionId: ids.action,
      personalTurnId: action.state.personalTurn.personalTurnId,
      sequenceId: action.state.activeAction.sequenceId,
      skillExecutionId: ids.skillExecution,
      payerUnitId: unitId('actor'),
      costs: [],
    }, skill)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const completed = completeBattleAction(resolved.state, ids.action)

    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.state.personalTurn?.unitId).toBe(unitId('survivor'))
    expect(completed.events).toContainEqual(expect.objectContaining({
      type: 'UNIT_SKIPPED_DEAD',
      unitId: unitId('next'),
    }))
  })

  it('cannot reuse a completed skill execution to complete another action', () => {
    const state = createResolvingState([actor(), enemy('target')])
    const resolved = resolveBattleSkill(state, skillRequest(state, [
      normalAttack('first-action', ['target']),
    ]))
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const completed = completeBattleAction(resolved.state, ids.action)
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    const secondActionId = 'action:second' as typeof ids.action
    const second = startBattleAction(completed.state, {
      actionId: secondActionId,
      actorId: unitId('actor'),
      skillExecutionId: ids.skillExecution,
      endsTurn: false,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    const bypass = completeBattleAction(second.state, secondActionId)

    expect(bypass.ok).toBe(false)
    if (!bypass.ok) {
      expect(bypass.reason).toBe('SKILL_RESOLUTION_NOT_COMPLETED')
      expect(bypass.state).toBe(second.state)
    }
  })
})
