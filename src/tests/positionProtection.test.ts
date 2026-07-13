import { describe, expect, it } from 'vitest'
import { Position } from '../game/core/enums'
import {
  createPositionProtectionSnapshot,
  getPositionProtectionReduction,
} from '../game/core/positionProtection'
import { createUnit, unitId } from './battleTestUtils'

describe('position protection snapshots', () => {
  it.each([
    [Position.Front1, Position.Back1],
    [Position.Front2, Position.Back2],
  ])('%s protects the corresponding %s position', (front, back) => {
    const units = [
      createUnit('front', { position: front }),
      createUnit('back', { position: back }),
    ]
    const snapshot = createPositionProtectionSnapshot(units, [unitId('back')])

    expect(getPositionProtectionReduction(snapshot, unitId('back'))).toBe(0.5)
    expect(snapshot[0].protectedByUnitId).toBe(unitId('front'))
  })

  it('does not let the other front position substitute for the protector', () => {
    const snapshot = createPositionProtectionSnapshot([
      createUnit('front2', { position: Position.Front2 }),
      createUnit('back1', { position: Position.Back1 }),
    ], [unitId('back1')])

    expect(getPositionProtectionReduction(snapshot, unitId('back1'))).toBe(0)
  })

  it.each([
    [{ alive: false }, 0],
    [{ currentHealth: 0 }, 0],
    [{ position: null }, 0],
  ])('requires a living deployed corresponding front: %o', (frontOverrides, expected) => {
    const snapshot = createPositionProtectionSnapshot([
      createUnit('front', { position: Position.Front1, ...frontOverrides }),
      createUnit('back', { position: Position.Back1 }),
    ], [unitId('back')])

    expect(getPositionProtectionReduction(snapshot, unitId('back'))).toBe(expected)
  })

  it('does not depend on target iteration order', () => {
    const units = [
      createUnit('front', { position: Position.Front1 }),
      createUnit('back', { position: Position.Back1 }),
    ]
    const first = createPositionProtectionSnapshot(units, [
      unitId('front'),
      unitId('back'),
    ])
    const reversed = createPositionProtectionSnapshot(units, [
      unitId('back'),
      unitId('front'),
    ])

    expect(getPositionProtectionReduction(first, unitId('back'))).toBe(0.5)
    expect(getPositionProtectionReduction(reversed, unitId('back'))).toBe(0.5)
  })
})
