import consola from "consola"

import { copilotBaseUrl, copilotHeaders } from "~/lib/api-config"
import { state } from "~/lib/state"

/**
 * OpenAI Responses API request body. It is forwarded to Copilot verbatim;
 * only the fields used to build Copilot headers are typed here.
 */
export interface ResponsesPayload {
  model: string
  input?: string | Array<unknown> | null
  stream?: boolean | null
  previous_response_id?: string | null
  [key: string]: unknown
}

export const createResponses = async (
  payload: ResponsesPayload,
): Promise<Response> => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const headers: Record<string, string> = {
    ...copilotHeaders(state, hasImageInput(payload.input)),
    "X-Initiator": isAgentInitiated(payload) ? "agent" : "user",
  }

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    consola.error(
      `Copilot /responses returned ${response.status} for model ${payload.model}`,
    )
  }

  return response
}

/** True when any input item carries an image part, which needs the vision header. */
export const hasImageInput = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some((item) => hasImageInput(item))
  if (value === null || typeof value !== "object") return false

  const record = value as Record<string, unknown>
  if (record.type === "input_image") return true
  return Object.values(record).some((item) => hasImageInput(item))
}

/**
 * Mirrors the chat completions rule: a conversation that already contains
 * assistant output or tool items, or that chains a previous response, is an
 * agent call.
 */
export const isAgentInitiated = (payload: ResponsesPayload): boolean => {
  if (payload.previous_response_id) return true
  if (!Array.isArray(payload.input)) return false

  return payload.input.some((item) => {
    if (item === null || typeof item !== "object") return false
    const { role, type } = item as { role?: unknown; type?: unknown }
    if (role === "assistant") return true
    return type !== undefined && type !== "message"
  })
}
