import { describe, expect, it } from 'vitest'
import type { ActionId, SkillId } from '../game/core/identifiers'
import {
  completeBattleAction,
  completeCurrentBattleAction,
  startBattleAction,
  startBattleSequence,
} from '../game/core/battleEngine'
import type { BattleState } from '../game/core/contexts'
import {
  applyTemporaryAttributeModifier,
  TemporaryAttribute,
  type TemporaryModifierDurationRequest,
} from '../game/core/temporaryModifiers'
import {
  getEffectiveAttack,
  getEffectiveCriticalDamage,
  getEffectiveCriticalRate,
} from '../game/core/unitQueries'
import { createBattleState, createUnit, unitId } from './battleTestUtils'

const sourceId = 'skill:temporary-modifier-test' as SkillId

function setup(): BattleState {
  const started = startBattleSequence(createBattleState([
    createUnit('actor', { speed: 200 }),
    createUnit('other', { speed: 100 }),
  ]))
  if (!started.ok) throw new Error('Could not start modifier test battle')
  return started.state
}

function applyModifier(
  state: BattleState,
  attribute: 'attack' | 'criticalRate' | 'criticalDamage',
  value: number,
  duration: TemporaryModifierDurationRequest,
  source: SkillId = sourceId,
) {
  const turn = state.personalTurn
  if (turn === null) throw new Error('Missing modifier test turn')
  return applyTemporaryAttributeModifier(state, {
    unitId: unitId('actor'),
    sourceUnitId: unitId('actor'),
    effectId: source,
    attribute,
    value,
    duration,
    actionId: null,
    personalTurnId: turn.personalTurnId,
    sequenceId: turn.sequenceId,
    skillExecutionId: null,
  })
}

function finishAction(
  state: BattleState,
  actor: 'actor' | 'other',
  actionName: string,
): BattleState {
  const actionId = `action:${actionName}` as ActionId
  const started = startBattleAction(state, {
    actionId,
    actorId: unitId(actor),
    endsTurn: true,
  })
  if (!started.ok) throw new Error(`Could not start ${actionName}`)
  const completed = completeBattleAction(started.state, actionId)
  if (!completed.ok) throw new Error(`Could not complete ${actionName}`)
  return completed.state
}

