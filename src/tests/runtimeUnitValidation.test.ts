import { describe, expect, it } from 'vitest'
import { beginAction, finishAction } from '../game/core/actionLifecycle'
import {
  resolveBattleSkill,
  startBattleAction,
} from '../game/core/battleEngine'
import type {
  ActionId,
  ResourceTransactionId,
} from '../game/core/identifiers'
import { BattlePhase, Camp, PersonalTurnPhase } from '../game/core/enums'
import type { BattleState } from '../game/core/contexts'
import { resolveSkillTransaction } from '../game/core/resolutionTransaction'
import { resolveResourcePaidSkillTransaction } from '../game/core/resourceTransaction'
import { recalculateMomentumPressure } from '../game/core/momentumPressure'
import { createTurnQueue } from '../game/core/turnOrder'
import {
  advanceTurnEndStage,
  advanceTurnStartStage,
  beginPersonalTurnEnd,
  finishPersonalTurn,
  startPersonalTurn,
} from '../game/core/turnLifecycle'
import { createResolvingState, skillRequest } from './combatTestUtils'
import { createUnit, unitId } from './battleTestUtils'

const invalidBaseAttacks = [
  0,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
] as const

function createRuntimeFixture(baseAttackAtBattleEntry: number) {
  const validState = createResolvingState([
    createUnit('actor'),
    createUnit('target', { camp: Camp.Enemy, position: null }),
  ])
  const invalidActor = {
    ...validState.units[0],
    baseAttackAtBattleEntry,
  }
  const units = [invalidActor, validState.units[1]]
  const turnSequence = validState.turnSequence
  const resolvingTurn = validState.personalTurn
  if (turnSequence === null || resolvingTurn === null) {
    throw new Error('Runtime validation fixture has no active turn')
  }
  const awaitingTurn = {
    ...resolvingTurn,
    phase: PersonalTurnPhase.AwaitingAction,
  }
  const awaitingState = {
    ...validState,
    phase: BattlePhase.AwaitingAction,
    units,
    personalTurn: awaitingTurn,
    activeAction: null,
    activeSkill: null,
    completedSkillResolution: null,
    completedResourcePayment: null,
    actionRollbackState: null,
  }
  const resolvingState = { ...validState, units }
  return {
    awaitingState,
    awaitingTurn,
    resolvingState,
    resolvingTurn,
    turnSequence,
    units,
  }
}

function expectUnchangedState(
  result: { readonly state: BattleState; readonly events: readonly unknown[] },
  state: BattleState,
) {
  expect(result.state).toBe(state)
  expect(result.events).toEqual([])
  expect(result.state.events).toBe(state.events)
  expect(result.state.rngState).toBe(state.rngState)
}

