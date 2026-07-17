import type { UnitState } from './units'
import type { ResourceConfiguration } from './resources'
import {
  getResourceConfig,
  readUnitResource,
  RESOURCE_TYPE_ORDER,
  ResourceType,
  unitResourcesMatchConfiguration,
} from './resources'
import type { ResourceType as ResourceTypeValue } from './resources'
import { findActiveResourceReductionProtection } from './specialCounters'

export function getResourceValue(
  unit: UnitState,
  resourceType: ResourceTypeValue,
): number {
  return readUnitResource(unit, resourceType)
}

export function getEnergy(unit: UnitState): number {
  return getResourceValue(unit, ResourceType.Energy)
}

export function getMomentum(unit: UnitState): number {
  return getResourceValue(unit, ResourceType.Momentum)
}

export function getMomentumPressure(unit: UnitState): number {
  return getResourceValue(unit, ResourceType.MomentumPressure)
}

export function getIntent(unit: UnitState): number {
  return getResourceValue(unit, ResourceType.Intent)
}

export function getMagic(unit: UnitState): number {
  return getResourceValue(unit, ResourceType.Magic)
}

export function getResourceMinimum(
  configuration: ResourceConfiguration,
  resourceType: ResourceTypeValue,
): number | null {
  return getResourceConfig(configuration, resourceType)?.minimum ?? null
}

export function getResourceMaximum(
  configuration: ResourceConfiguration,
  resourceType: ResourceTypeValue,
): number | null {
  return getResourceConfig(configuration, resourceType)?.maximum ?? null
}

export interface AffordableResourceCost {
  readonly resourceType: ResourceTypeValue
  readonly amount: number
}

export function canAffordResourceCosts(
  unit: UnitState,
  costs: readonly AffordableResourceCost[],
  configuration: ResourceConfiguration,
): boolean {
  if (!unit.alive || (!unit.hasInfiniteHealth && unit.currentHealth <= 0)) {
    return false
  }
  if (!unitResourcesMatchConfiguration(unit, configuration)) return false
  return RESOURCE_TYPE_ORDER.every((resourceType) => {
    const amounts = costs
      .filter((cost) => cost.resourceType === resourceType)
      .map((cost) => cost.amount)
    if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount <= 0)) {
      return false
    }
    const total = amounts.reduce((sum, amount) => sum + amount, 0)
    if (!Number.isSafeInteger(total)) return false
    if (total === 0) return true
    const config = getResourceConfig(configuration, resourceType)
    const paymentMinimum = resourceType === ResourceType.Energy
      ? Math.max(0, config?.minimum ?? 0)
      : config?.minimum
    return config !== undefined
      && config.allowSpend
      && (findActiveResourceReductionProtection(unit, resourceType) !== null
        || (paymentMinimum !== undefined
          && readUnitResource(unit, resourceType) - total >= paymentMinimum))
  })
}
