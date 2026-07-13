import { describe, expect, it } from 'vitest'
import type {
  AttackId,
  DamageEventId,
  SkillExecutionId,
} from '../game/core/identifiers'
import {
  requestUnitDefeat,
  requestUnitPercentageMaximumHealthDamage,
  requestUnitVitalState,
  resolveVitalityChange,
} from '../game/core/vitality'
import { createBattleState, createUnit, unitId } from './battleTestUtils'

const context = {
  skillExecutionId: 'skill-execution:vitality-test' as SkillExecutionId,
  attackId: 'attack:vitality-test' as AttackId,
  damageEventId: 'damage:vitality-test' as DamageEventId,
}

describe('central vitality rules', () => {
  it('preserves finite-unit damage and death semantics', () => {
    expect(resolveVitalityChange({
      currentHealth: 10,
      hasInfiniteHealth: false,
      alive: true,
    }, {
      kind: 'healthLoss',
      amount: 12,
    })).toEqual({
      ok: true,
      healthLost: 10,
      remainingHealth: 0,
      alive: false,
      causedDeath: true,
      targetWasAlreadyDead: false,
    })
  })

  it('blocks every vitality change for infinite-health units', () => {
    const infinite = {
      currentHealth: 1,
      hasInfiniteHealth: true,
      alive: true,
    }
    const changes = [
      { kind: 'healthLoss', amount: 999 } as const,
      {
        kind: 'percentageMaximumHealthDamage',
        maximumHealth: 1,
        percentage: 1,
      } as const,
      { kind: 'defeat', cause: 'execute' } as const,
      { kind: 'defeat', cause: 'directDeath' } as const,
      { kind: 'setState', currentHealth: 0, alive: false } as const,
    ]

    for (const change of changes) {
      expect(resolveVitalityChange(infinite, change)).toMatchObject({
        ok: true,
        healthLost: 0,
        remainingHealth: 1,
        alive: true,
        causedDeath: false,
      })
    }
  })

  it('emits one death event and suppresses a repeated finite death request', () => {
    const initial = createBattleState([createUnit('finite')])
    const first = requestUnitDefeat(initial, {
      unitId: unitId('finite'),
      cause: 'execute',
      ...context,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const repeated = requestUnitDefeat(first.state, {
      unitId: unitId('finite'),
      cause: 'directDeath',
      ...context,
    })

    expect(first.events.filter((event) => event.type === 'UNIT_DIED')).toHaveLength(1)
    expect(first.state.units[0]).toMatchObject({ currentHealth: 0, alive: false })
    expect(repeated.ok).toBe(true)
    if (!repeated.ok) return
    expect(repeated.state).toBe(first.state)
    expect(repeated.events).toEqual([])
  })

  it('applies percentage maximum-health damage through BattleState', () => {
    const initial = createBattleState([createUnit('finite', {
      currentHealth: 40,
      maximumHealth: 100,
    })])
    const result = requestUnitPercentageMaximumHealthDamage(initial, {
      unitId: unitId('finite'),
      percentage: 0.25,
      ...context,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units[0]).toMatchObject({
      currentHealth: 15,
      alive: true,
    })
    expect(result.events).toEqual([expect.objectContaining({
      type: 'HEALTH_LOST',
      amount: 25,
      remainingHealth: 15,
    })])
  })

  it('normalizes an attempted external death of an infinite unit', () => {
    const unit = createUnit('infinite', {
      currentHealth: 0,
      maximumHealth: 1,
      hasInfiniteHealth: true,
      alive: false,
    })
    const initial = createBattleState([unit])
    const result = requestUnitVitalState(initial, {
      unitId: unit.id,
      currentHealth: 0,
      alive: false,
      ...context,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units[0]).toMatchObject({ currentHealth: 0, alive: true })
    expect(result.events).toEqual([])
  })
})
