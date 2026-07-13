import { describe, expect, it } from 'vitest'
import {
  calculateAddedShield,
  calculateDirectHealthDamage,
  calculateShieldedDamage,
  gainShield,
} from '../game/core/shields'
import type {
  PersonalTurnId,
  TurnSequenceId,
} from '../game/core/identifiers'
import { createBattleState, createUnit, unitId } from './battleTestUtils'

describe('shield changes', () => {
  it('adds shield without replacing the existing indefinite value', () => {
    const unit = createUnit('unit', { shield: 5.2 })
    const updated = calculateAddedShield(unit.shield, 4.3)

    expect(updated).toBe(9.5)
    expect(unit.shield).toBe(5.2)
  })

  it('rejects finite shield addition that overflows the numeric range', () => {
    expect(calculateAddedShield(Number.MAX_VALUE, Number.MAX_VALUE)).toEqual({
      ok: false,
      reason: 'INVALID_SHIELD_CALCULATION_RANGE',
    })
  })

  it('commits shield gain through the stateful event boundary', () => {
    const state = createBattleState([createUnit('unit', { shield: 5 })])
    const result = gainShield(state, {
      unitId: unitId('unit'),
      amount: 20,
      reason: 'testShieldGain',
      personalTurnId: 'turn:test' as PersonalTurnId,
      sequenceId: 'sequence:test' as TurnSequenceId,
      skillExecutionId: null,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units[0].shield).toBe(25)
    expect(result.events).toEqual([expect.objectContaining({
      type: 'SHIELD_GAINED',
      unitId: unitId('unit'),
      amount: 20,
      before: 5,
      after: 25,
      reason: 'testShieldGain',
    })])
  })

  it('returns the original battle state when stateful shield gain fails', () => {
    const state = createBattleState([createUnit('unit', {
      shield: Number.MAX_SAFE_INTEGER,
    })])
    const result = gainShield(state, {
      unitId: unitId('unit'),
      amount: 1,
      reason: 'overflow',
      personalTurnId: null,
      sequenceId: null,
      skillExecutionId: null,
    })

    expect(result.ok).toBe(false)
    expect(result.state).toBe(state)
    expect(result.events).toEqual([])
    expect(result.state.units).toBe(state.units)
    expect(result.state.events).toBe(state.events)
    expect(result.state.rngState).toBe(state.rngState)
  })

  it('lets shield fully absorb normal damage', () => {
    const unit = createUnit('unit', { shield: 20, currentHealth: 100 })
    const result = calculateShieldedDamage({
      currentHealth: unit.currentHealth,
      currentShield: unit.shield,
      hasInfiniteHealth: unit.hasInfiniteHealth,
      alive: unit.alive,
      resolvedDamage: 12.5,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.shieldAbsorbed).toBe(12.5)
    expect(result.healthLost).toBe(0)
    expect(result.remainingShield).toBe(7.5)
  })

  it('applies overflow to health without negative shield or health', () => {
    const unit = createUnit('unit', {
      shield: 5.2,
      currentHealth: 7,
    })
    const result = calculateShieldedDamage({
      currentHealth: unit.currentHealth,
      currentShield: unit.shield,
      hasInfiniteHealth: unit.hasInfiniteHealth,
      alive: unit.alive,
      resolvedDamage: 12.5,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.shieldAbsorbed).toBe(5.2)
    expect(result.healthLost).toBe(7)
    expect(result.remainingShield).toBe(0)
    expect(result.remainingHealth).toBe(0)
    expect(result.causedDeath).toBe(true)
  })

  it('does not create a second death for an already dead target', () => {
    const unit = createUnit('dead', {
      currentHealth: 0,
      alive: false,
    })
    const result = calculateShieldedDamage({
      currentHealth: unit.currentHealth,
      currentShield: unit.shield,
      hasInfiniteHealth: unit.hasInfiniteHealth,
      alive: unit.alive,
      resolvedDamage: 10,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.targetWasAlreadyDead).toBe(true)
    expect(result.causedDeath).toBe(false)
    expect(result.healthLost).toBe(0)
  })
})

describe('direct health damage', () => {
  it('bypasses shield and clamps health to zero', () => {
    const unit = createUnit('unit', { shield: 100, currentHealth: 5 })
    const result = calculateDirectHealthDamage({
      currentHealth: unit.currentHealth,
      hasInfiniteHealth: unit.hasInfiniteHealth,
      alive: unit.alive,
      resolvedDamage: 12,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(unit.shield).toBe(100)
    expect(result.remainingHealth).toBe(0)
    expect(result.causedDeath).toBe(true)
  })

  it('does not mutate an infinite-health unit', () => {
    const unit = createUnit('infinite', {
      currentHealth: 0,
      maximumHealth: Number.POSITIVE_INFINITY,
      hasInfiniteHealth: true,
    })
    const result = calculateDirectHealthDamage({
      currentHealth: unit.currentHealth,
      hasInfiniteHealth: unit.hasInfiniteHealth,
      alive: unit.alive,
      resolvedDamage: 50,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.remainingHealth).toBe(0)
    expect(unit.alive).toBe(true)
    expect(result.causedDeath).toBe(false)
  })
})
