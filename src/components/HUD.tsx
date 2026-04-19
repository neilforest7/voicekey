import { useEffect, useState } from 'react'
import { Check, Mic, X, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { OverlayProcessingStage, OverlayState } from '../../electron/shared/types'
import { Waveform } from './Waveform'

const PROCESSING_STEPS: OverlayProcessingStage[] = ['transcribing', 'refining']

export function HUD() {
  const { t } = useTranslation()
  const [overlayState, setOverlayState] = useState<OverlayState>({ status: 'recording' })
  const [audioLevel, setAudioLevel] = useState(0)
  const [isVisible, setIsVisible] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  useEffect(() => {
    document.documentElement.classList.add('overlay-html')
    requestAnimationFrame(() => setIsVisible(true))
    return () => document.documentElement.classList.remove('overlay-html')
  }, [])

  useEffect(() => {
    const removeOverlayUpdateListener = window.electronAPI.onOverlayUpdate(
      (state: OverlayState) => {
        setOverlayState(state)
      },
    )

    const removeAudioLevelListener = window.electronAPI.onAudioLevel((level: number) => {
      setAudioLevel(level)
    })

    return () => {
      removeOverlayUpdateListener?.()
      removeAudioLevelListener?.()
    }
  }, [])

  const handleCancel = () => {
    window.electronAPI.cancelSession()
  }

  const getProcessingTitle = (stage: OverlayProcessingStage | undefined): string => {
    switch (stage) {
      case 'transcribing':
        return t('hud.transcribing')
      case 'refining':
        return t('hud.refining')
      default:
        return t('hud.thinking')
    }
  }

  const getProcessingStepLabel = (stage: OverlayProcessingStage): string => {
    switch (stage) {
      case 'transcribing':
        return t('hud.stepTranscribing')
      case 'refining':
        return t('hud.stepRefining')
    }
  }

  const { status, message, processingStage, processingTotalStages } = overlayState
  const showDetailedProcessing = status === 'processing' && Boolean(processingStage)
  const visibleProcessingSteps =
    processingTotalStages === 1 ? PROCESSING_STEPS.slice(0, 1) : PROCESSING_STEPS
  const currentProcessingIndex = processingStage ? PROCESSING_STEPS.indexOf(processingStage) : -1

  return (
    <div className="fixed inset-0 flex items-center justify-center pointer-events-none">
      <div
        className="relative pointer-events-auto"
        onMouseEnter={() => {
          setIsHovered(true)
          window.electronAPI.setIgnoreMouseEvents(false)
        }}
        onMouseLeave={() => {
          setIsHovered(false)
          window.electronAPI.setIgnoreMouseEvents(true, { forward: true })
        }}
      >
        <div
          className={`
            relative
            ${status === 'success' ? 'h-8 w-8' : 'flex w-[248px] items-center gap-3'} rounded-full bg-neutral-900/90 ${status === 'success' ? '' : 'p-2'}
            backdrop-blur-xl
            transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]
            ${isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95'}
          `}
        >
          {status === 'success' ? (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/20">
              <Check className="h-4 w-4" strokeWidth={3} />
            </div>
          ) : (
            <>
              <div
                className={`
                  relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full shadow-lg transition-all duration-500
                  ${status === 'recording' ? 'bg-linear-to-br from-red-500 to-orange-600 text-white shadow-red-500/20' : ''}
                  ${status === 'processing' ? 'border border-neutral-700 bg-neutral-800 text-indigo-300' : ''}
                  ${status === 'error' ? 'border border-red-500/30 bg-red-900/50 text-red-500' : ''}
                `}
              >
                {status === 'recording' && (
                  <>
                    <div className="absolute inset-0 animate-pulse bg-white/20"></div>
                    <Mic className="relative z-10 h-3.5 w-3.5" />
                  </>
                )}
                {status === 'processing' && (
                  <div className="relative flex h-full w-full items-center justify-center">
                    <div className="absolute inset-0 animate-spin rounded-full border-2 border-b-indigo-900 border-l-transparent border-r-transparent border-t-indigo-500"></div>
                    <Zap className="h-3.5 w-3.5 text-indigo-400" fill="currentColor" />
                  </div>
                )}
                {status === 'error' && <X className="h-3.5 w-3.5" strokeWidth={3} />}
              </div>

              <div className="flex min-h-[40px] flex-1 flex-col justify-center items-center overflow-hidden px-1">
                {status === 'recording' && (
                  <div className="flex w-full items-center justify-center gap-3">
                    <Waveform audioLevel={audioLevel} />
                  </div>
                )}

                {status === 'processing' &&
                  (showDetailedProcessing ? (
                    <div className="flex w-full flex-col items-center gap-2 py-1">
                      <div className="text-sm font-medium text-white">
                        {getProcessingTitle(processingStage)}
                      </div>
                      <div className="flex items-center justify-center gap-2 w-full">
                        {visibleProcessingSteps.map((step, index) => {
                          const isCurrent = step === processingStage
                          const isCompleted = currentProcessingIndex > index

                          return (
                            <div
                              key={step}
                              className={`
                                min-w-[56px] rounded-full border px-2 py-1 text-center text-[10px] font-medium transition-colors
                                ${
                                  isCurrent
                                    ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-100'
                                    : ''
                                }
                                ${isCompleted ? 'border-white/10 bg-white/10 text-white/80' : ''}
                                ${
                                  !isCurrent && !isCompleted
                                    ? 'border-neutral-800 bg-neutral-900/70 text-neutral-500'
                                    : ''
                                }
                              `}
                            >
                              {getProcessingStepLabel(step)}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full justify-center px-1">
                      <span className="w-full animate-pulse text-sm font-medium text-white">
                        {t('hud.thinking')}
                      </span>
                    </div>
                  ))}

                {status === 'error' && (
                  <div className="flex flex-col px-1">
                    <span className="line-clamp-1 text-sm font-medium text-red-400">
                      {t('hud.error')}
                    </span>
                    <span
                      className="line-clamp-1 max-w-[200px] text-xs text-neutral-500"
                      title={message}
                    >
                      {message || t('hud.errorFallback')}
                    </span>
                  </div>
                )}
              </div>

              {isHovered && (
                <div className="absolute right-3 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900/90 text-neutral-400 shadow-lg backdrop-blur-xl transition-opacity duration-200 pointer-events-auto">
                  <button
                    onClick={handleCancel}
                    className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-white/10 hover:text-red-400"
                    title={t('hud.cancel')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
