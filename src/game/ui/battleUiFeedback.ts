import type { BattleEvent } from '../core/events'

export const UI_ACTION_PLAYBACK_DELAY_MS = 1_000
export const UI_CHALLENGE_TOAST_DURATION_MS = 1_500
export const UI_DAMAGE_FEEDBACK_DURATION_MS = 900
export const UI_DAMAGE_REHIT_DELAY_MS = 120

export interface UiTimeoutScheduler {
  readonly setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>
  readonly clearTimeout: (handle: ReturnType<typeof setTimeout>) => void
}

export interface ResettableUiTimeout {
  restart(): void
  cancel(): void
}

export interface UiDamageFeedbackScheduler {
  play(events: readonly BattleEvent[]): void
  cancel(): void
}

export interface UiActionPlaybackGroup {
  readonly actionId: string | null
  readonly events: readonly BattleEvent[]
}

export interface UiActionPlaybackQueue {
  start(groups: readonly UiActionPlaybackGroup[]): void
  cancel(): void
}

const defaultUiTimeoutScheduler: UiTimeoutScheduler = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
}

export function createResettableUiTimeout(
  delay: number,
  onElapsed: () => void,
  scheduler: UiTimeoutScheduler = defaultUiTimeoutScheduler,
): ResettableUiTimeout {
  let handle: ReturnType<typeof setTimeout> | null = null

  const cancel = () => {
    if (handle === null) return
    scheduler.clearTimeout(handle)
    handle = null
  }

  return {
    restart() {
      cancel()
      handle = scheduler.setTimeout(() => {
        handle = null
        onElapsed()
      }, delay)
    },
    cancel,
  }
}

