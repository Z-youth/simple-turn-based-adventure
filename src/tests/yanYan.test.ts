import { describe, expect, it } from 'vitest'
import {
  completeBattleAction,
  requestPlayerEndTurn,
  startBattleAction,
  startBattleSequence,
} from '../game/core/battleEngine'
import type { BattleEngineExtensions } from '../game/core/battleEngine'
import { Camp, DamageType, UnitSystem } from '../game/core/enums'
import type {
  ActionId,
  AttackId,
  DamageEventId,
  ResourceTransactionId,
  SkillExecutionId,
} from '../game/core/identifiers'
import { resolveResourcePaidSkillTransaction } from '../game/core/resourceTransaction'
import type { UnitState } from '../game/core/units'
import { GAME_CONTENT_BATTLE_EXTENSIONS } from '../game/content/battleExtensions'
import { createWangDahai } from '../game/content/characters/wangDahai'
import {
  createYanYan,
  useYanYanBaiyueSkill,
  useYanYanFirstSkill,
  useYanYanPeaksSkill,
  useYanYanRidgesSkill,
  YAN_YAN_BAIYUE_RESTORE_COUNTER_ID,
  YAN_YAN_BATTLE_EXTENSIONS,
  YAN_YAN_UNIT_ID,
} from '../game/content/characters/yanYan'
import { createBattleState, createUnit, unitId } from './battleTestUtils'

const WITHOUT_YAN_YAN_TURN_END: BattleEngineExtensions = {
  applyTurnStartPreSystemEffects: YAN_YAN_BATTLE_EXTENSIONS.applyTurnStartPreSystemEffects,
  applyAfterActionEffects: YAN_YAN_BATTLE_EXTENSIONS.applyAfterActionEffects,
}

function yan(overrides: Partial<UnitState> = {}) {
  return { ...createYanYan(), ...overrides }
}

function setupYanTurn(
  yanOverrides: Partial<UnitState> = {},
  allies: readonly UnitState[] = [],
  enemyOverrides: Partial<UnitState> = {},
  extensions: BattleEngineExtensions = YAN_YAN_BATTLE_EXTENSIONS,
) {
  const state = createBattleState([
    yan({ speed: 300, ...yanOverrides }),
    ...allies,
    createUnit('enemy', { camp: Camp.Enemy, speed: 1, ...enemyOverrides }),
  ])
  const started = startBattleSequence(state, extensions)
  if (!started.ok) throw new Error(started.reason)
  return started.state
}

function singleTargetRequest(name: string) {
  return {
    targetUnitId: unitId('enemy'),
    actionId: `action:${name}` as ActionId,
    skillExecutionId: `skill:${name}` as SkillExecutionId,
    attackId: `attack:${name}` as AttackId,
    damageEventId: `damage:${name}` as DamageEventId,
    resourceTransactionId: `resource:${name}` as ResourceTransactionId,
  }
}

