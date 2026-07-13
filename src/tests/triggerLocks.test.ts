import { describe, expect, it } from 'vitest'
import type { SkillContext } from '../game/core/contexts'
import {
  acquireGlobalTriggerLock,
  acquirePerTargetTriggerLock,
} from '../game/core/triggerLocks'
import { ids } from './combatTestUtils'
import { unitId } from './battleTestUtils'

function skillContext(execution = 'skill-execution:1'): SkillContext {
  return {
    skillExecutionId: execution as import('../game/core/identifiers').SkillExecutionId,
    actionId: ids.action,
    casterId: unitId('caster'),
    skillId: ids.skill,
    branchId: null,
    targetIds: [unitId('target')],
    perTargetTriggerLocks: [],
    globalTriggerLocks: [],
  }
}

describe('per-target trigger locks', () => {
  it('allows one trigger per target within one skill execution', () => {
    const first = acquirePerTargetTriggerLock(
      skillContext(),
      ids.lock('extra'),
      unitId('target'),
    )
    const repeated = acquirePerTargetTriggerLock(
      first.context,
      ids.lock('extra'),
      unitId('target'),
    )
    const otherTarget = acquirePerTargetTriggerLock(
      first.context,
      ids.lock('extra'),
      unitId('other'),
    )

    expect(first.acquired).toBe(true)
    expect(repeated).toEqual({ acquired: false, context: first.context })
    expect(otherTarget.acquired).toBe(true)
  })

  it('does not share locks between different skill executions', () => {
    const first = acquirePerTargetTriggerLock(
      skillContext('first'),
      ids.lock('extra'),
      unitId('target'),
    )
    const second = acquirePerTargetTriggerLock(
      skillContext('second'),
      ids.lock('extra'),
      unitId('target'),
    )

    expect(first.acquired).toBe(true)
    expect(second.acquired).toBe(true)
  })
})

describe('global trigger locks', () => {
  it('allows exactly one global trigger per skill execution', () => {
    const first = acquireGlobalTriggerLock(skillContext(), ids.lock('global'))
    const repeated = acquireGlobalTriggerLock(first.context, ids.lock('global'))

    expect(first.acquired).toBe(true)
    expect(repeated).toEqual({ acquired: false, context: first.context })
  })
})
