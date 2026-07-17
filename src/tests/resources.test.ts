import { describe, expect, it } from 'vitest'
import {
  createDefaultResourceConfiguration,
  createResourceConfiguration,
  gainResource,
  loseResource,
  RESOURCE_TYPE_ORDER,
  resolveResourceFormulaValue,
  ResourceType,
  spendResource,
  validateResourceConfiguration,
} from '../game/core/resources'
import {
  canAffordResourceCosts,
  getEnergy,
  getIntent,
  getMagic,
  getMomentum,
  getMomentumPressure,
  getResourceMaximum,
  getResourceMinimum,
  getResourceValue,
} from '../game/core/resourceSelectors'
import { createBattleState, createUnit, unitId } from './battleTestUtils'

function request(
  resourceType: ResourceType,
  amount: number,
) {
  return {
    unitId: unitId('owner'),
    resourceType,
    amount,
    reason: 'test',
    sourceId: null,
    actionId: null,
    personalTurnId: null,
    sequenceId: null,
    skillExecutionId: null,
    resourceTransactionId: null,
  }
}

describe('resource configuration and selectors', () => {
  it('allows non-payment energy loss below zero while other resources stay non-negative', () => {
    const configuration = createDefaultResourceConfiguration()

    expect(configuration.resources.map((item) => item.resourceType)).toEqual([
      'energy',
      'momentum',
      'momentumPressure',
      'intent',
      'magic',
    ])
    for (const resourceType of Object.values(ResourceType)) {
      expect(getResourceMinimum(configuration, resourceType)).toBe(
        resourceType === ResourceType.Energy ? Number.MIN_SAFE_INTEGER : 0,
      )
      expect(getResourceMaximum(configuration, resourceType)).toBeNull()
    }
  })

  it('supports a trusted negative-energy minimum without changing other resources', () => {
    const configuration = createResourceConfiguration({ minimum: -10 })

    expect(getResourceMinimum(configuration, ResourceType.Energy)).toBe(-10)
    expect(getResourceMinimum(configuration, ResourceType.Momentum)).toBe(0)
  })

  it('uses the default factory as the strict canonical resource order', () => {
    expect(createDefaultResourceConfiguration().resources.map((config) => (
      config.resourceType
    ))).toEqual([
      ResourceType.Energy,
      ResourceType.Momentum,
      ResourceType.MomentumPressure,
      ResourceType.Intent,
      ResourceType.Magic,
    ])
  })

  it('freezes the exported resource order against runtime mutation', () => {
    const mutableOrder = RESOURCE_TYPE_ORDER as any
    const mutations = [
      () => { mutableOrder.length = 0 },
      () => { mutableOrder.push('sixth') },
      () => { mutableOrder.splice(0, 1) },
      () => { mutableOrder[0] = ResourceType.Magic },
      () => { Object.defineProperty(mutableOrder, '1', { value: 'forged' }) },
    ]

    expect(Object.isFrozen(RESOURCE_TYPE_ORDER)).toBe(true)
    for (const mutate of mutations) expect(mutate).toThrow(TypeError)
    expect(RESOURCE_TYPE_ORDER).toEqual([
      ResourceType.Energy,
      ResourceType.Momentum,
      ResourceType.MomentumPressure,
      ResourceType.Intent,
      ResourceType.Magic,
    ])
  })

  it('keeps the internal five-resource standard after export mutation attempts', () => {
    const defaults = createDefaultResourceConfiguration()
    const forgedSixth = {
      ...defaults.resources[0],
      resourceType: 'sixth' as ResourceType,
    }
    const sixResourceState = {
      ...createBattleState([createUnit('owner')]),
      resourceConfiguration: {
        resources: [...defaults.resources, forgedSixth],
      },
    }
    const reorderedState = {
      ...createBattleState([createUnit('owner')]),
      resourceConfiguration: {
        resources: [
          defaults.resources[1],
          defaults.resources[0],
          ...defaults.resources.slice(2),
        ],
      },
    }

    for (const state of [sixResourceState, reorderedState]) {
      expect(validateResourceConfiguration(state.resourceConfiguration))
        .toBe('INVALID_RESOURCE_CONFIGURATION')
      const result = gainResource(
        state,
        request(ResourceType.Energy, 1),
      )
      expect(result).toEqual({
        ok: false,
        state,
        events: [],
        reason: 'INVALID_RESOURCE_CONFIGURATION',
      })
      expect(result.state.events).toBe(state.events)
      expect(result.state.rngState).toBe(state.rngState)
    }
  })

  it('deep-freezes default and extended resource configurations', () => {
    const defaults = createDefaultResourceConfiguration()
    const extended = createResourceConfiguration({ minimum: -10 })

    for (const configuration of [defaults, extended]) {
      expect(Object.isFrozen(configuration)).toBe(true)
      expect(Object.isFrozen(configuration.resources)).toBe(true)
      expect(configuration.resources.every(Object.isFrozen)).toBe(true)
    }
    expect(() => {
      (defaults.resources[1] as any).maximum = 0
    }).toThrow(TypeError)
    expect(createDefaultResourceConfiguration().resources[1].maximum).toBeNull()
    expect(getResourceMinimum(extended, ResourceType.Energy)).toBe(-10)
  })

  it.each([
    { allowGain: true },
    { allowSpend: true },
    { systemDerived: false },
    { minimum: -100 },
  ])('rejects forged momentum-pressure policy %o', (override) => {
    const defaults = createDefaultResourceConfiguration()
    const resourceConfiguration = {
      resources: defaults.resources.map((config) => (
        config.resourceType === ResourceType.MomentumPressure
          ? { ...config, ...override }
          : config
      )),
    }
    const originalConfiguration = resourceConfiguration.resources.map(
      (config) => ({ ...config }),
    )
    const state = {
      ...createBattleState([createUnit('owner', { momentumPressure: 2 })]),
      resourceConfiguration,
    }
    const gained = gainResource(
      state,
      request(ResourceType.MomentumPressure, 1),
    )
    const spent = spendResource(
      state,
      request(ResourceType.MomentumPressure, 1),
    )

    expect(gained).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'INVALID_RESOURCE_CONFIGURATION',
    })
    expect(spent).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'INVALID_RESOURCE_CONFIGURATION',
    })
    expect(resourceConfiguration.resources).toEqual(originalConfiguration)
  })

  it('rejects a forged momentum maximum without changing state, events, or RNG', () => {
    const defaults = createDefaultResourceConfiguration()
    const state = {
      ...createBattleState([createUnit('owner', { momentum: 5 })]),
      resourceConfiguration: {
        resources: defaults.resources.map((config) => (
          config.resourceType === ResourceType.Momentum
            ? { ...config, maximum: 5 }
            : config
        )),
      },
    }
    const result = gainResource(state, request(ResourceType.Momentum, 1))

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'INVALID_RESOURCE_CONFIGURATION',
    })
    expect(result.state.events).toBe(state.events)
    expect(result.state.rngState).toBe(state.rngState)
  })

  it.each([
    { resourceType: ResourceType.Energy, allowGain: false },
    { resourceType: ResourceType.Momentum, allowSpend: false },
    { resourceType: ResourceType.Intent, systemDerived: true },
    { resourceType: ResourceType.Magic, minimum: -1 },
  ])('rejects forged ordinary resource policy %o', (override) => {
    const defaults = createDefaultResourceConfiguration()
    const state = {
      ...createBattleState([createUnit('owner')]),
      resourceConfiguration: {
        resources: defaults.resources.map((config) => (
          config.resourceType === override.resourceType
            ? { ...config, ...override }
            : config
        )),
      },
    }

    const result = gainResource(state, request(override.resourceType, 1))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('INVALID_RESOURCE_CONFIGURATION')
  })

  it.each([
    { minimum: 0, maximum: -1 },
    { minimum: Number.NaN, maximum: null },
    { minimum: Number.POSITIVE_INFINITY, maximum: null },
    { minimum: -1.5, maximum: null },
    { minimum: -Number.MAX_SAFE_INTEGER - 1, maximum: null },
    { minimum: 0, maximum: Number.NaN },
    { minimum: 0, maximum: Number.POSITIVE_INFINITY },
    { minimum: 0, maximum: 1.5 },
    { minimum: 0, maximum: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects invalid configured energy bounds %o', ({ minimum, maximum }) => {
    const defaults = createDefaultResourceConfiguration()
    const state = {
      ...createBattleState([createUnit('owner')]),
      resourceConfiguration: {
        resources: defaults.resources.map((config) => (
          config.resourceType === ResourceType.Energy
            ? { ...config, minimum, maximum }
            : config
        )),
      },
    }

    const result = gainResource(state, request(ResourceType.Energy, 1))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('INVALID_RESOURCE_CONFIGURATION')
  })

  it.each([1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid energy configuration minimum %s',
    (minimum) => {
      expect(() => createResourceConfiguration({ minimum })).toThrowError(
        'INVALID_RESOURCE_CONFIGURATION',
      )
    },
  )

  it.each(['missing', 'duplicate', 'extra', 'reordered'] as const)(
    'rejects a %s resource configuration atomically',
    (kind) => {
      const defaults = createDefaultResourceConfiguration()
      const resources = [...defaults.resources]
      const forged = kind === 'missing'
        ? resources.slice(0, -1)
        : kind === 'duplicate'
          ? [resources[0], resources[1], resources[2], resources[3], resources[3]]
          : kind === 'extra'
            ? [...resources, resources[0]]
            : [resources[1], resources[0], ...resources.slice(2)]
      const state = {
        ...createBattleState([createUnit('owner')]),
        resourceConfiguration: { resources: forged },
      }
      const result = spendResource(state, request(ResourceType.Energy, 1))

      expect(validateResourceConfiguration(state.resourceConfiguration))
        .toBe('INVALID_RESOURCE_CONFIGURATION')
      expect(result).toEqual({
        ok: false,
        state,
        events: [],
        reason: 'INVALID_RESOURCE_CONFIGURATION',
      })
      expect(result.state.events).toBe(state.events)
      expect(result.state.rngState).toBe(state.rngState)
      expect(getResourceMinimum(state.resourceConfiguration, ResourceType.Energy))
        .toBeNull()
      expect(canAffordResourceCosts(
        state.units[0],
        [],
        state.resourceConfiguration,
      )).toBe(false)
    },
  )

  it('reads all resources without changing the unit', () => {
    const unit = createUnit('owner', {
      energy: 1,
      momentum: 2,
      momentumPressure: 3,
      intent: 4,
      magic: 5,
    })

    expect([
      getEnergy(unit),
      getMomentum(unit),
      getMomentumPressure(unit),
      getIntent(unit),
      getMagic(unit),
    ]).toEqual([1, 2, 3, 4, 5])
    expect(getResourceValue(unit, ResourceType.Magic)).toBe(5)
    expect(unit).toMatchObject({ energy: 1, momentum: 2, magic: 5 })
  })

  it('checks aggregate affordability without mutating costs or the unit', () => {
    const unit = createUnit('owner', { energy: 3, momentum: 5 })
    const costs = [
      { resourceType: ResourceType.Energy, amount: 1 },
      { resourceType: ResourceType.Energy, amount: 2 },
      { resourceType: ResourceType.Momentum, amount: 5 },
    ] as const

    expect(canAffordResourceCosts(
      unit,
      costs,
      createResourceConfiguration(),
    )).toBe(true)
    expect(costs).toHaveLength(3)
    expect(unit.energy).toBe(3)
  })

  it('reports that a dead unit cannot afford an otherwise payable cost', () => {
    const unit = createUnit('owner', {
      energy: 10,
      alive: false,
      currentHealth: 0,
    })

    expect(canAffordResourceCosts(unit, [{
      resourceType: ResourceType.Energy,
      amount: 1,
    }], createResourceConfiguration())).toBe(false)
  })

  it.each([
    [2.5, 3],
    [4.5, 5],
    [-2.5, -3],
  ])('rounds internal formula result %s once to %s', (value, expected) => {
    expect(resolveResourceFormulaValue(value)).toEqual({
      ok: true,
      value: expected,
    })
  })
})

