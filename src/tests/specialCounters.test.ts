import { describe, expect, it } from 'vitest'
import type { SpecialCounterId } from '../game/core/identifiers'
import {
  decreaseSpecialCounter,
  increaseSpecialCounter,
  readSpecialCounter,
} from '../game/core/specialCounters'
import {
  gainResource,
  ResourceType,
  spendResource,
} from '../game/core/resources'
import { canAffordResourceCosts } from '../game/core/resourceSelectors'
import { createBattleState, createUnit, unitId } from './battleTestUtils'

const counterId = 'counter:test-protection' as SpecialCounterId

function counterRequest(amount: number) {
  return {
    unitId: unitId('owner'),
    counterId,
    amount,
    actionId: null,
    personalTurnId: null,
    sequenceId: null,
    skillExecutionId: null,
  }
}

function resourceRequest(amount: number) {
  return {
    unitId: unitId('owner'),
    resourceType: ResourceType.Momentum,
    amount,
    reason: 'special-counter-test',
    sourceId: null,
    actionId: null,
    personalTurnId: null,
    sequenceId: null,
    skillExecutionId: null,
    resourceTransactionId: null,
  }
}

describe('special counters', () => {
  it('defaults to zero, stacks, decreases, and clamps at zero', () => {
    const initial = createBattleState([createUnit('owner')])

    expect(readSpecialCounter(initial.units[0], counterId)).toBe(0)
    const first = increaseSpecialCounter(initial, counterRequest(2))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = increaseSpecialCounter(first.state, counterRequest(3))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(readSpecialCounter(second.state.units[0], counterId)).toBe(5)

    const reduced = decreaseSpecialCounter(second.state, counterRequest(4))
    expect(reduced.ok).toBe(true)
    if (!reduced.ok) return
    expect(readSpecialCounter(reduced.state.units[0], counterId)).toBe(1)
    const clamped = decreaseSpecialCounter(reduced.state, counterRequest(99))
    expect(clamped.ok).toBe(true)
    if (!clamped.ok) return
    expect(readSpecialCounter(clamped.state.units[0], counterId)).toBe(0)
    expect(clamped.state.units[0].specialCounters).toEqual([])
    expect(clamped.events[0]).toMatchObject({
      type: 'SPECIAL_COUNTER_CHANGED',
      operation: 'decrease',
      amount: 1,
      before: 1,
      after: 0,
    })
    expect(initial.units[0].specialCounters).toEqual([])
  })

  it('rejects an invalid change without touching state, events, or RNG', () => {
    const state = createBattleState([createUnit('owner')])
    const result = increaseSpecialCounter(state, counterRequest(-1))

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'INVALID_SPECIAL_COUNTER_AMOUNT',
    })
    expect(result.state.rngState).toBe(state.rngState)
  })
})

describe('conditional resource reduction protection', () => {
  it('prevents external reduction while allowing gains', () => {
    const state = createBattleState([createUnit('owner', {
      momentum: 5,
      specialCounters: [{ counterId, value: 1 }],
      resourceReductionProtections: [{
        resourceType: ResourceType.Momentum,
        counterId,
        minimumCounterValue: 1,
      }],
    })])
    const spent = spendResource(state, resourceRequest(99))

    expect(spent.ok).toBe(true)
    if (!spent.ok) return
    expect(spent.state.units[0].momentum).toBe(5)
    expect(spent.events).toEqual([
      expect.objectContaining({
        type: 'RESOURCE_REDUCTION_PREVENTED',
        resourceType: ResourceType.Momentum,
        attemptedAmount: 99,
        protectionCounterId: counterId,
      }),
    ])
    expect(canAffordResourceCosts(
      spent.state.units[0],
      [{ resourceType: ResourceType.Momentum, amount: 99 }],
      spent.state.resourceConfiguration,
    )).toBe(true)

    const gained = gainResource(spent.state, resourceRequest(2))
    expect(gained.ok).toBe(true)
    if (!gained.ok) return
    expect(gained.state.units[0].momentum).toBe(7)
    expect(gained.events[0]).toMatchObject({ type: 'RESOURCE_GAINED', amount: 2 })
  })

  it('restores normal reduction after the protection counter reaches zero', () => {
    const state = createBattleState([createUnit('owner', {
      momentum: 5,
      specialCounters: [{ counterId, value: 1 }],
      resourceReductionProtections: [{
        resourceType: ResourceType.Momentum,
        counterId,
        minimumCounterValue: 1,
      }],
    })])
    const disabled = decreaseSpecialCounter(state, counterRequest(1))
    expect(disabled.ok).toBe(true)
    if (!disabled.ok) return
    const spent = spendResource(disabled.state, resourceRequest(3))

    expect(spent.ok).toBe(true)
    if (!spent.ok) return
    expect(spent.state.units[0].momentum).toBe(2)
    expect(spent.events[0]).toMatchObject({ type: 'RESOURCE_SPENT', amount: 3 })
  })
})
