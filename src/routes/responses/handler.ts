import type { Context } from "hono"

import consola from "consola"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createResponses,
  type ResponsesPayload,
} from "~/services/copilot/create-responses"

export async function handleResponses(c: Context) {
  await checkRateLimit(state)

  const payload = await c.req.json<ResponsesPayload>()
  consola.debug("Request payload:", JSON.stringify(payload).slice(-400))

  if (state.manualApprove) await awaitApproval()

  const upstream = await createResponses(payload)

  // Relay Copilot's answer untouched: SSE events when streaming, JSON
  // otherwise, and Copilot's own error body when the request fails.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    },
  })
}
