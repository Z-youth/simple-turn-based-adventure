import { describe, expect, it } from 'vitest'
import type { BattleEngineExtensions } from '../game/core/battleEngine'
import { startBattleSequence, startTrainingBattle } from '../game/core/battleEngine'
import { Camp, Position } from '../game/core/enums'
import { gainResource, ResourceType } from '../game/core/resources'
import { createBattleState, createUnit, unitId } from './battleTestUtils'

describe('battle start effects', () => {
  it('runs all turn-start insertion points in the specified order', () => {
    const calls: string[] = []
    const pass = (name: string) => (state: Parameters<
      NonNullable<BattleEngineExtensions['applyUnitPassiveEffects']>
    >[0]) => {
      calls.push(name)
      return { ok: true as const, state, events: [] }
    }
    const result = startBattleSequence(
      createBattleState([createUnit('actor')]),
      {
        applyTurnStartAbsoluteEffects: pass('absolute'),
        resetUnitTurnCounters: pass('reset'),
        applyTurnStartPreSystemEffects: pass('delayed'),
        applyUnitPassiveEffects: pass('passive'),
        applyTurnStartPostSystemEffects: pass('postSystem'),
        applyTurnStartForcedChoices: pass('forcedChoice'),
      },
    )

    expect(result.ok).toBe(true)
    expect(calls).toEqual([
      'absolute',
      'reset',
      'delayed',
      'passive',
      'postSystem',
      'forcedChoice',
    ])
  })

  it('uses speed and same-speed rules before the first sequence snapshot', () => {
    const calls: string[] = []
    const extensions: BattleEngineExtensions = {
      applyUnitBattleStartEffects(state, currentUnitId) {
        calls.push(String(currentUnitId))
        const units = currentUnitId === unitId('front2')
          ? state.units.map((unit) => unit.id === currentUnitId
              ? { ...unit, speed: 200 }
              : unit)
          : state.units
        return { ok: true, state: { ...state, units }, events: [] }
      },
    }
    const result = startTrainingBattle(createBattleState([
      createUnit('enemy', {
        camp: Camp.Enemy,
        isBoss: true,
        position: null,
        speed: 100,
        deploymentOrder: 0,
      }),
      createUnit('front2', { position: Position.Front2, speed: 100 }),
      createUnit('front1', { position: Position.Front1, speed: 100 }),
    ]), extensions)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(calls).toEqual(['front1', 'front2', 'enemy'])
    expect(result.state.turnSequence?.queue.map((entry) => entry.unitId))
      .toEqual([unitId('front2'), unitId('front1'), unitId('enemy')])
    expect(result.state.personalTurn?.unitId).toBe(unitId('front2'))
  })

  it('rolls all battle-start changes back when a later effect fails', () => {
    const initial = createBattleState([
      createUnit('first', { speed: 120, energy: 1 }),
      createUnit('second', { speed: 100, position: Position.Front2 }),
    ])
    const extensions: BattleEngineExtensions = {
      applyUnitBattleStartEffects(state, currentUnitId) {
        if (currentUnitId === unitId('second')) {
          return {
            ok: false,
            state,
            events: [],
            reason: 'TEST_BATTLE_START_FAILURE',
          }
        }
        return gainResource(state, {
          unitId: currentUnitId,
          resourceType: ResourceType.Energy,
          amount: 3,
          reason: 'testBattleStart',
          sourceId: null,
          actionId: null,
          personalTurnId: null,
          sequenceId: null,
          skillExecutionId: null,
          resourceTransactionId: null,
        })
      },
    }
    const result = startTrainingBattle(initial, extensions)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('TEST_BATTLE_START_FAILURE')
    expect(result.state).toBe(initial)
    expect(result.state.units[0].energy).toBe(1)
    expect(result.state.events).toEqual([])
  })
})
