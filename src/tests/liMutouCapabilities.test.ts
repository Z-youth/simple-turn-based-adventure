import { describe, expect, it } from 'vitest'
import {
  endCurrentPersonalTurn,
  startBattleSequence,
} from '../game/core/battleEngine'
import type { BattleEngineExtensions } from '../game/core/battleEngine'
import { getMomentumPressureLayers, getMomentumEffectLayers, getMomentumAttackLayers, getEffectiveAttack } from '../game/core/unitQueries'
import { recalculateMomentumPressure } from '../game/core/momentumPressure'
import {
  gainResource,
  ResourceType,
  setResource,
  spendResource,
} from '../game/core/resources'
import { healUnit } from '../game/core/vitality'
import { createBattleState, createUnit, unitId } from './battleTestUtils'

const context = {
  actionId: null,
  personalTurnId: null,
  sequenceId: null,
  skillExecutionId: null,
  resourceTransactionId: null,
}

const microMomentumRules = [
  {
    maximumActualMomentum: 8,
    attackLayersPerMomentum: 1,
    effectLayersPerMomentum: 3,
    pressureLayersPerMomentum: 3,
  },
  {
    maximumActualMomentum: 15,
    attackLayersPerMomentum: 2,
    effectLayersPerMomentum: 1,
    pressureLayersPerMomentum: 1,
  },
  {
    maximumActualMomentum: null,
    attackLayersPerMomentum: 1,
    effectLayersPerMomentum: 1,
    pressureLayersPerMomentum: 1,
  },
] as const

