import type { SkillContext } from './contexts'
import type { TriggerLockId, UnitId } from './identifiers'

export interface TriggerLockResult {
  readonly acquired: boolean
  readonly context: SkillContext
}

export function acquirePerTargetTriggerLock(
  context: SkillContext,
  lockId: TriggerLockId,
  targetId: UnitId,
): TriggerLockResult {
  const existing = context.perTargetTriggerLocks.find(
    (lock) => lock.lockId === lockId,
  )
  if (existing?.triggeredTargetIds.includes(targetId)) {
    return { acquired: false, context }
  }

  const nextLock = existing === undefined
    ? { lockId, triggeredTargetIds: [targetId] }
    : {
      ...existing,
      triggeredTargetIds: [...existing.triggeredTargetIds, targetId],
    }
  return {
    acquired: true,
    context: {
      ...context,
      perTargetTriggerLocks: existing === undefined
        ? [...context.perTargetTriggerLocks, nextLock]
        : context.perTargetTriggerLocks.map((lock) => (
          lock.lockId === lockId ? nextLock : lock
        )),
    },
  }
}

export function acquireGlobalTriggerLock(
  context: SkillContext,
  lockId: TriggerLockId,
): TriggerLockResult {
  if (context.globalTriggerLocks.includes(lockId)) {
    return { acquired: false, context }
  }

  return {
    acquired: true,
    context: {
      ...context,
      globalTriggerLocks: [...context.globalTriggerLocks, lockId],
    },
  }
}
