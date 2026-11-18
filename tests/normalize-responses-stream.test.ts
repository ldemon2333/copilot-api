import { expect, test } from "bun:test"

import { normalizeResponsesStream } from "../src/routes/responses/normalize-stream"

interface ParsedEvent {
  type: string
  item_id?: string
  item?: { id?: string }
}

const streamOf = (chunks: Array<string>) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })

const readAll = (stream: ReadableStream<Uint8Array>) =>
  new Response(stream).text()

const toSse = (events: Array<object>) =>
  events
    .map(
      (event) =>
        `event: ${(event as ParsedEvent).type}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join("")

test("rewrites later item ids to the id from output_item.added", async () => {
  const sse = toSse([
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { id: "A", type: "message" },
    },
    {
      type: "response.output_text.delta",
      output_index: 0,
      item_id: "B",
      delta: "po",
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: { id: "C", type: "message" },
    },
  ])

  // Split mid-line so the line buffering is exercised.
  const output = await readAll(
    normalizeResponsesStream(streamOf([sse.slice(0, 61), sse.slice(61)])),
  )
  const events = output
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5)) as ParsedEvent)

  expect(events[1].item_id).toBe("A")
  expect(events[2].item?.id).toBe("A")
})

test("passes consistent streams through byte-for-byte", async () => {
  const input =
    'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"A"}}\n\n'
    + 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"item_id":"A","delta":"x"}\n\n'
    + "data: [DONE]\n\n"

  expect(await readAll(normalizeResponsesStream(streamOf([input])))).toBe(input)
})
