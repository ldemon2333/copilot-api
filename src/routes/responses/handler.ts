import type { Context } from "hono"

import consola from "consola"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createResponses,
  type ResponsesPayload,
} from "~/services/copilot/create-responses"

import { normalizeResponsesStream } from "./normalize-stream"

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  const payload = await c.req.json<ResponsesPayload>()
  consola.debug("Request payload:", JSON.stringify(payload).slice(-400))

  if (state.manualApprove) await awaitApproval()

  const upstream = await createResponses(payload)

  // Relay Copilot's answer: SSE events when streaming (with item ids made
  // consistent), JSON otherwise, and Copilot's own error body on failure.
  const contentType = upstream.headers.get("content-type") ?? "application/json"
  const body =
    upstream.body && contentType.includes("text/event-stream") ?
      normalizeResponsesStream(upstream.body)
    : upstream.body

  return new Response(body, {
    status: upstream.status,
    headers: { "content-type": contentType },
  })
}
