import { describe, expect, it } from 'vitest'
import { checkBattleCompletion } from '../game/core/battleEngine'
import { Camp, Position } from '../game/core/enums'
import { createBattleState, createUnit, unitId } from './battleTestUtils'

function defeatedEnemy(id: string) {
  return createUnit(id, {
    camp: Camp.Enemy,
    position: Position.EnemyCenter,
    currentHealth: 0,
    alive: false,
  })
}

describe('ordinary multi-unit battle completion', () => {
  it('wins only after every enemy is defeated', () => {
    const state = createBattleState([
      createUnit('player'),
      defeatedEnemy('first'),
      createUnit('second', { camp: Camp.Enemy, position: Position.EnemyUpper }),
    ])
    expect(checkBattleCompletion(state).state.phase).not.toBe('finished')
    const allDefeated = {
      ...state,
      units: state.units.map((unit) => (
        unit.id === unitId('second')
          ? { ...unit, currentHealth: 0, alive: false }
          : unit
      )),
    }
    const result = checkBattleCompletion(allDefeated)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state).toMatchObject({
      phase: 'finished',
      outcome: 'playerVictory',
    })
    expect(result.events).toEqual([{
      type: 'BATTLE_FINISHED',
      outcome: 'playerVictory',
      reason: 'ALL_ENEMY_UNITS_DEFEATED',
    }])
  })

  it('does not win while a living enemy is temporarily off field', () => {
    const reserve = createUnit('reserve', {
      camp: Camp.Enemy,
      position: Position.EnemyLower,
    })
    const state = {
      ...createBattleState([createUnit('player'), defeatedEnemy('active')]),
      offFieldUnits: [{ unit: reserve, statusBatches: [] }],
    }
    expect(checkBattleCompletion(state)).toMatchObject({
      ok: true,
      state: { phase: 'setup' },
      events: [],
    })
  })

  it('loses after multiple player deaths even if enemies remain', () => {
    const state = createBattleState([
      createUnit('player-1', { currentHealth: 0, alive: false }),
      createUnit('player-2', { currentHealth: 0, alive: false }),
      createUnit('enemy', { camp: Camp.Enemy, position: Position.EnemyCenter }),
    ])
    const result = checkBattleCompletion(state)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.outcome).toBe('playerDefeat')
    expect(result.events).toEqual([expect.objectContaining({
      type: 'BATTLE_FINISHED',
      reason: 'ALL_PLAYER_UNITS_DEFEATED',
    })])
  })
})
