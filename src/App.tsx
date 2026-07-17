import { useEffect, useRef, useState } from 'react'
import './App.css'
import {
  endUiPlayerTurn,
  endUiTrainingBattleAsDefeat,
  executeUiBattleAction,
  getUiBattleActions,
  getUiBattleEvents,
  getUiTrainingPauseReason,
  getUiHealthText,
  getUiPlayerFormationSlots,
  getUiShieldShellProgress,
  getUiTrainingStatistics,
  getUiUnitDetails,
  isUiTrainingResultReady,
  pauseUiTrainingBattle,
  requestUiTrainingExit,
  resetUiTrainingBattle,
  resumeUiTrainingBattle,
  startUiTrainingBattle,
  UI_BOSS_DEFINITIONS,
  UI_CHARACTER_DEFINITIONS,
  UNIT_DETAIL_SCROLL_STYLE,
  UI_POSITION_OPTIONS,
} from './game/ui/battleUiAdapter'
import {
  createUiActionPlaybackQueue,
  createUiDamageFeedbackScheduler,
  createResettableUiTimeout,
  groupUiBattleEventsByAction,
  UI_CHALLENGE_TOAST_DURATION_MS,
} from './game/ui/battleUiFeedback'
import type {
  UiBossKey,
  UiCharacterKey,
} from './game/ui/battleUiAdapter'
import type { TrainingStatistics } from './game/core/trainingStatistics'
import { TrainingExitConfirmation } from './game/core/commands'
import type { BattleState } from './game/core/contexts'
import type { BattleEvent } from './game/core/events'
import type { Position } from './game/core/enums'
import type { UnitId } from './game/core/identifiers'
import type { UnitState } from './game/core/units'

type PreBattlePage =
  | 'title'
  | 'mode'
  | 'team'
  | 'boss'
  | 'battle'
  | 'pause'
  | 'pausedBattlefield'
  | 'result'

const PHASE_NAMES: Record<string, string> = {
  setup: '准备中',
  sequenceStart: '轮次开始',
  turnStart: '回合开始',
  awaitingAction: '等待行动',
  resolvingAction: '行动结算',
  turnEnd: '回合结束',
  unableToContinue: '无法继续',
  paused: '暂停',
  finished: '已结束',
}

const PERSONAL_TURN_PHASE_NAMES: Record<string, string> = {
  startingDelayedEffects: '延迟效果',
  startingSystemRules: '系统规则',
  startingUnitPassives: '单位被动',
  startingStatusEffects: '状态效果',
  awaitingAction: '等待行动',
  resolvingAction: '行动结算',
  ending: '准备结束',
  endingTriggeredEffects: '触发效果',
  endingUnitSpecificEffects: '单位回合结束效果',
  endingStatusEffects: '状态效果',
  endingSpecialVariables: '特殊变量',
  endingStatusDurations: '状态持续时间',
  endingTemporaryModifiers: '临时属性',
  ended: '已结束',
}

interface ActionButtonProps {
  readonly label: string
  readonly detail: string
  readonly resourceCost: string
  readonly targetRule: string
  readonly description: string
  readonly effectDetails: readonly string[]
  readonly reason: string | null
  readonly onClick: () => void
  readonly tone?: 'primary' | 'secondary'
}

function ActionButton({
  label,
  detail,
  resourceCost,
  targetRule,
  description,
  effectDetails,
  reason,
  onClick,
  tone = 'primary',
}: ActionButtonProps) {
  return (
    <div className="action-option">
      <button
        className={`action-button action-button--${tone}`}
        type="button"
        disabled={reason !== null}
        onClick={onClick}
      >
        <strong>{label}</strong>
        <span>{detail}</span>
      </button>
      <div className="action-detail" role="tooltip">
        <strong>{label}</strong>
        <span>资源消耗：{resourceCost}</span>
        <span>目标规则：{targetRule}</span>
        <p>{description}</p>
        <ul>
          {effectDetails.map((detail) => <li key={detail}>{detail}</li>)}
        </ul>
      </div>
      <small className={reason === null ? 'available' : 'unavailable'}>
        {reason ?? '可使用'}
      </small>
    </div>
  )
}

