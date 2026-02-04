import { useState, useEffect, useCallback } from 'react'
import type { TranscriptionConfig } from '../types/api'

export function useTranscription() {
  const [isModelReady, setIsModelReady] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [config, setConfig] = useState<TranscriptionConfig | null>(null)

  useEffect(() => {
    // Check if model is ready
    window.api.invoke('transcription:isModelReady').then((ready) => {
      setIsModelReady(ready as boolean)
    })

    // Get config
    window.api.invoke('transcription:getConfig').then((cfg) => {
      setConfig(cfg as TranscriptionConfig)
    })

    // Listen for download progress
    const unsubscribe = window.api.on('transcription:downloadProgress', (data: unknown) => {
      setDownloadProgress(data as number)
    })

    return () => {
      unsubscribe()
    }
  }, [])

  const downloadModel = useCallback(async () => {
    setIsDownloading(true)
    setDownloadProgress(0)
    const result = await window.api.invoke('transcription:downloadModel')
    setIsDownloading(false)
    if (result) {
      setIsModelReady(true)
    }
    return result as boolean
  }, [])

  const updateConfig = useCallback(async (newConfig: Partial<TranscriptionConfig>) => {
    await window.api.invoke('transcription:setConfig', newConfig)
    setConfig((prev) => (prev ? { ...prev, ...newConfig } : null))
  }, [])

  return {
    isModelReady,
    isDownloading,
    downloadProgress,
    config,
    downloadModel,
    updateConfig
  }
}
