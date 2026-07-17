import { describe, expect, it } from 'vitest'
import {
  getPendingExecutionLifecycle,
  resolveImmediateTriggerChain,
  selectPostActionContinuation,
  sortByAcquisitionOrder,
  takeDelayedEffects,
  takeNextPendingExecution,
} from '../game/core/effectScheduler'
import type {
  DelayedEffect,
  PendingExecution,
} from '../game/core/effectScheduler'
import { createUnit, unitId } from './battleTestUtils'

describe('generic effect scheduler', () => {
  it('sorts same-stage effects by acquisition time and preserves exact ties', () => {
    expect(sortByAcquisitionOrder([
      { id: 'later', acquisitionOrder: 2 },
      { id: 'tie-a', acquisitionOrder: 1 },
      { id: 'tie-b', acquisitionOrder: 1 },
    ]).map((effect) => effect.id)).toEqual(['tie-a', 'tie-b', 'later'])
  })

  it('resolves newly produced triggers depth first before sibling triggers', () => {
    const children: Record<string, readonly string[]> = {
      rootA: ['childA1', 'childA2'],
      childA1: ['grandchildA'],
      rootB: [],
      childA2: [],
      grandchildA: [],
    }
    const triggers = (children.rootA ?? []).length
    const result = resolveImmediateTriggerChain(
      [] as string[],
      [
        { id: 'rootB', acquisitionOrder: 2 },
        { id: 'rootA', acquisitionOrder: 1 },
      ],
      (state, trigger) => ({
        state: [...state, trigger.id],
        triggers: (children[trigger.id] ?? []).map((id, index) => ({
          id,
          acquisitionOrder: index,
        })),
      }),
    )

    expect(triggers).toBe(2)
    expect(result.state).toEqual([
      'rootA',
      'childA1',
      'grandchildA',
      'childA2',
      'rootB',
    ])
  })

  it('takes only due delayed effects in acquisition order', () => {
    const queue: readonly DelayedEffect<string>[] = [
      {
        effectId: 'later', timing: 'turnStart', ownerUnitId: unitId('owner'),
        acquisitionOrder: 3, payload: 'later',
      },
      {
        effectId: 'other', timing: 'turnEnd', ownerUnitId: unitId('owner'),
        acquisitionOrder: 1, payload: 'other',
      },
      {
        effectId: 'earlier', timing: 'turnStart', ownerUnitId: unitId('owner'),
        acquisitionOrder: 2, payload: 'earlier',
      },
    ]
    const result = takeDelayedEffects(queue, 'turnStart', unitId('owner'))

    expect(result.due.map((effect) => effect.effectId))
      .toEqual(['earlier', 'later'])
    expect(result.remaining.map((effect) => effect.effectId)).toEqual(['other'])
  })

  it('keeps a same-id delayed effect when only another timing is due', () => {
    const queue: readonly DelayedEffect<string>[] = [
      {
        effectId: 'shared', timing: 'turnStart', ownerUnitId: unitId('owner'),
        acquisitionOrder: 1, payload: 'due',
      },
      {
        effectId: 'shared', timing: 'turnEnd', ownerUnitId: unitId('owner'),
        acquisitionOrder: 2, payload: 'remaining',
      },
    ]
    const result = takeDelayedEffects(queue, 'turnStart', unitId('owner'))

    expect(result.due.map((effect) => effect.payload)).toEqual(['due'])
    expect(result.remaining.map((effect) => effect.payload))
      .toEqual(['remaining'])
  })

  it('cancels a fixed-target chain when the target is no longer alive', () => {
    const queue: readonly PendingExecution<string>[] = [
      {
        executionId: 'repeat-1', chainId: 'repeat', kind: 'repeatAction',
        actorId: unitId('actor'), fixedTargetId: unitId('dead'),
        acquisitionOrder: 1, payload: 'first',
      },
      {
        executionId: 'other', chainId: 'other', kind: 'extraAction',
        actorId: unitId('actor'), fixedTargetId: null,
        acquisitionOrder: 2, payload: 'other',
      },
      {
        executionId: 'repeat-2', chainId: 'repeat', kind: 'repeatAction',
        actorId: unitId('actor'), fixedTargetId: unitId('dead'),
        acquisitionOrder: 3, payload: 'second',
      },
    ]
    const result = takeNextPendingExecution(queue, [
      createUnit('actor'),
      createUnit('dead', { alive: false, currentHealth: 0 }),
    ])

    expect(result.execution?.executionId).toBe('other')
    expect(result.cancelled.map((execution) => execution.executionId))
      .toEqual(['repeat-1', 'repeat-2'])
  })

  it('keeps extra actions distinct from full extra turns', () => {
    expect(getPendingExecutionLifecycle('extraAction')).toEqual({
      startsPersonalTurn: false,
      countsAsAction: true,
    })
    expect(getPendingExecutionLifecycle('repeatAction')).toEqual({
      startsPersonalTurn: false,
      countsAsAction: true,
    })
    expect(getPendingExecutionLifecycle('extraTurn')).toEqual({
      startsPersonalTurn: true,
      countsAsAction: false,
    })
  })

  it('enforces stop, after-action, transition, pending, and turn boundaries', () => {
    const base = {
      battleEnded: false,
      actorEligibleForAfterAction: true,
      afterActionCompleted: false,
      phaseTransitionPending: true,
      hasPendingExecution: true,
      turnShouldEnd: true,
    }
    expect(selectPostActionContinuation({ ...base, battleEnded: true }))
      .toBe('battleEnded')
    expect(selectPostActionContinuation(base)).toBe('afterAction')
    expect(selectPostActionContinuation({ ...base, afterActionCompleted: true }))
      .toBe('phaseTransition')
    expect(selectPostActionContinuation({
      ...base, afterActionCompleted: true, phaseTransitionPending: false,
    })).toBe('pendingExecution')
    expect(selectPostActionContinuation({
      ...base,
      afterActionCompleted: true,
      phaseTransitionPending: false,
      hasPendingExecution: false,
    })).toBe('turnEnd')
  })
})