function Stat({ label, value }: { readonly label: string, readonly value: string | number }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function UnitCard({
  unit,
  player,
  details,
  hitVersion,
}: {
  readonly unit: UnitState
  readonly player: boolean
  readonly details: ReturnType<typeof getUiUnitDetails>
  readonly hitVersion: number
}) {
  const health = getUiHealthText(unit)
  const shieldShellProgress = getUiShieldShellProgress(unit)
  const detailFields = details?.commonFields ?? []
  const exclusiveFields = details?.exclusiveFields ?? []
  const statusDetails = details?.statusDetails ?? []
  return (
    <article
      className={`unit-card ${player ? 'unit-card--player' : 'unit-card--enemy'} ${
        hitVersion > 0 ? 'unit-card--hit' : ''
      }`}
    >
      <div className="unit-heading">
        <div>
          <h2>{unit.name}</h2>
        </div>
      </div>
      <div className="health-track" aria-label={`生命 ${health}`}>
        {shieldShellProgress !== null && (
          <span
            className="shield-shell"
            style={{ width: `${shieldShellProgress * 100}%` }}
            aria-hidden="true"
          />
        )}
        <span
          className="health-fill"
          style={{
            width: unit.hasInfiniteHealth
              ? '100%'
              : `${Math.max(0, unit.currentHealth / unit.maximumHealth * 100)}%`,
          }}
        />
      </div>
      <small className="health-text">{health}</small>
      <div className="unit-detail" role="tooltip">
        <div className="stats-grid">
          {detailFields.map((field) => (
            <Stat key={field.label} label={field.label} value={field.value} />
          ))}
          {exclusiveFields.map((field) => (
            <Stat key={field.label} label={field.label} value={field.value} />
          ))}
        </div>
        <div className="unit-detail-scroll" style={UNIT_DETAIL_SCROLL_STYLE}>
          <p className="unit-statuses">
            状态：{statusDetails.length === 0 ? '无' : statusDetails.join('；')}
          </p>
        </div>
      </div>
    </article>
  )
}

function App() {
  const [page, setPage] = useState<PreBattlePage>('title')
  const [showExitConfirmation, setShowExitConfirmation] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [characterKeys, setCharacterKeys] = useState<readonly UiCharacterKey[]>([])
  const [positions, setPositions] = useState<
    Readonly<Partial<Record<UiCharacterKey, Position>>>
  >({})
  const [bossKey, setBossKey] = useState<UiBossKey | null>(null)
  const [battleState, setBattleState] = useState<BattleState | null>(null)
  const [displayedBattleEvents, setDisplayedBattleEvents] = useState<readonly BattleEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showBattleExitConfirmation, setShowBattleExitConfirmation] = useState(false)
  const [actionPlaybackLocked, setActionPlaybackLocked] = useState(false)
  const [pendingTargetActionId, setPendingTargetActionId] = useState<string | null>(null)
  const [damageHitVersions, setDamageHitVersions] = useState<Readonly<Record<string, number>>>({})
  const [resultOutcome, setResultOutcome] = useState<'victory' | 'defeat' | null>(null)
  const actionSerial = useRef(0)
  const manualPausedBattleState = useRef<BattleState | null>(null)
  const afterActionPlayback = useRef<(() => void) | null>(null)
  const challengeToastTimeout = useRef<ReturnType<typeof createResettableUiTimeout> | null>(null)
  const damageFeedbackScheduler = useRef<ReturnType<typeof createUiDamageFeedbackScheduler> | null>(null)
  const actionPlaybackQueue = useRef<ReturnType<typeof createUiActionPlaybackQueue> | null>(null)

  if (challengeToastTimeout.current === null) {
    challengeToastTimeout.current = createResettableUiTimeout(
      UI_CHALLENGE_TOAST_DURATION_MS,
      () => setToast(null),
    )
  }
  if (damageFeedbackScheduler.current === null) {
    damageFeedbackScheduler.current = createUiDamageFeedbackScheduler((unitId) => {
      setDamageHitVersions((current) => ({
        ...current,
        [unitId]: (current[unitId] ?? 0) + 1,
      }))
    })
  }
  if (actionPlaybackQueue.current === null) {
    actionPlaybackQueue.current = createUiActionPlaybackQueue(
      () => {},
      () => {
        setActionPlaybackLocked(false)
        const next = afterActionPlayback.current
        afterActionPlayback.current = null
        next?.()
      },
      undefined,
      (_group, event) => {
        setDisplayedBattleEvents((current) => [...current, event])
        damageFeedbackScheduler.current?.play([event])
      },
    )
  }

  useEffect(() => () => {
    challengeToastTimeout.current?.cancel()
    damageFeedbackScheduler.current?.cancel()
    actionPlaybackQueue.current?.cancel()
  }, [])

  const stopActionPlayback = () => {
    actionPlaybackQueue.current?.cancel()
    damageFeedbackScheduler.current?.cancel()
    afterActionPlayback.current = null
    setActionPlaybackLocked(false)
  }

  const startActionPlayback = (
    events: readonly BattleEvent[],
    state: BattleState,
  ) => {
    const groups = groupUiBattleEventsByAction(events)
    if (groups.length === 0) {
      setDisplayedBattleEvents((current) => [...current, ...events])
      showPauseWhenNeeded(state)
      return
    }
    setActionPlaybackLocked(true)
    afterActionPlayback.current = () => showPauseWhenNeeded(state)
    actionPlaybackQueue.current?.start(groups)
  }

  const clearPreparation = () => {
    setCharacterKeys([])
    setPositions({})
    setBossKey(null)
    setBattleState(null)
    setError(null)
    setToast(null)
    setResultOutcome(null)
    setPendingTargetActionId(null)
    manualPausedBattleState.current = null
    stopActionPlayback()
    setDisplayedBattleEvents([])
    setDamageHitVersions({})
  }

  const toggleCharacter = (key: UiCharacterKey) => {
    setError(null)
    if (characterKeys.includes(key)) {
      setCharacterKeys(characterKeys.filter((candidate) => candidate !== key))
      setPositions(({ [key]: _removed, ...remaining }) => remaining)
      return
    }
    if (characterKeys.length < 4) {
      setCharacterKeys([...characterKeys, key])
    }
  }

  const updatePosition = (key: UiCharacterKey, position: Position) => {
    setError(null)
    setPositions((current) => ({ ...current, [key]: position }))
  }

  const assignedPositions = characterKeys.map((key) => positions[key])
  const teamIsReady = characterKeys.length >= 1
    && characterKeys.length <= 4
    && assignedPositions.every((position) => position !== undefined)
    && new Set(assignedPositions).size === assignedPositions.length

  const startBattle = () => {
    if (bossKey === null) return
    actionSerial.current = 0
    setResultOutcome(null)
    setPendingTargetActionId(null)
    manualPausedBattleState.current = null
    stopActionPlayback()
    setDamageHitVersions({})
    const result = startUiTrainingBattle({
      characterKeys,
      positions,
      bossKey,
    }, Date.now())
    setBattleState(result.state)
    setDisplayedBattleEvents([])
    setError(result.ok ? null : result.reason ?? '战斗启动失败')
    if (result.ok) {
      setPage('battle')
      startActionPlayback(result.state.events, result.state)
    }
  }

  const showPauseWhenNeeded = (state: BattleState) => {
    if (state.phase === 'paused') setPage('pause')
    if (isUiTrainingResultReady(state)) {
      setResultOutcome('victory')
      setPage('result')
    }
  }

  const performAction = (actionId: string, targetUnitId?: UnitId) => {
    if (battleState === null || actionPlaybackLocked) return
    const action = getUiBattleActions(battleState).find((candidate) => (
      candidate.id === actionId
    ))
    if (targetUnitId === undefined && (action?.targetOptions.length ?? 0) > 0) {
      setPendingTargetActionId(actionId)
      setError(null)
      return
    }
    setPendingTargetActionId(null)
    actionSerial.current += 1
    const result = executeUiBattleAction(
      battleState,
      actionId,
      actionSerial.current,
      targetUnitId,
    )
    setBattleState(result.state)
    setError(result.ok ? null : result.reason ?? '行动失败')
    if (result.ok) startActionPlayback(
      result.state.events.slice(battleState.events.length),
      result.state,
    )
  }

  const endTurn = () => {
    if (battleState === null || actionPlaybackLocked) return
    setPendingTargetActionId(null)
    const result = endUiPlayerTurn(battleState)
    setBattleState(result.state)
    setError(result.ok ? null : result.reason ?? '结束回合失败')
    if (result.ok) startActionPlayback(
      result.state.events.slice(battleState.events.length),
      result.state,
    )
  }

  const pauseBattle = () => {
    if (battleState === null || actionPlaybackLocked) return
    manualPausedBattleState.current = battleState
    const result = pauseUiTrainingBattle(battleState)
    setBattleState(result.state)
    setDisplayedBattleEvents(result.state.events)
    setError(result.ok ? null : result.reason ?? '暂停战斗失败')
    if (result.ok) setPage('pause')
    else manualPausedBattleState.current = null
  }

  const resumeBattle = () => {
    const pausedState = manualPausedBattleState.current
    if (pausedState === null || getUiTrainingPauseReason(battleState ?? pausedState) !== 'MANUAL_PAUSE') return
    const resumed = resumeUiTrainingBattle(battleState ?? pausedState, pausedState)
    if (!resumed.ok) {
      setError(resumed.reason ?? '继续战斗失败')
      return
    }
    stopActionPlayback()
    setBattleState(resumed.state)
    setDisplayedBattleEvents(resumed.state.events)
    setError(null)
    manualPausedBattleState.current = null
    setPage('battle')
  }

  const endBattleAsDefeat = () => {
    if (battleState === null) return
    const result = endUiTrainingBattleAsDefeat(battleState)
    if (result === null) {
      setError('训练结果不可用')
      return
    }
    stopActionPlayback()
    manualPausedBattleState.current = null
    setBattleState(result.state)
    setResultOutcome(result.outcome)
    setError(null)
    setPage('result')
  }

  const resetBattle = () => {
    if (battleState === null) return
    actionSerial.current = 0
    stopActionPlayback()
    const result = resetUiTrainingBattle(battleState)
    setBattleState(result.state)
    setDisplayedBattleEvents([])
    setError(result.ok ? null : result.reason ?? '重置战斗失败')
    setResultOutcome(null)
    setPendingTargetActionId(null)
    manualPausedBattleState.current = null
    setDamageHitVersions({})
    if (result.ok) {
      setPage(result.state.phase === 'paused' ? 'pause' : 'battle')
      startActionPlayback(result.state.events, result.state)
    }
  }

  const exitFinishedBattle = () => {
    if (battleState === null) return
    stopActionPlayback()
    const result = requestUiTrainingExit(
      battleState,
      TrainingExitConfirmation.Confirmed,
    )
    setBattleState(result.state)
    setError(result.reason ?? null)
    if (result.returnToModeSelection) {
      setBattleState(null)
      setPage('mode')
    }
  }

  const requestBattleExit = () => {
    if (battleState === null) return
    stopActionPlayback()
    const result = requestUiTrainingExit(
      battleState,
      TrainingExitConfirmation.NotProvided,
    )
    setBattleState(result.state)
    setError(result.reason ?? null)
    if (result.status === 'confirmationRequired') setShowBattleExitConfirmation(true)
  }

  const confirmBattleExit = () => {
    if (battleState === null) return
    stopActionPlayback()
    const result = requestUiTrainingExit(
      battleState,
      TrainingExitConfirmation.Confirmed,
    )
    setBattleState(result.state)
    setError(result.reason ?? null)
    setShowBattleExitConfirmation(false)
    if (result.returnToModeSelection) {
      setBattleState(null)
      setPage('mode')
    }
  }

  const cancelBattleExit = () => {
    if (battleState !== null) {
      const result = requestUiTrainingExit(
        battleState,
        TrainingExitConfirmation.Cancelled,
      )
      setBattleState(result.state)
      setError(result.reason ?? null)
    }
    setShowBattleExitConfirmation(false)
    setPage('pause')
  }

  const isPositionTaken = (key: UiCharacterKey, position: Position) => (
    characterKeys.some((candidate) => (
      candidate !== key && positions[candidate] === position
    ))
  )

  const battleUnits = battleState?.units ?? []
  const playerFormationSlots = getUiPlayerFormationSlots(battleUnits)
  const enemyUnits = battleUnits.filter((unit) => unit.camp === 'enemy')
  const currentTurnUnitId = battleState?.personalTurn?.unitId
  const currentUnit = currentTurnUnitId === undefined
    ? null
    : battleUnits.find((unit) => (
        unit.id === currentTurnUnitId
      )) ?? null
  const playedBattleState = battleState === null
    ? null
    : { ...battleState, events: displayedBattleEvents }
  const visibleBattleEvents = playedBattleState === null ? [] : getUiBattleEvents(playedBattleState)
  const recentEvents = visibleBattleEvents.slice(-18).reverse()
  const allBattleEvents = visibleBattleEvents.slice().reverse()
  const availableActions = getUiBattleActions(battleState)
  const pendingTargetAction = availableActions.find((action) => (
    action.id === pendingTargetActionId
  )) ?? null
  const isReadOnlyBattlefield = page === 'pausedBattlefield'
  const pauseReason = battleState === null ? null : getUiTrainingPauseReason(battleState)
  const canResumeBattle = pauseReason === 'MANUAL_PAUSE' && manualPausedBattleState.current !== null
  const trainingStatistics: TrainingStatistics | null = battleState === null
    ? null
    : getUiTrainingStatistics(battleState)

  return (
    <main className={page === 'battle' || page === 'pausedBattlefield' ? 'battle-app' : 'flow-app'}>
      {toast !== null && <div className="flow-toast" role="status">{toast}</div>}

      {page === 'title' && (
        <section className="flow-page flow-page--title">
          <p className="eyebrow">回合制战斗测试版</p>
          <h1>《简单的回合制大冒险》</h1>
          <div className="flow-actions">
            <button type="button" onClick={() => setPage('mode')}>开始游戏</button>
            <button type="button" className="flow-button--quiet" onClick={() => setShowExitConfirmation(true)}>
              退出游戏
            </button>
          </div>
          {showExitConfirmation && (
            <div className="flow-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-title">
              <h2 id="exit-title">确认退出游戏？</h2>
              <p>当前准备状态会被清除，网页版会停留在初始页。</p>
              <div className="flow-actions">
                <button
                  type="button"
                  onClick={() => {
                    clearPreparation()
                    setShowExitConfirmation(false)
                    setPage('title')
                  }}
                >
                  确认退出
                </button>
                <button type="button" className="flow-button--quiet" onClick={() => setShowExitConfirmation(false)}>
                  取消
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {page === 'mode' && (
        <section className="flow-page">
          <p className="eyebrow">第一步</p>
          <h1>选择模式</h1>
          <p>目前仅训练模式可进入后续流程。</p>
          <div className="flow-actions">
            <button type="button" onClick={() => setPage('team')}>训练模式</button>
            <button
              type="button"
              className="flow-button--quiet"
              onClick={() => {
                setToast('开发中，不要再点啦！')
                challengeToastTimeout.current?.restart()
              }}
            >
              挑战模式
            </button>
          </div>
        </section>
      )}

      {page === 'team' && (
        <section className="flow-page">
          <p className="eyebrow">训练模式 · 第二步</p>
          <h1>队伍与站位</h1>
          <p>选择 1 至 4 名不重复角色，并为每名角色分配一个站位。</p>
          <div className="team-list">
            {UI_CHARACTER_DEFINITIONS.map((character) => {
              const selected = characterKeys.includes(character.key)
              return (
                <article className="team-option" key={character.key}>
                  <div>
                    <h2>{character.name}</h2>
                    <p>{selected ? '已加入队伍' : '未加入队伍'}</p>
                  </div>
                  <button
                    type="button"
                    className={selected ? 'flow-button--quiet' : undefined}
                    disabled={!selected && characterKeys.length >= 4}
                    onClick={() => toggleCharacter(character.key)}
                  >
                    {selected ? '移出队伍' : '加入队伍'}
                  </button>
                  {selected && (
                    <label className="position-select">
                      站位
                      <select
                        value={positions[character.key] ?? ''}
                        onChange={(event) => updatePosition(
                          character.key,
                          event.target.value as Position,
                        )}
                      >
                        <option value="">请选择</option>
                        {UI_POSITION_OPTIONS.map((position) => (
                          <option
                            key={position.value}
                            value={position.value}
                            disabled={isPositionTaken(character.key, position.value)}
                          >
                            {position.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </article>
              )
            })}
          </div>
          {error !== null && <p className="flow-error" role="alert">{error}</p>}
          <div className="flow-actions">
            <button type="button" className="flow-button--quiet" onClick={() => setPage('mode')}>返回模式页</button>
            <button type="button" disabled={!teamIsReady} onClick={() => setPage('boss')}>选择 Boss</button>
          </div>
        </section>
      )}

      {page === 'boss' && (
        <section className="flow-page">
          <p className="eyebrow">训练模式 · 第三步</p>
          <h1>选择 Boss</h1>
          <p>每次战斗选择 1 名已开放 Boss。</p>
          <div className="boss-list">
            {UI_BOSS_DEFINITIONS.map((boss) => (
              <label className="boss-option" key={boss.key}>
                <input
                  type="radio"
                  name="boss"
                  checked={bossKey === boss.key}
                  onChange={() => setBossKey(boss.key)}
                />
                <span>{boss.name}</span>
              </label>
            ))}
          </div>
          {error !== null && <p className="flow-error" role="alert">{error}</p>}
          <div className="flow-actions">
            <button type="button" className="flow-button--quiet" onClick={() => setPage('team')}>返回队伍配置</button>
            <button type="button" disabled={bossKey === null} onClick={startBattle}>开始战斗</button>
          </div>
        </section>
      )}

      {page === 'pause' && (
        <section className="flow-page pause-page">
          <p className="eyebrow">训练模式 · 已暂停</p>
          <h1>战斗已暂停</h1>
          <p>战斗不会继续推进，Boss 也不会再行动。</p>
          {error !== null && <p className="flow-error" role="alert">{error}</p>}
          {showBattleExitConfirmation ? (
            <div className="flow-dialog" role="dialog" aria-modal="true" aria-labelledby="battle-exit-title">
              <h2 id="battle-exit-title">确认退出本次训练？</h2>
              <p>确认后返回模式选择。本次暂停中的战斗不会保留。</p>
              <div className="flow-actions">
                <button type="button" onClick={confirmBattleExit}>确认退出</button>
                <button type="button" className="flow-button--quiet" onClick={cancelBattleExit}>取消</button>
              </div>
            </div>
          ) : (
            <div className="flow-actions">
              {canResumeBattle && <button type="button" onClick={resumeBattle}>继续游戏</button>}
              <button type="button" onClick={() => setPage('pausedBattlefield')}>查看战场状态</button>
              <button type="button" className="flow-button--quiet" onClick={resetBattle}>重置战斗</button>
              <button type="button" className="flow-button--danger" onClick={endBattleAsDefeat}>结束战斗</button>
              <button type="button" className="flow-button--danger" onClick={requestBattleExit}>退出战斗</button>
            </div>
          )}
          <section className="full-log" aria-label="完整战斗日志">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">只读记录</p>
                <h2>完整战斗日志</h2>
              </div>
              <span>{allBattleEvents.length} 条</span>
            </div>
            {allBattleEvents.length === 0
              ? <p className="empty-events">暂无战斗事件。</p>
              : (
                  <ol className="event-list event-list--full">
                      {allBattleEvents.map((event, index) => (
                      <li key={`${allBattleEvents.length}-all-${index}`}>
                        {event.text}
                      </li>
                    ))}
                  </ol>
                )}
          </section>
        </section>
      )}

      {page === 'result' && trainingStatistics !== null && (
        <section className="flow-page result-page">
          <p className="eyebrow">训练模式 · 战斗结束</p>
          <h1>{resultOutcome === 'defeat' ? '训练失败' : '训练完成'}</h1>
          <p>
            {resultOutcome === 'defeat'
              ? '本次训练已由玩家结束。以下数据来自本次训练的实际结算事件。'
              : '有限生命 Boss 已被击败。以下数据来自本次训练的实际结算事件。'}
          </p>

          <section className="statistics-section" aria-label="行动序列统计">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">行动序列</p>
                <h2>序列伤害</h2>
              </div>
              <strong>{trainingStatistics.sequenceCount} 个</strong>
            </div>
            <div className="statistics-table-wrap">
              <table className="statistics-table">
                <thead>
                  <tr><th>行动序列</th><th>总伤害</th></tr>
                </thead>
                <tbody>
                  {trainingStatistics.sequences.map((sequence) => (
                    <tr key={sequence.sequenceNumber}>
                      <td>第 {sequence.sequenceNumber} 轮</td>
                      <td>{sequence.totalDamage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="statistics-section" aria-label="角色统计">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">实际参战角色</p>
                <h2>角色统计</h2>
              </div>
            </div>
            <div className="statistics-table-wrap">
              <table className="statistics-table">
                <thead>
                  <tr>
                    <th>角色</th><th>总伤害</th><th>总承伤</th><th>总给予护盾</th><th>总治疗</th>
                  </tr>
                </thead>
                <tbody>
                  {trainingStatistics.units.map((unit) => (
                    <tr key={unit.unitId}>
                      <td>{unit.unitName}</td>
                      <td>{unit.totalDamageDealt}</td>
                      <td>{unit.totalDamageTaken}</td>
                      <td>{unit.totalShieldGranted}</td>
                      <td>{unit.totalHealing}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="flow-actions">
            <button type="button" onClick={resetBattle}>重新开始</button>
            <button type="button" className="flow-button--quiet" onClick={exitFinishedBattle}>退出战斗</button>
          </div>
        </section>
      )}

      {(page === 'battle' || page === 'pausedBattlefield') && (
        <>
          <header className="topbar">
            <div>
              <p className="eyebrow">简单的回合制大冒险 · 训练模式</p>
              <h1>{isReadOnlyBattlefield ? '暂停中的战场状态' : '训练战斗'}</h1>
            </div>
            {isReadOnlyBattlefield
              ? (
                  <button className="reset-button" type="button" onClick={() => setPage('pause')}>
                    返回暂停菜单
                  </button>
                )
              : (
                  <button
                    className="reset-button"
                    type="button"
                    disabled={actionPlaybackLocked}
                    onClick={pauseBattle}
                  >
                    暂停战斗
                  </button>
                )}
          </header>

          <section className="battle-status" aria-live="polite">
            <div>
              <span>当前行动者</span>
              <strong>{currentUnit?.name ?? '尚未开始'}</strong>
            </div>
            <div>
              <span>战斗阶段</span>
              <strong>{battleState === null ? '未开始' : PHASE_NAMES[battleState.phase] ?? battleState.phase}</strong>
            </div>
            <div>
              <span>回合阶段</span>
              <strong>
                {battleState?.personalTurn === null || battleState?.personalTurn === undefined
                  ? '—'
                  : PERSONAL_TURN_PHASE_NAMES[battleState.personalTurn.phase]
                    ?? battleState.personalTurn.phase}
              </strong>
            </div>
            <div>
              <span>轮次</span>
              <strong>{battleState?.turnSequence?.sequenceNumber ?? '—'}</strong>
            </div>
          </section>

          <section className="combatants" aria-label="战斗双方">
            <div className="combatant-group player-formation">
              {playerFormationSlots.map((unit, index) => (
                unit === null
                  ? <div className="unit-placeholder" key={UI_POSITION_OPTIONS[index].value} aria-hidden="true" />
                  : <UnitCard
                      key={`${unit.id}:${damageHitVersions[unit.id] ?? 0}`}
                    unit={unit}
                    player
                    details={battleState === null ? null : getUiUnitDetails(battleState, unit.id)}
                    hitVersion={damageHitVersions[unit.id] ?? 0}
                    />
              ))}
            </div>
            <div className="versus">VS</div>
            <div className="combatant-group">
              {enemyUnits.map((unit) => (
                <UnitCard
                  key={`${unit.id}:${damageHitVersions[unit.id] ?? 0}`}
                  unit={unit}
                  player={false}
                  details={battleState === null ? null : getUiUnitDetails(battleState, unit.id)}
                  hitVersion={damageHitVersions[unit.id] ?? 0}
                />
              ))}
            </div>
          </section>

          <section className="lower-grid">
            <div className="panel actions-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">{isReadOnlyBattlefield ? '只读视图' : '当前行动'}</p>
                  <h2>行动</h2>
                </div>
                <span>
                  {isReadOnlyBattlefield
                    ? '暂停时不会继续推进战斗'
                    : actionPlaybackLocked ? '效果播放中…' : '技能规则由 BattleEngine 结算'}
                </span>
              </div>
              {isReadOnlyBattlefield
                ? <p className="empty-events">此处只显示暂停时的战场状态；请返回暂停菜单进行重置或退出。</p>
                : availableActions.length === 0
                  ? <p className="empty-events">当前没有可由玩家执行的行动。</p>
                : (
                    <div className="action-grid">
                      {availableActions.map((action) => (
                        <ActionButton
                          key={action.id}
                          label={action.label}
                          detail={action.detail}
                          resourceCost={action.resourceCost}
                          targetRule={action.targetRule}
                          description={action.description}
                          effectDetails={action.effectDetails}
                          reason={actionPlaybackLocked ? '效果播放中，请稍候' : action.unavailableReason}
                          onClick={() => performAction(action.id)}
                        />
                      ))}
                      <ActionButton
                        label="主动结束回合"
                        detail="执行回合结束效果并交给敌方行动"
                        resourceCost="无消耗"
                        targetRule="无目标"
                        description="执行当前角色的回合结束效果，并继续后续行动。"
                        effectDetails={['效果：执行当前角色的回合结束触发与持续时间结算']}
                        reason={actionPlaybackLocked ? '效果播放中，请稍候' : null}
                        onClick={endTurn}
                        tone="secondary"
                      />
                      {pendingTargetAction !== null && (
                        <div className="friendly-target-selector" role="group" aria-label="选择友方目标">
                          <strong>为{pendingTargetAction.label}选择目标</strong>
                          <div className="friendly-target-options">
                            {pendingTargetAction.targetOptions.map((target) => (
                              <button
                                key={target.unitId}
                                type="button"
                                onClick={() => performAction(
                                  pendingTargetAction.id,
                                  target.unitId,
                                )}
                              >
                                {target.label}
                              </button>
                            ))}
                          </div>
                          <button
                            className="friendly-target-cancel"
                            type="button"
                            onClick={() => setPendingTargetActionId(null)}
                          >
                            取消
                          </button>
                        </div>
                      )}
                    </div>
                  )}
              {error !== null && (
                <div className="error-message" role="alert">
                  <strong>操作失败</strong>
                  <span>{error}</span>
                </div>
              )}
            </div>

            <aside className="panel event-panel" aria-live="polite" aria-relevant="additions text">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">实时记录</p>
                  <h2>战斗事件</h2>
                </div>
                <span>最新在前</span>
              </div>
              {recentEvents.length === 0
                ? <p className="empty-events">战斗开始后，这里会显示引擎事件。</p>
                : (
                    <ol className="event-list">
                      {recentEvents.map((event, index) => (
                        <li key={`${battleState?.events.length ?? 0}-${index}`}>
                          {event.text}
                        </li>
                      ))}
                    </ol>
                  )}
            </aside>
          </section>
        </>
      )}
    </main>
  )
}

export default App
