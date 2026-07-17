import { describe, expect, it } from 'vitest'
import {
  endUiPlayerTurn,
  getUiBattleActions,
  getUiBattleEvents,
  getUiUnitDetails,
  executeUiBattleAction,
  startUiTrainingBattle,
  UI_CHARACTER_DEFINITIONS,
} from '../game/ui/battleUiAdapter'
import {
  getLiunianTotalMomentum,
  LIUNIAN_UNIT_ID,
} from '../game/content/characters/liunian'
import { Position } from '../game/core/enums'
import { createFixedSequenceRandomState } from '../game/core/rng'

describe('Liunian UI adapter', () => {
  it('registers Liunian as a selectable training character', () => {
    expect(UI_CHARACTER_DEFINITIONS).toContainEqual(expect.objectContaining({
      key: 'liunian',
      unitId: LIUNIAN_UNIT_ID,
      name: '流年',
    }))
    const started = startUiTrainingBattle({
      characterKeys: ['liunian'],
      positions: { liunian: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 3)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const unit = started.state.units.find((candidate) => candidate.id === LIUNIAN_UNIT_ID)
    expect(unit === undefined ? 0 : getLiunianTotalMomentum(unit)).toBe(6)
  })

  it.each([
    ['wangDahai', Position.Front1],
    ['yanYan', Position.Front2],
    ['liMutou', Position.Back1],
  ] as const)('starts a stable training team with %s', (key, position) => {
    const started = startUiTrainingBattle({
      characterKeys: ['liunian', key],
      positions: { liunian: Position.Back2, [key]: position },
      bossKey: 'trainingDummy',
    }, 7)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    expect(started.state.units.filter((unit) => unit.camp === 'player'))
      .toHaveLength(2)
  })

  it('shows flow, domain and merged momentum without exposing borrowed layers separately', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['liunian'],
      positions: { liunian: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 3)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const details = getUiUnitDetails(started.state, LIUNIAN_UNIT_ID)
    expect(details?.commonFields).toContainEqual({ label: '势', value: 6 })
    expect(details?.commonFields).toContainEqual({ label: '当前攻击', value: 10 })
    expect(details?.exclusiveFields).toEqual(expect.arrayContaining([
      { label: '流', value: 0 },
      { label: '三生流转', value: '未开启' },
      { label: '流转', value: 0 },
    ]))
    expect(details?.exclusiveFields.some((field) => field.label === '借来势'))
      .toBe(false)
  })

  it('runs Fengshui through the registered after-action listener for a real ally skill', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['liunian', 'wangDahai'],
      positions: { liunian: Position.Back2, wangDahai: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 3)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const handedOff = endUiPlayerTurn(started.state)
    expect(handedOff.ok).toBe(true)
    if (!handedOff.ok) return
    expect(handedOff.state.personalTurn?.unitId).not.toBe(LIUNIAN_UNIT_ID)
    const deterministic = {
      ...handedOff.state,
      rngState: createFixedSequenceRandomState([
        0.49,
        ...Array.from({ length: 15 }, () => 0.9),
      ]),
    }
    const acted = executeUiBattleAction(
      deterministic,
      'wangDahai.newTide',
      1,
    )
    expect(acted.ok, acted.ok ? '' : acted.reason).toBe(true)
    if (!acted.ok) return
    const liunian = acted.state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)
    expect(liunian === undefined ? 0 : getLiunianTotalMomentum(liunian)).toBe(7)
    expect(acted.state.events).toContainEqual(expect.objectContaining({
      type: 'RESOURCE_GAINED',
      unitId: LIUNIAN_UNIT_ID,
      resourceType: 'momentum',
      amount: 1,
      reason: 'liunianFengshui',
    }))
    expect(getUiBattleEvents(acted.state).some((event) => (
      event.text.includes('流年') && event.text.includes('1点势')
    ))).toBe(true)
  })

  it('shows Kanyu and Dingxue before the domain with exact skill details', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['liunian'],
      positions: { liunian: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 3)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const actions = getUiBattleActions(started.state)
    expect(actions.map((action) => action.label)).toEqual(expect.arrayContaining([
      '堪舆',
      '定穴',
      '三生流转',
      '生生流变',
    ]))
    expect(actions.map((action) => action.label)).not.toContain('北山风起')
    expect(actions.find((action) => action.label === '定穴')?.effectDetails)
      .toContain('资源顺序：获得1能量 → 2势 → 1流')
  })

  it('replaces the first skill with North Wind and South Water in the domain', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['liunian'],
      positions: { liunian: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 3)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const funded = {
      ...started.state,
      units: started.state.units.map((unit) => unit.id === LIUNIAN_UNIT_ID
        ? { ...unit, energy: 1 }
        : unit),
    }
    const opened = executeUiBattleAction(funded, 'liunian.domain', 1)
    expect(opened.ok).toBe(true)
    const domainActions = getUiBattleActions(opened.state)
    const labels = domainActions.map((action) => action.label)
    expect(labels).toEqual(expect.arrayContaining(['北山风起', '南阳水来']))
    expect(labels).not.toEqual(expect.arrayContaining(['堪舆', '定穴']))
    const northWind = domainActions.find((action) => action.label === '北山风起')
    expect(northWind?.detail).toContain('获得1能量、3势、3流')
    expect(northWind?.effectDetails).toContain(
      '每次：获得1能量、3势、3流 → 0.6倍伤害 → 条件势减半 → 加入下一己方回合2势队列',
    )
  })

  it('shows only the two forced flow-exchange choices until one is resolved', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['liunian', 'wangDahai'],
      positions: { liunian: Position.Front1, wangDahai: Position.Front2 },
      bossKey: 'trainingDummy',
    }, 3)
    expect(started.ok).toBe(true)
    if (!started.ok || started.state.personalTurn === null) return
    const pending = {
      ...started.state,
      pendingForcedChoice: {
        choiceId: 'ui:flow-choice',
        unitId: started.state.personalTurn.unitId,
        kind: 'liunianFlowExchange',
      },
    }
    expect(getUiBattleActions(pending).map((action) => action.id)).toEqual([
      'liunian.exchange.otherLoses',
      'liunian.exchange.holderLoses',
    ])
    const blocked = executeUiBattleAction(pending, 'liunian.dingxue', 99)
    expect(blocked.ok).toBe(false)
    expect(blocked.state).toBe(pending)
  })

  it('exposes active living-ally targets and disables Flow Change after use', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['liunian', 'wangDahai', 'yanYan'],
      positions: {
        liunian: Position.Back2,
        wangDahai: Position.Front1,
        yanYan: Position.Front2,
      },
      bossKey: 'trainingDummy',
    }, 11)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const funded = {
      ...started.state,
      units: started.state.units.map((unit) => unit.id === LIUNIAN_UNIT_ID
        ? { ...unit, energy: 3 }
        : unit),
    }
    const opened = executeUiBattleAction(funded, 'liunian.domain', 1)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const flowAction = getUiBattleActions(opened.state).find((action) => (
      action.id === 'liunian.flowChange'
    ))
    expect(flowAction?.targetOptions.map((target) => target.label)).toEqual([
      '王大海',
      '严岩',
    ])
    const noSelection = executeUiBattleAction(opened.state, 'liunian.flowChange', 2)
    expect(noSelection.ok).toBe(false)
    const selectedTarget = flowAction?.targetOptions[1]
    expect(selectedTarget).toBeDefined()
    if (selectedTarget === undefined) return
    const used = executeUiBattleAction(
      opened.state,
      'liunian.flowChange',
      3,
      selectedTarget.unitId,
    )
    expect(used.ok).toBe(true)
    if (!used.ok) return
    expect(getUiBattleActions(used.state).find((action) => (
      action.id === 'liunian.flowChange'
    ))?.unavailableReason).toBe('本个人回合已释放过生生流变')
  })

  it('requires an active South Water target and reports all selected-target results', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['liunian', 'wangDahai', 'yanYan'],
      positions: {
        liunian: Position.Back2,
        wangDahai: Position.Front1,
        yanYan: Position.Front2,
      },
      bossKey: 'trainingDummy',
    }, 17)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const funded = {
      ...started.state,
      units: started.state.units.map((unit) => unit.id === LIUNIAN_UNIT_ID
        ? { ...unit, energy: 3, currentHealth: 100 }
        : unit.name === '王大海'
          ? { ...unit, currentHealth: unit.maximumHealth - 10 }
          : unit.name === '严岩'
            ? { ...unit, currentHealth: unit.maximumHealth - 20 }
            : unit),
    }
    const opened = executeUiBattleAction(funded, 'liunian.domain', 1)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const flowAction = getUiBattleActions(opened.state).find((action) => (
      action.id === 'liunian.flowChange'
    ))
    const yanYanTarget = flowAction?.targetOptions.find((target) => target.label === '严岩')
    expect(yanYanTarget).toBeDefined()
    if (yanYanTarget === undefined) return
    const flowed = executeUiBattleAction(
      opened.state,
      'liunian.flowChange',
      2,
      yanYanTarget.unitId,
    )
    expect(flowed.ok).toBe(true)
    if (!flowed.ok) return
    const southWater = getUiBattleActions(flowed.state).find((action) => (
      action.id === 'liunian.southWater'
    ))
    expect(southWater?.targetOptions.map((target) => target.label)).toEqual([
      '王大海',
      '严岩',
    ])
    expect(southWater?.detail).toContain('结束回合')
    expect(southWater?.effectDetails).toContain('回合：默认结束流年的个人回合')
    const noSelection = executeUiBattleAction(flowed.state, 'liunian.southWater', 3)
    expect(noSelection.ok).toBe(false)
    expect(noSelection.state).toBe(flowed.state)
    expect(noSelection.reason).toBe('请选择南阳水来的友方目标')

    const beforeWangHealth = flowed.state.units.find((unit) => unit.name === '王大海')
      ?.currentHealth
    const beforeYanHealth = flowed.state.units.find((unit) => unit.name === '严岩')
      ?.currentHealth
    const originalTurnId = flowed.state.personalTurn?.personalTurnId
    const used = executeUiBattleAction(
      { ...flowed.state, rngState: createFixedSequenceRandomState([0.9]) },
      'liunian.southWater',
      4,
      yanYanTarget.unitId,
    )
    expect(used.ok).toBe(true)
    if (!used.ok) return
    expect(used.state.units.find((unit) => unit.name === '王大海')?.currentHealth)
      .toBe(beforeWangHealth)
    expect(used.state.units.find((unit) => unit.name === '严岩')?.currentHealth)
      .toBe((beforeYanHealth ?? 0) + 5)
    expect(used.state.units.find((unit) => unit.name === '严岩')?.momentum).toBe(1)
    expect(used.state.units.find((unit) => unit.id === LIUNIAN_UNIT_ID)).toMatchObject({
      currentHealth: 105,
      energy: 0,
    })
    expect(used.state.events).toContainEqual(expect.objectContaining({
      type: 'TURN_ENDED',
      unitId: LIUNIAN_UNIT_ID,
      personalTurnId: originalTurnId,
    }))
    const log = getUiBattleEvents(used.state).map((event) => event.text).join('\n')
    expect(log).toContain('流年释放了南阳水来')
    expect(log).toContain('为严岩恢复了5点生命值、恢复了5点生命值')
    expect(log).toContain('严岩获得了1点势')
  })

  it('excludes Liunian, enemies and dead allies from South Water target options', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['liunian', 'wangDahai', 'yanYan'],
      positions: {
        liunian: Position.Back2,
        wangDahai: Position.Front1,
        yanYan: Position.Front2,
      },
      bossKey: 'trainingDummy',
    }, 19)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const funded = {
      ...started.state,
      units: started.state.units.map((unit) => unit.id === LIUNIAN_UNIT_ID
        ? { ...unit, energy: 2 }
        : unit.name === '严岩'
          ? { ...unit, currentHealth: 0, alive: false }
          : unit),
    }
    const opened = executeUiBattleAction(funded, 'liunian.domain', 1)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const targets = getUiBattleActions(opened.state).find((action) => (
      action.id === 'liunian.southWater'
    ))?.targetOptions
    expect(targets?.map((target) => target.label)).toEqual(['王大海'])
  })

  it('keeps zero-healing South Water feedback in the UI battle log', () => {
    const started = startUiTrainingBattle({
      characterKeys: ['liunian', 'wangDahai'],
      positions: { liunian: Position.Back2, wangDahai: Position.Front1 },
      bossKey: 'trainingDummy',
    }, 23)
    expect(started.ok).toBe(true)
    if (!started.ok) return
    const funded = {
      ...started.state,
      units: started.state.units.map((unit) => unit.id === LIUNIAN_UNIT_ID
        ? { ...unit, energy: 2 }
        : unit),
    }
    const opened = executeUiBattleAction(funded, 'liunian.domain', 1)
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const target = getUiBattleActions(opened.state).find((action) => (
      action.id === 'liunian.southWater'
    ))?.targetOptions[0]
    expect(target).toBeDefined()
    if (target === undefined) return
    const used = executeUiBattleAction(
      opened.state,
      'liunian.southWater',
      2,
      target.unitId,
    )
    expect(used.ok).toBe(true)
    if (!used.ok) return
    expect(used.state.events).toContainEqual(expect.objectContaining({
      type: 'HEALTH_RESTORED',
      unitId: target.unitId,
      amount: 0,
    }))
    expect(getUiBattleEvents(used.state).map((event) => event.text).join('\n'))
      .toContain('为王大海恢复了0点生命值')
  })
})
