import { afterEach, beforeEach, expect, mock, test } from "bun:test"

import { state } from "../src/lib/state"
import {
  createResponses,
  hasImageInput,
  isAgentInitiated,
} from "../src/services/copilot/create-responses"

state.copilotToken = "test-token"
state.vsCodeVersion = "1.0.0"
state.accountType = "individual"

interface FetchInit {
  headers: Record<string, string>
  body: string
}

const originalFetch = globalThis.fetch
const fetchMock = mock(
  (_url: string, _init: FetchInit) =>
    new Response('{"id":"resp_1"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
)

beforeEach(() => {
  fetchMock.mockClear()
  ;(globalThis as unknown as { fetch: unknown }).fetch = fetchMock
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("forwards the payload unchanged to Copilot /responses", async () => {
  const payload = {
    model: "gpt-test",
    input: "hi",
    stream: true,
    reasoning: { effort: "xhigh" },
  }
  const response = await createResponses(payload)

  expect(response.status).toBe(200)
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe("https://api.githubcopilot.com/responses")
  expect(JSON.parse(init.body)).toEqual(payload)
  expect(init.headers["X-Initiator"]).toBe("user")
  expect(init.headers["copilot-vision-request"]).toBeUndefined()
})

test("returns upstream errors untouched", async () => {
  fetchMock.mockImplementationOnce(
    () =>
      new Response('{"error":{"code":"unsupported_api_for_model"}}', {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
  )
  const response = await createResponses({ model: "gpt-test", input: "hi" })

  expect(response.status).toBe(400)
  expect(await response.text()).toContain("unsupported_api_for_model")
})

test("sets the vision header when a tool output carries an image", async () => {
  await createResponses({
    model: "gpt-test",
    input: [
      {
        type: "function_call_output",
        call_id: "call_1",
        output: [
          { type: "input_image", image_url: "data:image/png;base64,AA==" },
        ],
      },
    ],
  })

  const [, init] = fetchMock.mock.calls[0]
  expect(init.headers["copilot-vision-request"]).toBe("true")
  expect(init.headers["X-Initiator"]).toBe("agent")
})

test("hasImageInput finds images at any depth", () => {
  expect(hasImageInput("plain text")).toBe(false)
  expect(
    hasImageInput([
      { role: "user", content: [{ type: "input_text", text: "hi" }] },
    ]),
  ).toBe(false)
  expect(
    hasImageInput([
      { role: "user", content: [{ type: "input_image", image_url: "data:" }] },
    ]),
  ).toBe(true)
})

test("isAgentInitiated treats tool, assistant and chained turns as agent calls", () => {
  expect(isAgentInitiated({ model: "m", input: "hi" })).toBe(false)
  expect(
    isAgentInitiated({
      model: "m",
      input: [
        { role: "developer", content: "rules" },
        { type: "message", role: "user", content: "hi" },
      ],
    }),
  ).toBe(false)
  expect(
    isAgentInitiated({
      model: "m",
      input: [
        { role: "user", content: "hi" },
        { type: "function_call_output", call_id: "c1", output: "ok" },
      ],
    }),
  ).toBe(true)
  expect(
    isAgentInitiated({
      model: "m",
      input: [{ role: "assistant", content: "done" }],
    }),
  ).toBe(true)
  expect(
    isAgentInitiated({
      model: "m",
      input: "next",
      previous_response_id: "resp_1",
    }),
  ).toBe(true)
})
