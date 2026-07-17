import { describe, expect, it } from 'vitest'
import { Camp, Position } from '../game/core/enums'
import {
  compareUnitsForTurnOrder,
  createTurnQueue,
} from '../game/core/turnOrder'
import { createUnit } from './battleTestUtils'

function orderedIds(units: ReturnType<typeof createUnit>[]): string[] {
  const result = createTurnQueue(units)
  if (!result.ok) throw new Error(result.reason)
  return result.queue.map((entry) => entry.unitId)
}

describe('turn order', () => {
  it('sorts units by current speed from highest to lowest', () => {
    const units = [
      createUnit('slow', { speed: 80, position: Position.Back1 }),
      createUnit('fast', { speed: 120, position: Position.Front1 }),
      createUnit('middle', { speed: 100, position: Position.Front2 }),
    ]

    expect(orderedIds(units)).toEqual(['fast', 'middle', 'slow'])
  })

  it('puts players before enemies at equal speed', () => {
    const units = [
      createUnit('enemy', { camp: Camp.Enemy, position: null }),
      createUnit('player', { camp: Camp.Player, position: Position.Back2 }),
    ]

    expect(orderedIds(units)).toEqual(['player', 'enemy'])
  })

  it('orders equal-speed players by battlefield position', () => {
    const units = [
      createUnit('back2', { position: Position.Back2 }),
      createUnit('front2', { position: Position.Front2 }),
      createUnit('back1', { position: Position.Back1 }),
      createUnit('front1', { position: Position.Front1 }),
    ]

    expect(orderedIds(units)).toEqual([
      'front1',
      'front2',
      'back1',
      'back2',
    ])
  })

  it('uses stable deployment order for all equal-speed enemies', () => {
    const units = [
      createUnit('enemy-late', {
        camp: Camp.Enemy,
        position: null,
        deploymentOrder: 2,
      }),
      createUnit('boss', {
        camp: Camp.Enemy,
        position: null,
        isBoss: true,
        deploymentOrder: 3,
      }),
      createUnit('enemy-early', {
        camp: Camp.Enemy,
        position: null,
        deploymentOrder: 1,
      }),
    ]

    expect(orderedIds(units)).toEqual(['enemy-early', 'enemy-late', 'boss'])
  })

  it('excludes unplaced players and units already dead at sequence creation', () => {
    const units = [
      createUnit('placed'),
      createUnit('empty-position', { position: null }),
      createUnit('dead-flag', { alive: false, position: Position.Front2 }),
      createUnit('zero-health', { currentHealth: 0, position: Position.Back1 }),
    ]

    expect(orderedIds(units)).toEqual(['placed'])
  })

  it('uses deployment order and unit ID as explicit final comparisons', () => {
    const alpha = createUnit('alpha', { deploymentOrder: 1 })
    const beta = createUnit('beta', { deploymentOrder: 1 })
    const late = createUnit('late', { deploymentOrder: 2 })

    expect(compareUnitsForTurnOrder(alpha, late)).toBeLessThan(0)
    expect(compareUnitsForTurnOrder(alpha, beta)).toBeLessThan(0)
  })
})
