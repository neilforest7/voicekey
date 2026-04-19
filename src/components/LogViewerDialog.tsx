import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  LOG_FILE_MAX_SIZE_MB,
  LOG_RETENTION_DAYS,
  LOG_TAIL_MAX_BYTES,
} from '@electron/shared/constants'

type LogEntry = {
  timestamp: string
  level: string
  scope: string
  message: string
}

type LogViewMode = 'table' | 'text'

// Format: 2026-04-19 12:34:56.789 [INFO] [main] some log text
const LOG_LINE_REGEX =
  /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+\[(\w+)\]\s+\[([^\]]*)\]\s*(.*)/

function parseLogEntries(raw: string): LogEntry[] {
  if (!raw) return []
  const lines = raw.split('\n')
  const entries: LogEntry[] = []
  let pending: LogEntry | null = null

  for (const line of lines) {
    const match = LOG_LINE_REGEX.exec(line)
    if (match) {
      if (pending) entries.push(pending)
      pending = {
        timestamp: match[1],
        level: match[2],
        scope: match[3],
        message: match[4],
      }
    } else if (pending && line) {
      pending.message += `\n${line}`
    }
  }
  if (pending) entries.push(pending)
  return entries
}

const LEVEL_COLORS: Record<string, string> = {
  ERROR: 'text-red-500',
  WARN: 'text-yellow-500',
  INFO: 'text-blue-400',
  DEBUG: 'text-neutral-400',
}

interface LogViewerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LogViewerDialog({ open, onOpenChange }: LogViewerDialogProps) {
  const { t } = useTranslation()
  const [logContent, setLogContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [viewMode, setViewMode] = useState<LogViewMode>('table')

  const maxKb = Math.round(LOG_TAIL_MAX_BYTES / 1024)

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const content = await window.electronAPI.getLogTail({ maxBytes: LOG_TAIL_MAX_BYTES })
      setLogContent(content)
    } catch (error) {
      console.error('Failed to load logs:', error)
      toast.error(t('settings.logLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (open) {
      void loadLogs()
    }
  }, [open, loadLogs])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(logContent)
      toast.success(t('settings.logCopied'))
    } catch (error) {
      console.error('Failed to copy logs:', error)
      toast.error(t('settings.logCopyFailed'))
    }
  }

  const handleOpenFolder = async () => {
    try {
      await window.electronAPI.openLogFolder()
    } catch (error) {
      console.error('Failed to open log folder:', error)
      toast.error(t('settings.logOpenFailed'))
    }
  }

  const entries = useMemo(() => parseLogEntries(logContent), [logContent])

  const emptyState = t('settings.logEmpty')
  const textContent = loading ? t('common.loading') : logContent || emptyState

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[calc(100vw-4rem)] h-[80vh] flex flex-col">
        <DialogHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1.5">
            <DialogTitle>{t('settings.logDialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings.logDialogDescription', { size: maxKb })}
            </DialogDescription>
          </div>
          <Tabs
            value={viewMode}
            onValueChange={(v) => setViewMode(v as LogViewMode)}
            className="shrink-0"
          >
            <TabsList className="h-7">
              <TabsTrigger value="table" className="text-xs px-2 py-1">
                {t('settings.logViewTable')}
              </TabsTrigger>
              <TabsTrigger value="text" className="text-xs px-2 py-1">
                {t('settings.logViewText')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </DialogHeader>

        {viewMode === 'table' ? (
          <div className="flex-1 min-h-0 overflow-auto rounded-md border border-border/60">
            {loading ? (
              <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                {t('common.loading')}
              </div>
            ) : entries.length === 0 ? (
              <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
                {emptyState}
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium w-44">{t('settings.logColTime')}</th>
                    <th className="px-3 py-2 font-medium w-16">{t('settings.logColLevel')}</th>
                    <th className="px-3 py-2 font-medium w-24">{t('settings.logColScope')}</th>
                    <th className="px-3 py-2 font-medium">{t('settings.logColMessage')}</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {entries.map((entry, i) => (
                    <tr
                      key={i}
                      className="border-b border-border/40 last:border-0 hover:bg-muted/30"
                    >
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                        {entry.timestamp}
                      </td>
                      <td
                        className={cn('px-3 py-1.5 font-semibold', LEVEL_COLORS[entry.level] ?? '')}
                      >
                        {entry.level}
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                        {entry.scope}
                      </td>
                      <td className="px-3 py-1.5 whitespace-pre-wrap break-all">{entry.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto rounded-md border border-border/60 bg-muted/20 p-3 font-mono text-xs whitespace-pre-wrap text-foreground/90">
            {textContent}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadLogs} disabled={loading}>
              {t('settings.logRefresh')}
            </Button>
            <Button variant="outline" size="sm" onClick={handleCopy} disabled={!logContent}>
              {t('settings.logCopy')}
            </Button>
            <Button variant="outline" size="sm" onClick={handleOpenFolder}>
              {t('settings.logOpenFolder')}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground mt-2 sm:mt-0">
            {t('settings.logsRetentionNote', {
              days: LOG_RETENTION_DAYS,
              size: LOG_FILE_MAX_SIZE_MB,
            })}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