describe('controlled resource gain and spend', () => {
  it.each([
    ResourceType.Energy,
    ResourceType.Momentum,
    ResourceType.Intent,
    ResourceType.Magic,
  ])('gains and spends integer %s through immutable state transitions', (type) => {
    const state = createBattleState([createUnit('owner')])
    const gained = gainResource(state, request(type, 5))

    expect(gained.ok).toBe(true)
    if (!gained.ok) return
    expect(getResourceValue(gained.state.units[0], type)).toBe(5)
    expect(state.units[0]).not.toBe(gained.state.units[0])
    expect(getResourceValue(state.units[0], type)).toBe(0)
    expect(gained.events[0]).toMatchObject({
      type: 'RESOURCE_GAINED',
      resourceType: type,
      amount: 5,
      before: 0,
      after: 5,
    })

    const spent = spendResource(gained.state, request(type, 2))
    expect(spent.ok).toBe(true)
    if (!spent.ok) return
    expect(getResourceValue(spent.state.units[0], type)).toBe(3)
    expect(spent.events[0]).toMatchObject({
      type: 'RESOURCE_SPENT',
      before: 5,
      after: 3,
    })
  })

  it.each(['gain', 'spend'] as const)(
    'blocks ordinary %s operations on derived momentum pressure',
    (operation) => {
      const state = createBattleState([createUnit('owner', {
        momentumPressure: 2,
      })])
      const result = operation === 'gain'
        ? gainResource(state, request(ResourceType.MomentumPressure, 1))
        : spendResource(state, request(ResourceType.MomentumPressure, 1))

      expect(result).toEqual({
        ok: false,
        state,
        events: [],
        reason: 'RESOURCE_OPERATION_NOT_ALLOWED',
      })
    },
  )

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('rejects invalid external amount %s atomically', (amount) => {
    const state = createBattleState([createUnit('owner', { energy: 5 })])
    const result = gainResource(state, request(ResourceType.Energy, amount))

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'INVALID_RESOURCE_AMOUNT',
    })
    expect(result.state.rngState).toBe(state.rngState)
  })

  it('rejects unsafe gain overflow without changing events or RNG', () => {
    const state = createBattleState([createUnit('owner', {
      energy: Number.MAX_SAFE_INTEGER,
    })])
    const result = gainResource(state, request(ResourceType.Energy, 1))

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'RESOURCE_VALUE_OUT_OF_RANGE',
    })
  })

  it('rejects a forged energy maximum without emitting a zero-value event', () => {
    const defaults = createDefaultResourceConfiguration()
    const state = {
      ...createBattleState([createUnit('owner', { energy: 10 })]),
      resourceConfiguration: {
        resources: defaults.resources.map((config) => (
          config.resourceType === ResourceType.Energy
            ? { ...config, maximum: 10 }
            : config
        )),
      },
    }
    const result = gainResource(state, request(ResourceType.Energy, 5))

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'INVALID_RESOURCE_CONFIGURATION',
    })
    expect(result.events.some((event) => event.type === 'RESOURCE_GAINED'))
      .toBe(false)
    expect(result.state.rngState).toBe(state.rngState)
  })

  it('rejects insufficient spend without partial payment', () => {
    const state = createBattleState([createUnit('owner', { energy: 2 })])
    const result = spendResource(state, request(ResourceType.Energy, 3))

    expect(result).toEqual({
      ok: false,
      state,
      events: [],
      reason: 'INSUFFICIENT_RESOURCE',
    })
  })

  it('distinguishes non-payment loss from active spending below zero', () => {
    const state = {
      ...createBattleState([createUnit('owner')]),
      resourceConfiguration: createResourceConfiguration({ minimum: -5 }),
    }
    const allowed = loseResource(state, request(ResourceType.Energy, 5))
    const rejected = spendResource(state, request(ResourceType.Energy, 1))

    expect(allowed.ok).toBe(true)
    if (allowed.ok) expect(allowed.state.units[0].energy).toBe(-5)
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.reason).toBe('INSUFFICIENT_RESOURCE')
    if (allowed.ok) expect(allowed.events[0]?.type).toBe('RESOURCE_LOST')
  })

  it('allows a default battle state to recover from negative energy', () => {
    const state = createBattleState([createUnit('owner', { energy: -1 })])
    const result = gainResource(state, request(ResourceType.Energy, 1))

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.state.units[0].energy).toBe(0)
  })

  it.each(['gain', 'spend'] as const)(
    'rejects %s for a dead owner while preserving existing resources',
    (operation) => {
      const state = createBattleState([createUnit('owner', {
        alive: false,
        currentHealth: 0,
        energy: 7,
        momentum: 8,
        intent: 9,
        magic: 10,
      })])
      const result = operation === 'gain'
        ? gainResource(state, request(ResourceType.Energy, 1))
        : spendResource(state, request(ResourceType.Energy, 1))

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('RESOURCE_OWNER_DEAD')
        expect(result.state).toBe(state)
      }
      expect(state.units[0]).toMatchObject({
        energy: 7,
        momentum: 8,
        intent: 9,
        magic: 10,
      })
    },
  )

  it('rejects a missing owner', () => {
    const state = createBattleState([createUnit('owner')])
    const result = gainResource(state, {
      ...request(ResourceType.Energy, 1),
      unitId: unitId('missing'),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('RESOURCE_OWNER_NOT_FOUND')
  })
})