describe('temporary attribute modifiers', () => {
  it('applies attack +2 immediately and removes it at the current turn end', () => {
    const initial = setup()
    const applied = applyModifier(
      initial,
      TemporaryAttribute.Attack,
      2,
      { kind: 'currentPersonalTurn' },
    )

    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const beforeEnd = applied.state.units.find((unit) => unit.id === unitId('actor'))
    expect(beforeEnd?.baseAttackAtBattleEntry).toBe(10)
    if (beforeEnd === undefined) return
    expect(getEffectiveAttack(beforeEnd)).toBe(12)

    const ended = finishAction(applied.state, 'actor', 'current-turn')
    const afterEnd = ended.units.find((unit) => unit.id === unitId('actor'))
    expect(afterEnd?.baseAttackAtBattleEntry).toBe(10)
    expect(afterEnd?.temporaryAttributeModifiers).toEqual([])
    if (afterEnd === undefined) return
    expect(getEffectiveAttack(afterEnd)).toBe(10)
    expect(ended.events).toContainEqual(expect.objectContaining({
      type: 'TEMPORARY_ATTRIBUTE_CHANGED',
      operation: 'removed',
      attribute: TemporaryAttribute.Attack,
      expiresAtPersonalTurnId: initial.personalTurn?.personalTurnId,
    }))
  })

  it('counts critical modifiers down only at the owner own turn end', () => {
    const initial = setup()
    const rate = applyModifier(
      initial,
      TemporaryAttribute.CriticalRate,
      0.2,
      { kind: 'ownerTurns', turns: 2 },
    )
    expect(rate.ok).toBe(true)
    if (!rate.ok) return
    const damage = applyModifier(
      rate.state,
      TemporaryAttribute.CriticalDamage,
      0.5,
      { kind: 'ownerTurns', turns: 2 },
    )
    expect(damage.ok).toBe(true)
    if (!damage.ok) return

    const afterFirstOwnerTurn = finishAction(
      damage.state,
      'actor',
      'actor-first',
    )
    const afterFirst = afterFirstOwnerTurn.units.find(
      (unit) => unit.id === unitId('actor'),
    )
    expect(afterFirst?.temporaryAttributeModifiers.map((modifier) => (
      modifier.duration.kind === 'ownerTurns'
        ? modifier.duration.remainingTurns
        : null
    ))).toEqual([1, 1])

    const afterOtherTurn = finishAction(
      afterFirstOwnerTurn,
      'other',
      'other-first',
    )
    const afterOther = afterOtherTurn.units.find(
      (unit) => unit.id === unitId('actor'),
    )
    expect(afterOther?.temporaryAttributeModifiers.map((modifier) => (
      modifier.duration.kind === 'ownerTurns'
        ? modifier.duration.remainingTurns
        : null
    ))).toEqual([1, 1])
    if (afterOther === undefined) return
    expect(getEffectiveCriticalRate(afterOther)).toBeCloseTo(0.2)
    expect(getEffectiveCriticalDamage(afterOther)).toBeCloseTo(1)

    const afterSecondOwnerTurn = finishAction(
      afterOtherTurn,
      'actor',
      'actor-second',
    )
    const afterSecond = afterSecondOwnerTurn.units.find(
      (unit) => unit.id === unitId('actor'),
    )
    expect(afterSecond?.temporaryAttributeModifiers).toEqual([])
    if (afterSecond === undefined) return
    expect(getEffectiveCriticalRate(afterSecond)).toBe(0)
    expect(getEffectiveCriticalDamage(afterSecond)).toBe(0.5)
  })

  it('stacks modifiers without overwriting base attributes', () => {
    const initial = setup()
    const attackOne = applyModifier(
      initial,
      TemporaryAttribute.Attack,
      2,
      { kind: 'ownerTurns', turns: 3 },
    )
    expect(attackOne.ok).toBe(true)
    if (!attackOne.ok) return
    const attackTwo = applyModifier(
      attackOne.state,
      TemporaryAttribute.Attack,
      3,
      { kind: 'ownerTurns', turns: 3 },
      'skill:second-modifier' as SkillId,
    )
    expect(attackTwo.ok).toBe(true)
    if (!attackTwo.ok) return
    const rate = applyModifier(
      attackTwo.state,
      TemporaryAttribute.CriticalRate,
      0.2,
      { kind: 'ownerTurns', turns: 3 },
    )
    expect(rate.ok).toBe(true)
    if (!rate.ok) return
    const damage = applyModifier(
      rate.state,
      TemporaryAttribute.CriticalDamage,
      0.5,
      { kind: 'ownerTurns', turns: 3 },
    )
    expect(damage.ok).toBe(true)
    if (!damage.ok) return
    const actor = damage.state.units.find((unit) => unit.id === unitId('actor'))
    if (actor === undefined) return

    expect(actor).toMatchObject({
      baseAttackAtBattleEntry: 10,
      criticalRate: 0,
      criticalDamage: 0.5,
    })
    expect(actor.temporaryAttributeModifiers).toHaveLength(4)
    expect(getEffectiveAttack(actor)).toBe(15)
    expect(getEffectiveCriticalRate(actor)).toBeCloseTo(0.2)
    expect(getEffectiveCriticalDamage(actor)).toBeCloseTo(1)
  })

  it('rolls turn-end modifier duration and events back when the hook fails', () => {
    const initial = setup()
    const applied = applyModifier(
      initial,
      TemporaryAttribute.CriticalRate,
      0.2,
      { kind: 'ownerTurns', turns: 2 },
    )
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    const actionId = 'action:failed-turn-end' as ActionId
    const started = startBattleAction(applied.state, {
      actionId,
      actorId: unitId('actor'),
      endsTurn: true,
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const failed = completeCurrentBattleAction(started.state, actionId, {
      applyUnitTurnEndEffects(state) {
        return {
          ok: false,
          state,
          events: [],
          reason: 'FORCED_TURN_END_FAILURE',
        }
      },
    })

    expect(failed.ok).toBe(false)
    if (failed.ok) return
    const actor = failed.state.units.find((unit) => unit.id === unitId('actor'))
    expect(actor?.temporaryAttributeModifiers).toEqual([
      expect.objectContaining({
        duration: { kind: 'ownerTurns', remainingTurns: 2 },
      }),
    ])
    expect(failed.state.events.some((event) => (
      event.type === 'TEMPORARY_ATTRIBUTE_CHANGED'
      && event.operation !== 'applied'
    ))).toBe(false)
  })
})
