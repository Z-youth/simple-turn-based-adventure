import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createUiActionPlaybackQueue,
  createUiDamageFeedbackScheduler,
  createResettableUiTimeout,
  getUiDamageHitCounts,
  groupUiBattleEventsByAction,
  UI_ACTION_PLAYBACK_DELAY_MS,
  UI_CHALLENGE_TOAST_DURATION_MS,
  UI_DAMAGE_FEEDBACK_DURATION_MS,
  UI_DAMAGE_REHIT_DELAY_MS,
} from '../game/ui/battleUiFeedback'

describe('battle UI feedback helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resets the challenge toast countdown instead of leaving parallel timers', () => {
    vi.useFakeTimers()
    const onElapsed = vi.fn()
    const timeout = createResettableUiTimeout(
      UI_CHALLENGE_TOAST_DURATION_MS,
      onElapsed,
    )

    timeout.restart()
    vi.advanceTimersByTime(UI_CHALLENGE_TOAST_DURATION_MS - 1)
    timeout.restart()
    vi.advanceTimersByTime(1)
    expect(onElapsed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(UI_CHALLENGE_TOAST_DURATION_MS - 1)
    expect(onElapsed).toHaveBeenCalledTimes(1)
  })

  it('holds one completed UI action for exactly one playback delay', () => {
    vi.useFakeTimers()
    const onElapsed = vi.fn()
    const timeout = createResettableUiTimeout(UI_ACTION_PLAYBACK_DELAY_MS, onElapsed)

    timeout.restart()
    vi.advanceTimersByTime(UI_ACTION_PLAYBACK_DELAY_MS - 1)
    expect(onElapsed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onElapsed).toHaveBeenCalledTimes(1)
  })

  it('plays a player action and each automatic action in separate one-second groups', () => {
    vi.useFakeTimers()
    const groups = groupUiBattleEventsByAction([
      { type: 'ACTION_STARTED', actionId: 'action:player' },
      {
        type: 'SKILL_RESOLUTION_STARTED',
        actionId: 'action:player',
        resolutionKind: 'manual',
      },
      { type: 'ACTION_COMPLETED', actionId: 'action:player' },
      { type: 'ACTION_STARTED', actionId: 'action:boss-1' },
      {
        type: 'SKILL_RESOLUTION_STARTED',
        actionId: 'action:boss-1',
        resolutionKind: 'automatic',
      },
      { type: 'ACTION_COMPLETED', actionId: 'action:boss-1' },
      { type: 'ACTION_STARTED', actionId: 'action:boss-2' },
      {
        type: 'SKILL_RESOLUTION_STARTED',
        actionId: 'action:boss-2',
        resolutionKind: 'automatic',
      },
      { type: 'ACTION_COMPLETED', actionId: 'action:boss-2' },
    ] as never)
    const started = vi.fn()
    const completed = vi.fn()
    const queue = createUiActionPlaybackQueue(started, completed)

    expect(groups.map((group) => group.actionId)).toEqual([
      'action:player',
      'action:boss-1',
      'action:boss-2',
    ])
    queue.start(groups)
    expect(started).toHaveBeenCalledTimes(1)
    expect(completed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(UI_ACTION_PLAYBACK_DELAY_MS - 1)
    expect(started).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(started).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(UI_ACTION_PLAYBACK_DELAY_MS)
    expect(started).toHaveBeenCalledTimes(3)
    vi.advanceTimersByTime(UI_ACTION_PLAYBACK_DELAY_MS)
    expect(completed).toHaveBeenCalledTimes(1)
  })

  it('keeps passive and reaction skill resolutions in their own playback groups', () => {
    const groups = groupUiBattleEventsByAction([
      { type: 'ACTION_STARTED', actionId: 'action:player' },
      {
        type: 'SKILL_RESOLUTION_STARTED',
        actionId: 'action:player',
        resolutionKind: 'manual',
      },
      {
        type: 'SKILL_RESOLUTION_STARTED',
        actionId: 'action:player',
        resolutionKind: 'passive',
      },
      {
        type: 'SKILL_RESOLUTION_STARTED',
        actionId: null,
        resolutionKind: 'reaction',
      },
    ] as never)

    expect(groups.map((group) => group.events.find((event) => (
      event.type === 'SKILL_RESOLUTION_STARTED'
    ))?.resolutionKind)).toEqual(['manual', 'passive', 'reaction'])
  })

  it('adds each event in a group progressively while retaining the one-second group boundary', () => {
    vi.useFakeTimers()
    const progressed = vi.fn()
    const started = vi.fn()
    const queue = createUiActionPlaybackQueue(
      started,
      vi.fn(),
      undefined,
      progressed,
    )
    const group = {
      actionId: 'action:one',
      events: [
        { type: 'ACTION_STARTED', actionId: 'action:one' },
        {
          type: 'SKILL_RESOLUTION_STARTED',
          actionId: 'action:one',
          resolutionKind: 'manual',
        },
      ],
    } as never

    queue.start([group])
    expect(started).toHaveBeenCalledWith(group)
    expect(progressed).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime((UI_ACTION_PLAYBACK_DELAY_MS / 2) - 1)
    expect(progressed).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(progressed).toHaveBeenCalledTimes(2)
  })

  it('stops a queued playback before the next group can update the UI', () => {
    vi.useFakeTimers()
    const started = vi.fn()
    const completed = vi.fn()
    const queue = createUiActionPlaybackQueue(started, completed)

    queue.start([
      { actionId: 'action:one', events: [] },
      { actionId: 'action:two', events: [] },
    ])
    queue.cancel()
    vi.advanceTimersByTime(UI_ACTION_PLAYBACK_DELAY_MS * 3)

    expect(started).toHaveBeenCalledTimes(1)
    expect(completed).not.toHaveBeenCalled()
  })

  it('counts only positive real damage events and gives every multi-hit a new card version', () => {
    expect(UI_DAMAGE_FEEDBACK_DURATION_MS).toBe(900)
    expect(getUiDamageHitCounts([
      {
        type: 'DAMAGE_CALCULATED',
        damage: { targetUnitId: 'unit:target', resolvedValue: 8 },
      },
      {
        type: 'EXTRA_DAMAGE_APPLIED',
        damage: { targetUnitId: 'unit:target', resolvedValue: 3 },
      },
      {
        type: 'DAMAGE_CALCULATED',
        damage: { targetUnitId: 'unit:zero', resolvedValue: 0 },
      },
      { type: 'SEQUENCE_STARTED' },
    ] as never)).toEqual({ 'unit:target': 2 })
  })

  it('restarts a damaged card for every real multi-hit instead of using a target snapshot', () => {
    vi.useFakeTimers()
    const onHit = vi.fn()
    const feedback = createUiDamageFeedbackScheduler(onHit)

    feedback.play([
      {
        type: 'DAMAGE_CALCULATED',
        damage: { targetUnitId: 'unit:target', resolvedValue: 8 },
      },
      {
        type: 'EXTRA_DAMAGE_APPLIED',
        damage: { targetUnitId: 'unit:target', resolvedValue: 3 },
      },
    ] as never)

    expect(onHit).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(UI_DAMAGE_REHIT_DELAY_MS - 1)
    expect(onHit).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(onHit).toHaveBeenCalledTimes(2)
  })
})
