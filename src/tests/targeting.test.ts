import { describe, expect, it } from 'vitest'
import { Camp, Position } from '../game/core/enums'
import { createFixedSequenceRandomState } from '../game/core/rng'
import {
  chooseFrontPriorityRandomTarget,
  chooseRandomLivingLegalTarget,
  getAllLivingLegalTargets,
} from '../game/core/targeting'
import { createBattleState, createUnit, unitId } from './battleTestUtils'

describe('multi-unit target pools', () => {
  it('returns only living legal group targets', () => {
    const state = createBattleState([
      createUnit('living-enemy', { camp: Camp.Enemy, position: Position.EnemyCenter }),
      createUnit('dead-enemy', {
        camp: Camp.Enemy,
        position: Position.EnemyUpper,
        currentHealth: 0,
        alive: false,
      }),
      createUnit('excluded-enemy', { camp: Camp.Enemy, position: Position.EnemyLower }),
      createUnit('player'),
    ])
    const targets = getAllLivingLegalTargets(state, {
      camp: Camp.Enemy,
      excludeUnitIds: [unitId('excluded-enemy')],
    })
    expect(targets.map((unit) => unit.id)).toEqual([unitId('living-enemy')])
  })

  it('uses fixed RNG reproducibly for random targets', () => {
    const state = {
      ...createBattleState([
        createUnit('first', { camp: Camp.Enemy }),
        createUnit('second', { camp: Camp.Enemy }),
        createUnit('third', { camp: Camp.Enemy }),
      ]),
      rngState: createFixedSequenceRandomState([0.6]),
    }
    const selected = chooseRandomLivingLegalTarget(state, { camp: Camp.Enemy })
    expect(selected.target?.id).toBe(unitId('second'))
    expect(selected.state.rngState.cursor).toBe(1)
  })

  it('selects randomly from living front units before back units', () => {
    const state = {
      ...createBattleState([
        createUnit('front-1', { position: Position.Front1 }),
        createUnit('front-2', { position: Position.Front2 }),
        createUnit('back', { position: Position.Back1 }),
      ]),
      rngState: createFixedSequenceRandomState([0.9]),
    }
    const selected = chooseFrontPriorityRandomTarget(state, { camp: Camp.Player })
    expect(selected.target?.id).toBe(unitId('front-2'))
  })
})