describe('runtime unit base-attack validation', () => {
  it.each(invalidBaseAttacks)(
    'rejects base attack %s at every independently callable start boundary',
    (baseAttackAtBattleEntry) => {
      const fixture = createRuntimeFixture(baseAttackAtBattleEntry)

      const queue = createTurnQueue(fixture.units)
      expect(queue).toEqual({
        ok: false,
        queue: [],
        reason: 'INVALID_UNIT_BASE_ATTACK',
      })

      const turn = startPersonalTurn(
        fixture.turnSequence,
        unitId('actor'),
        fixture.units,
      )
      expect(turn).toEqual({
        ok: false,
        reason: 'INVALID_UNIT_BASE_ATTACK',
      })

      const action = beginAction(fixture.awaitingTurn, {
        actionId: 'action:direct-invalid' as ActionId,
        actorId: unitId('actor'),
      }, fixture.units)
      expect(action).toEqual({
        ok: false,
        reason: 'INVALID_UNIT_BASE_ATTACK',
      })

      const engine = startBattleAction(fixture.awaitingState, {
        actionId: 'action:engine-invalid' as ActionId,
        actorId: unitId('actor'),
      })
      expect(engine.ok).toBe(false)
      if (!engine.ok) {
        expect(engine.reason).toBe('INVALID_UNIT_BASE_ATTACK')
        expectUnchangedState(engine, fixture.awaitingState)
      }
      expect(fixture.awaitingState.turnSequence).toBe(fixture.turnSequence)
      expect(fixture.awaitingState.personalTurn).toBe(fixture.awaitingTurn)
      expect(fixture.awaitingState.activeAction).toBeNull()
      expect(fixture.awaitingState.activeSkill).toBeNull()
      expect(fixture.awaitingState.phase).toBe(BattlePhase.AwaitingAction)

      const request = skillRequest(fixture.resolvingState, [])
      const directSkill = resolveSkillTransaction(
        fixture.resolvingState,
        request,
      )
      expect(directSkill.ok).toBe(false)
      if (!directSkill.ok) {
        expect(directSkill.reason).toBe('INVALID_UNIT_BASE_ATTACK')
        expectUnchangedState(directSkill, fixture.resolvingState)
      }

      const engineSkill = resolveBattleSkill(
        fixture.resolvingState,
        request,
      )
      expect(engineSkill.ok).toBe(false)
      if (!engineSkill.ok) {
        expect(engineSkill.reason).toBe('INVALID_UNIT_BASE_ATTACK')
        expectUnchangedState(engineSkill, fixture.resolvingState)
      }
      expect(fixture.resolvingState.activeSkill).toBeNull()
      expect(fixture.resolvingState.rngState).toBe(
        fixture.awaitingState.rngState,
      )

      const paidSkill = resolveResourcePaidSkillTransaction(
        fixture.resolvingState,
        {
          resourceTransactionId: 'resource:invalid-unit' as ResourceTransactionId,
          actionId: request.actionId,
          personalTurnId: request.personalTurnId,
          sequenceId: request.sequenceId,
          skillExecutionId: request.skillExecutionId,
          payerUnitId: request.casterId,
          costs: [],
        },
        request,
      )
      expect(paidSkill.ok).toBe(false)
      if (!paidSkill.ok) {
        expect(paidSkill.reason).toBe('INVALID_UNIT_BASE_ATTACK')
        expectUnchangedState(paidSkill, fixture.resolvingState)
      }

      const pressureTurn = {
        ...fixture.awaitingTurn,
        phase: PersonalTurnPhase.StartingSystemRules,
      }
      const pressureState = {
        ...fixture.awaitingState,
        phase: BattlePhase.TurnStart,
        personalTurn: pressureTurn,
      }
      const pressure = recalculateMomentumPressure(
        pressureState,
        unitId('actor'),
        pressureTurn,
      )
      expect(pressure.ok).toBe(false)
      if (!pressure.ok) {
        expect(pressure.reason).toBe('INVALID_UNIT_BASE_ATTACK')
        expectUnchangedState(pressure, pressureState)
      }
    },
  )

  it('checks every unit, not only the current actor or skill caster', () => {
    const fixture = createRuntimeFixture(10)
    const units = fixture.units.map((unit) => unit.id === unitId('target')
      ? { ...unit, baseAttackAtBattleEntry: 0 }
      : unit)
    const state = { ...fixture.awaitingState, units }

    const result = startBattleAction(state, {
      actionId: 'action:invalid-other-unit' as ActionId,
      actorId: unitId('actor'),
    })

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'INVALID_UNIT_BASE_ATTACK',
    })
    expect(result.state.events).toBe(state.events)
    expect(result.state.rngState).toBe(state.rngState)
  })

  it('rejects low-level turn and action progression before phase changes', () => {
    const fixture = createRuntimeFixture(0)
    const activeAction = fixture.resolvingState.activeAction
    if (activeAction === null) throw new Error('Fixture has no active action')
    const failures = [
      advanceTurnStartStage(fixture.awaitingTurn, fixture.units),
      beginPersonalTurnEnd(fixture.awaitingTurn, true, fixture.units),
      advanceTurnEndStage(fixture.awaitingTurn, fixture.units),
      finishPersonalTurn(fixture.awaitingTurn, true, fixture.units),
      finishAction(
        fixture.resolvingTurn,
        activeAction,
        activeAction.actionId,
        fixture.units,
      ),
    ]

    for (const result of failures) {
      expect(result).toEqual({
        ok: false,
        reason: 'INVALID_UNIT_BASE_ATTACK',
      })
    }
    expect(fixture.awaitingTurn.phase).toBe(PersonalTurnPhase.AwaitingAction)
    expect(fixture.resolvingTurn.phase).toBe(PersonalTurnPhase.ResolvingAction)
  })
})