export function getUiDamageHitCounts(
  events: readonly BattleEvent[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {}

  for (const event of events) {
    if (
      (event.type !== 'DAMAGE_CALCULATED' && event.type !== 'EXTRA_DAMAGE_APPLIED')
      || event.damage.resolvedValue <= 0
    ) continue

    const targetUnitId = event.damage.targetUnitId
    counts[targetUnitId] = (counts[targetUnitId] ?? 0) + 1
  }

  return counts
}

export function createUiDamageFeedbackScheduler(
  onHit: (unitId: string) => void,
  scheduler: UiTimeoutScheduler = defaultUiTimeoutScheduler,
): UiDamageFeedbackScheduler {
  let handles: ReturnType<typeof setTimeout>[] = []

  const cancel = () => {
    for (const handle of handles) scheduler.clearTimeout(handle)
    handles = []
  }

  return {
    play(events) {
      const hitIndexes: Record<string, number> = {}
      for (const event of events) {
        if (
          (event.type !== 'DAMAGE_CALCULATED' && event.type !== 'EXTRA_DAMAGE_APPLIED')
          || event.damage.resolvedValue <= 0
        ) continue

        const targetUnitId = event.damage.targetUnitId
        const hitIndex = hitIndexes[targetUnitId] ?? 0
        hitIndexes[targetUnitId] = hitIndex + 1
        if (hitIndex === 0) {
          onHit(targetUnitId)
          continue
        }
        const handle = scheduler.setTimeout(() => {
          handles = handles.filter((candidate) => candidate !== handle)
          onHit(targetUnitId)
        }, hitIndex * UI_DAMAGE_REHIT_DELAY_MS)
        handles.push(handle)
      }
    },
    cancel,
  }
}

export function groupUiBattleEventsByAction(
  events: readonly BattleEvent[],
): readonly UiActionPlaybackGroup[] {
  const groups: { actionId: string | null, events: BattleEvent[] }[] = []
  let current: { actionId: string | null, events: BattleEvent[] } | null = null
  let activeAction: { actionId: string | null, events: BattleEvent[] } | null = null
  let currentIsTrigger = false

  const createGroup = (actionId: string | null, event: BattleEvent) => {
    const group = { actionId, events: [event] }
    groups.push(group)
    return group
  }

  const standaloneTriggerKey = (event: BattleEvent): string | null => {
    switch (event.type) {
      case 'SHIELD_GAINED':
      case 'HEALTH_RESTORED':
      case 'RESOURCE_GAINED':
      case 'RESOURCE_SPENT':
      case 'STATUS_ACQUIRED':
      case 'STATUS_BATCH_MERGED':
      case 'STATUS_DURATION_REFRESHED':
      case 'STATUS_BATCH_REPLACED':
        return event.effectId === 'wangDahaiRisingMomentum'
          ? null
          : event.skillExecutionId === null
          && event.sourceUnitId !== null
          && event.effectId !== null
          ? `${event.sourceUnitId}:${event.effectId}`
          : null
      case 'MOMENTUM_PRESSURE_TRIGGERED':
        return `momentumPressure:${event.damageEventId}`
      case 'EXTRA_DAMAGE_APPLIED':
        return event.damage.extraDamageSource === 'momentumPressure'
          && event.damage.eventId !== undefined
          ? `momentumPressure:${event.damage.eventId}`
          : null
      default:
        return null
    }
  }

  let currentStandaloneKey: string | null = null
  for (const event of events) {
    if (event.type === 'ACTION_STARTED') {
      current = createGroup(event.actionId, event)
      activeAction = current
      currentIsTrigger = false
      currentStandaloneKey = null
      continue
    }
    if (event.type === 'SKILL_RESOLUTION_STARTED') {
      const isIndependentTrigger = event.resolutionKind === 'passive'
        || event.resolutionKind === 'reaction'
        || event.actionId === null
        || activeAction?.actionId !== event.actionId
      if (isIndependentTrigger) {
        current = createGroup(event.actionId, event)
        currentIsTrigger = true
      } else if (activeAction !== null) {
        activeAction.events.push(event)
        current = activeAction
        currentIsTrigger = false
      } else {
        current = createGroup(event.actionId, event)
        activeAction = current
        currentIsTrigger = false
      }
      currentStandaloneKey = null
      continue
    }

    const standaloneKey = standaloneTriggerKey(event)
    if (standaloneKey !== null) {
      if (currentStandaloneKey === standaloneKey && current !== null) {
        current.events.push(event)
      } else {
        current = createGroup(null, event)
        currentIsTrigger = true
        currentStandaloneKey = standaloneKey
      }
      continue
    }

    if (
      event.type === 'SKILL_RESOLUTION_COMPLETED'
      && currentIsTrigger
      && current !== null
    ) {
      current.events.push(event)
      current = activeAction
      currentIsTrigger = false
      currentStandaloneKey = null
      continue
    }
    if (event.type === 'ACTION_COMPLETED') {
      if (activeAction?.actionId === event.actionId) activeAction.events.push(event)
      activeAction = null
      current = null
      currentIsTrigger = false
      currentStandaloneKey = null
      continue
    }
    if (current !== null) {
      current.events.push(event)
    }
  }

  return groups
}

export function createUiActionPlaybackQueue(
  onGroupStarted: (group: UiActionPlaybackGroup) => void,
  onCompleted: () => void,
  scheduler: UiTimeoutScheduler = defaultUiTimeoutScheduler,
  onGroupEvent: (group: UiActionPlaybackGroup, event: BattleEvent) => void = () => {},
): UiActionPlaybackQueue {
  let handle: ReturnType<typeof setTimeout> | null = null
  let generation = 0

  const cancel = () => {
    generation += 1
    if (handle !== null) scheduler.clearTimeout(handle)
    handle = null
  }

  return {
    start(groups) {
      cancel()
      if (groups.length === 0) {
        onCompleted()
        return
      }

      const activeGeneration = generation
      const playGroup = (index: number) => {
        if (activeGeneration !== generation) return
        const group = groups[index]
        onGroupStarted(group)
        const eventDelay = Math.floor(
          UI_ACTION_PLAYBACK_DELAY_MS / Math.max(group.events.length, 1),
        )
        let eventIndex = 0
        const playNextEvent = () => {
          if (activeGeneration !== generation) return
          if (eventIndex < group.events.length) {
            onGroupEvent(group, group.events[eventIndex])
            eventIndex += 1
          }
          const delay = group.events.length === 0
            ? UI_ACTION_PLAYBACK_DELAY_MS
            : eventIndex < group.events.length
              ? eventDelay
              : UI_ACTION_PLAYBACK_DELAY_MS - (eventDelay * (group.events.length - 1))
          handle = scheduler.setTimeout(() => {
            if (activeGeneration !== generation) return
            if (eventIndex < group.events.length) {
              playNextEvent()
              return
            }
            if (index + 1 < groups.length) {
              playGroup(index + 1)
              return
            }
            handle = null
            onCompleted()
          }, delay)
        }
        playNextEvent()
      }

      playGroup(0)
    },
    cancel,
  }
}