describe('Yan Yan', () => {
  it('creates the specified base attributes', () => {
    expect(createYanYan()).toMatchObject({
      id: YAN_YAN_UNIT_ID,
      name: '严岩',
      maximumHealth: 180,
      currentHealth: 180,
      baseAttackAtBattleEntry: 10,
      speed: 85,
      system: UnitSystem.Momentum,
    })
  })

  it('resolves 镇山岳 in specification order and shares its shield with Wang Dahai', () => {
    const wang = { ...createWangDahai(), speed: 200 }
    const result = useYanYanFirstSkill(
      setupYanTurn({}, [wang], {}, WITHOUT_YAN_YAN_TURN_END),
      singleTargetRequest('first'),
      WITHOUT_YAN_YAN_TURN_END,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === YAN_YAN_UNIT_ID))
      .toMatchObject({ energy: 1, momentum: 2, shield: 12 })
    expect(result.state.units.find((unit) => unit.id === wang.id)?.shield).toBe(2)
    expect(result.state.units.find((unit) => unit.id === unitId('enemy'))?.currentHealth)
      .toBe(90.4)
  })

  it('only gains Guard Stance momentum once for a multi-hit skill, including fully absorbed damage and excluding extra damage', () => {
    const enemy = createUnit('enemy', { camp: Camp.Enemy, speed: 300 })
    const initial = createBattleState([
      yan({ shield: 100, speed: 1 }),
      enemy,
    ])
    const startedTurn = startBattleSequence(initial, GAME_CONTENT_BATTLE_EXTENSIONS)
    expect(startedTurn.ok).toBe(true)
    if (!startedTurn.ok) return
    const actionId = 'action:guard' as ActionId
    const skillExecutionId = 'skill:guard' as SkillExecutionId
    const startedAction = startBattleAction(startedTurn.state, {
      actionId,
      actorId: enemy.id,
      skillExecutionId,
      countsAsAction: true,
      endsTurn: false,
    })
    expect(startedAction.ok).toBe(true)
    if (!startedAction.ok || startedAction.state.personalTurn === null
      || startedAction.state.activeAction === null) return
    const attack = {
      attackId: 'attack:guard' as AttackId,
      damageType: DamageType.Normal,
      effectiveAttack: 10,
      multiplier: 1,
      fixedDamage: 0,
      criticalRate: 0,
      criticalDamage: 0.5,
      normalDamageIncrease: 0,
      targets: [{
        targetId: YAN_YAN_UNIT_ID,
        damageEventId: 'damage:guard' as DamageEventId,
        extraDamage: {
          damageEventId: 'damage:guard:extra' as DamageEventId,
          value: 5,
        },
      }],
    } as const
    const resolved = resolveResourcePaidSkillTransaction(startedAction.state, {
      resourceTransactionId: 'resource:guard' as ResourceTransactionId,
      actionId,
      personalTurnId: startedAction.state.personalTurn.personalTurnId,
      sequenceId: startedAction.state.activeAction.sequenceId,
      skillExecutionId,
      payerUnitId: enemy.id,
      costs: [],
    }, {
      skillExecutionId,
      skillId: 'skill:guard' as import('../game/core/identifiers').SkillId,
      actionId,
      personalTurnId: startedAction.state.personalTurn.personalTurnId,
      sequenceId: startedAction.state.activeAction.sequenceId,
      casterId: enemy.id,
      attacks: [attack, {
        ...attack,
        attackId: 'attack:guard:second' as AttackId,
        targets: [{
          targetId: YAN_YAN_UNIT_ID,
          damageEventId: 'damage:guard:second' as DamageEventId,
        }],
      }],
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    const completed = completeBattleAction(
      resolved.state,
      actionId,
      GAME_CONTENT_BATTLE_EXTENSIONS,
    )
    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.state.units.find((unit) => unit.id === YAN_YAN_UNIT_ID))
      .toMatchObject({ momentum: 2, currentHealth: 175, shield: 80 })
    expect(completed.events.filter((event) => (
      event.type === 'RESOURCE_GAINED' && event.reason === 'yanYanGuardStance'
    ))).toHaveLength(1)
  })

  it('gives every ally two shields from 峰峦起 while Yan Yan receives one', () => {
    const wang = { ...createWangDahai(), speed: 200 }
    const state = setupYanTurn({ momentum: 5 }, [wang], {}, WITHOUT_YAN_YAN_TURN_END)
    const result = useYanYanPeaksSkill(state, {
      actionId: 'action:peaks' as ActionId,
      skillExecutionId: 'skill:peaks' as SkillExecutionId,
      resourceTransactionId: 'resource:peaks' as ResourceTransactionId,
    }, WITHOUT_YAN_YAN_TURN_END)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === YAN_YAN_UNIT_ID))
      .toMatchObject({ momentum: 8, shield: 8 })
    expect(result.state.units.find((unit) => unit.id === wang.id)?.shield).toBe(16)
  })

  it('pays 层峦叠嶂 after its effects, then applies the payment shield using pre-payment momentum', () => {
    const wang = { ...createWangDahai(), speed: 200 }
    const result = useYanYanRidgesSkill(
      setupYanTurn(
        { energy: 1, momentum: 5 },
        [wang],
        { momentum: 6, currentHealth: 200, maximumHealth: 200 },
        WITHOUT_YAN_YAN_TURN_END,
      ),
      singleTargetRequest('ridges'),
      WITHOUT_YAN_YAN_TURN_END,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === YAN_YAN_UNIT_ID))
      .toMatchObject({ energy: 0, momentum: 0, shield: 15 })
    expect(result.state.units.find((unit) => unit.id === wang.id)?.shield).toBe(5)
    expect(result.state.units.find((unit) => unit.id === unitId('enemy'))?.momentum).toBe(2)
  })

  it('uses both Baiyue damage stages, preserves its own shield, shares pre-payment momentum, and restores momentum before pressure', () => {
    const wang = { ...createWangDahai(), speed: 200 }
    const state = setupYanTurn(
      { momentum: 5, shield: 12 },
      [wang],
      { shield: 8, currentHealth: 100, maximumHealth: 100 },
      WITHOUT_YAN_YAN_TURN_END,
    )
    const result = useYanYanBaiyueSkill(state, {
      actionId: 'action:baiyue' as ActionId,
      skillExecutionId: 'skill:baiyue' as SkillExecutionId,
      normalAttackId: 'attack:baiyue:normal' as AttackId,
      shieldAttackId: 'attack:baiyue:shield' as AttackId,
      resourceTransactionId: 'resource:baiyue' as ResourceTransactionId,
    }, WITHOUT_YAN_YAN_TURN_END)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.units.find((unit) => unit.id === YAN_YAN_UNIT_ID))
      .toMatchObject({ momentum: 0, shield: 27 })
    expect(result.state.units.find((unit) => unit.id === wang.id)?.shield).toBe(5)
    expect(result.state.units.find((unit) => unit.id === unitId('enemy')))
      .toMatchObject({ currentHealth: 78.5, shield: 0 })
    expect(result.events.filter((event) => (
      event.type === 'DAMAGE_CALCULATED' && event.damage.damageType === 'shieldValue'
    ))).toHaveLength(1)

    let continued = result.state
    for (const name of ['wang-end', 'enemy-end']) {
      const currentTurn = continued.personalTurn
      expect(currentTurn).not.toBeNull()
      if (currentTurn === null) return
      const actionId = `action:${name}` as ActionId
      const action = startBattleAction(continued, {
        actionId,
        actorId: currentTurn.unitId,
        endsTurn: true,
      })
      expect(action.ok).toBe(true)
      if (!action.ok) return
      const completed = completeBattleAction(
        action.state,
        actionId,
        WITHOUT_YAN_YAN_TURN_END,
      )
      expect(completed.ok).toBe(true)
      if (!completed.ok) return
      continued = completed.state
    }
    const advanced = { ok: true as const, state: continued }
    expect(advanced.ok).toBe(true)
    if (!advanced.ok) return
    const restored = advanced.state.units.find((unit) => unit.id === YAN_YAN_UNIT_ID)
    expect(restored).toMatchObject({ momentum: 3, momentumPressure: 0 })
    expect(restored?.specialCounters.find((counter) => (
      counter.counterId === YAN_YAN_BAIYUE_RESTORE_COUNTER_ID
    ))?.value ?? 0).toBe(0)
  })

  it('grants the turn-end shield to Yan Yan and Wang Dahai', () => {
    const wang = { ...createWangDahai(), speed: 200 }
    const state = setupYanTurn({ momentum: 4 }, [wang])
    const ended = requestPlayerEndTurn(state, {
      hasLegalAction: false,
    }, YAN_YAN_BATTLE_EXTENSIONS)

    expect(ended.status).toBe('turnEnded')
    expect(ended.state.units.find((unit) => unit.id === YAN_YAN_UNIT_ID)?.shield).toBe(8)
    expect(ended.state.units.find((unit) => unit.id === wang.id)?.shield).toBe(4)
  })
})