describe('Li Mutou prerequisite capabilities', () => {
  it('runs content sequence-start effects after the sequence event and before its first turn', () => {
    const extensions: BattleEngineExtensions = {
      applySequenceStartEffects(state, sequence) {
        return gainResource(state, {
          unitId: unitId('first'),
          resourceType: ResourceType.Energy,
          amount: 3,
          reason: `sequence:${sequence.sequenceNumber}`,
          sourceId: null,
          ...context,
        })
      },
    }
    const started = startBattleSequence(createBattleState([
      createUnit('first', { speed: 200 }),
      createUnit('second', { speed: 100 }),
    ]), extensions)

    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    expect(started.state.units.find((unit) => unit.id === unitId('first'))?.energy)
      .toBe(3)
    const labels = started.events.map((event) => event.type === 'RESOURCE_GAINED'
      ? `${event.type}:${event.reason}`
      : event.type)
    expect(labels.indexOf('SEQUENCE_STARTED'))
      .toBeLessThan(labels.indexOf('RESOURCE_GAINED:sequence:1'))
    expect(labels.indexOf('RESOURCE_GAINED:sequence:1'))
      .toBeLessThan(labels.indexOf('TURN_STARTED'))

    const afterFirst = endCurrentPersonalTurn(
      started.state,
      started.state.personalTurn.personalTurnId,
      extensions,
    )
    expect(afterFirst.ok).toBe(true)
    if (!afterFirst.ok || afterFirst.state.personalTurn === null) return
    const afterSecond = endCurrentPersonalTurn(
      afterFirst.state,
      afterFirst.state.personalTurn.personalTurnId,
      extensions,
    )
    expect(afterSecond.ok).toBe(true)
    if (!afterSecond.ok) return
    expect(afterSecond.state.units.find((unit) => unit.id === unitId('first'))?.energy)
      .toBe(6)
  })

  it('heals only up to maximum health and emits an explicit healing event', () => {
    const initial = createBattleState([createUnit('owner', {
      currentHealth: 80,
      maximumHealth: 100,
      shield: 15,
    })])
    const healed = healUnit(initial, {
      unitId: unitId('owner'),
      amount: 30,
      reason: 'testHeal',
      sourceUnitId: null,
      effectId: null,
      actionId: null,
      personalTurnId: null,
      sequenceId: null,
      skillExecutionId: null,
    })

    expect(healed.ok).toBe(true)
    if (!healed.ok) return
    expect(healed.state.units[0]).toMatchObject({
      currentHealth: 100,
      shield: 15,
      alive: true,
    })
    expect(healed.events).toEqual([expect.objectContaining({
      type: 'HEALTH_RESTORED', amount: 20, before: 80, after: 100,
    })])
    const fullHealth = healUnit(healed.state, {
      unitId: unitId('owner'), amount: 1, reason: 'testHeal', sourceUnitId: null, effectId: null,
      actionId: null, personalTurnId: null, sequenceId: null, skillExecutionId: null,
    })
    expect(fullHealth).toMatchObject({ ok: true, changed: false, events: [] })
  })

  it('sets resources directly without gain, spend, or reduction-prevention events', () => {
    const initial = createBattleState([createUnit('owner', {
      energy: 0,
      momentum: 12,
    })])
    const momentum = setResource(initial, {
      unitId: unitId('owner'), resourceType: ResourceType.Momentum,
      value: 6, reason: 'testSetMomentum', sourceId: null, ...context,
    })
    expect(momentum.ok).toBe(true)
    if (!momentum.ok) return
    const energy = setResource(momentum.state, {
      unitId: unitId('owner'), resourceType: ResourceType.Energy,
      value: 2, reason: 'testSetEnergy', sourceId: null, ...context,
    })
    expect(energy.ok).toBe(true)
    if (!energy.ok) return
    expect(energy.state.units[0]).toMatchObject({ momentum: 6, energy: 2 })
    expect(energy.events.every((event) => event.type === 'RESOURCE_SET')).toBe(true)
    expect(energy.state.events.some((event) => (
      event.type === 'RESOURCE_GAINED'
      || event.type === 'RESOURCE_SPENT'
      || event.type === 'RESOURCE_REDUCTION_PREVENTED'
    ))).toBe(false)
    const pressure = setResource(energy.state, {
      unitId: unitId('owner'), resourceType: ResourceType.MomentumPressure,
      value: 1, reason: 'testSetPressure', sourceId: null, ...context,
    })
    expect(pressure).toMatchObject({
      ok: false,
      reason: 'RESOURCE_OPERATION_NOT_ALLOWED',
    })
  })

  it('keeps standard momentum reads while allowing data-driven micro-momentum reads', () => {
    const standard = createUnit('standard', { momentum: 12 })
    expect(getMomentumAttackLayers(standard)).toBe(12)
    expect(getMomentumEffectLayers(standard)).toBe(12)
    expect(getMomentumPressureLayers(standard)).toBe(12)
    expect(getEffectiveAttack(standard)).toBe(22)

    const low = createUnit('low', {
      momentum: 8,
      momentumReadRules: microMomentumRules,
    })
    expect(getMomentumAttackLayers(low)).toBe(8)
    expect(getMomentumEffectLayers(low)).toBe(24)
    expect(getMomentumPressureLayers(low)).toBe(24)
    expect(getEffectiveAttack(low)).toBe(18)
    const middle = { ...low, momentum: 9 }
    expect(getMomentumAttackLayers(middle)).toBe(18)
    expect(getMomentumEffectLayers(middle)).toBe(9)
    const high = { ...low, momentum: 16 }
    expect(getMomentumAttackLayers(high)).toBe(16)
    expect(getMomentumEffectLayers(high)).toBe(16)
  })

  it('uses custom pressure layers and runs the existing pre-pressure hook first', () => {
    const extensions: BattleEngineExtensions = {
      applyTurnStartPreSystemEffects(state, turn) {
        return spendResource(state, {
          unitId: turn.unitId,
          resourceType: ResourceType.Momentum,
          amount: 2,
          reason: 'testPrePressureReduction',
          sourceId: null,
          actionId: null,
          personalTurnId: turn.personalTurnId,
          sequenceId: turn.sequenceId,
          skillExecutionId: null,
          resourceTransactionId: null,
        })
      },
    }
    const started = startBattleSequence(createBattleState([createUnit('owner', {
      baseAttackAtBattleEntry: 10,
      momentum: 17,
      momentumReadRules: microMomentumRules,
    })]), extensions)

    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    expect(started.state.units[0]).toMatchObject({
      momentum: 15,
      momentumPressure: 1,
    })
    const spentIndex = started.events.findIndex((event) => (
      event.type === 'RESOURCE_SPENT' && event.reason === 'testPrePressureReduction'
    ))
    const pressureIndex = started.events.findIndex((event) => (
      event.type === 'MOMENTUM_PRESSURE_RECALCULATED'
    ))
    expect(spentIndex).toBeGreaterThan(-1)
    expect(spentIndex).toBeLessThan(pressureIndex)

    const recalculated = recalculateMomentumPressure(
      started.state,
      unitId('owner'),
      started.state.personalTurn,
    )
    expect(recalculated).toMatchObject({
      ok: false,
      reason: 'NOT_AT_MOMENTUM_PRESSURE_RECALCULATION_BOUNDARY',
    })
  })
})
