import axios from 'axios'

export type OpenAIMessageContent =
  | string
  | Array<
      | string
      | {
          type?: string
          text?: string
        }
    >

type OpenAIChoice = {
  message?: {
    content?: OpenAIMessageContent
  }
}

export type OpenAIResponse = {
  choices?: OpenAIChoice[]
  error?: {
    message?: string
    code?: string
  }
}

export async function requestChatCompletion(
  endpoint: string,
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<OpenAIResponse> {
  const response = await axios.post<OpenAIResponse>(endpoint, payload, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: timeoutMs,
    responseType: 'json',
    responseEncoding: 'utf8',
  })

  return response.data
}

export function extractAxiosErrorMessage(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return 'Unknown error'
  }

  const responseError = error.response?.data
  if (
    typeof responseError === 'object' &&
    responseError &&
    'error' in responseError &&
    typeof responseError.error === 'object' &&
    responseError.error &&
    'message' in responseError.error &&
    typeof responseError.error.message === 'string'
  ) {
    return responseError.error.message
  }

  return error.message
}

export function extractMessageContent(data: OpenAIResponse): string {
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    return ''
  }

  let text: string
  if (typeof content === 'string') {
    text = content.trim()
  } else {
    text = content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }

        return typeof part.text === 'string' ? part.text : ''
      })
      .join('')
      .trim()
  }

  // Extract content between BEGIN_TRANSCRIPT and END_TRANSCRIPT markers
  const beginMarker = 'BEGIN_TRANSCRIPT'
  const endMarker = 'END_TRANSCRIPT'
  const beginIndex = text.indexOf(beginMarker)
  const endIndex = text.indexOf(endMarker)

  if (beginIndex !== -1 && endIndex !== -1 && endIndex > beginIndex) {
    return text.slice(beginIndex + beginMarker.length, endIndex).trim()
  }

  // If markers are not found or in wrong order, return the original text
  return text
}
