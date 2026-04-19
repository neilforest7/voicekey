import type { ASRConfig } from '../shared/types'
import { GLMASRProvider } from './asr-providers/glm-provider'
import { VolcengineASRProvider } from './asr-providers/volcengine-provider'

export interface TranscriptionResult {
  text: string
  id: string
  created: number
  model: string
}

export interface TranscribeAudioOptions {
  prompt?: string
  requestId?: string
  sourceAudioFilePath?: string
  sourceMimeType?: string
}

export interface ASRProvider {
  transcribe(audioFilePath: string, options?: TranscribeAudioOptions): Promise<TranscriptionResult>
  testConnection(): Promise<boolean>
}

export function createASRProvider(config: ASRConfig): ASRProvider {
  switch (config.provider) {
    case 'volcengine':
      return new VolcengineASRProvider(config)
    case 'glm':
    default:
      return new GLMASRProvider(config)
  }
}
