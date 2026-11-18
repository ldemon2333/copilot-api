interface StreamEvent {
  type?: string
  output_index?: number
  item_id?: string
  item?: { id?: string }
  [key: string]: unknown
}

const parseDataLine = (line: string): StreamEvent | undefined => {
  if (!line.startsWith("data:")) return undefined
  const raw = line.slice(5).trim()
  if (!raw || raw === "[DONE]") return undefined
  try {
    return JSON.parse(raw) as StreamEvent
  } catch {
    return undefined
  }
}

/** Points the event at `canonicalId`; returns whether anything changed. */
const applyCanonicalId = (event: StreamEvent, canonicalId: string): boolean => {
  let changed = false
  if (typeof event.item_id === "string" && event.item_id !== canonicalId) {
    event.item_id = canonicalId
    changed = true
  }
  if (
    event.type === "response.output_item.done"
    && typeof event.item?.id === "string"
    && event.item.id !== canonicalId
  ) {
    event.item.id = canonicalId
    changed = true
  }
  return changed
}

/**
 * Copilot can label the events of one output item with different ids. Rewrite
 * the events of each output_index to the id announced by its
 * `response.output_item.added` event so clients can stitch deltas together.
 * Lines that need no change are passed through byte-for-byte.
 */
export function normalizeResponsesStream(
  body: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const canonicalIds = new Map<number, string>()
  let buffered = ""

  const normalizeLine = (line: string): string => {
    const event = parseDataLine(line)
    const index = event?.output_index
    if (!event || typeof index !== "number") return line

    if (event.type === "response.output_item.added") {
      if (typeof event.item?.id === "string") {
        canonicalIds.set(index, event.item.id)
      }
      return line
    }

    const canonicalId = canonicalIds.get(index)
    if (canonicalId === undefined) return line
    if (event.type === "response.output_item.done") canonicalIds.delete(index)

    return applyCanonicalId(event, canonicalId) ?
        `data: ${JSON.stringify(event)}`
      : line
  }

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffered += decoder.decode(chunk, { stream: true })
        const lines = buffered.split("\n")
        buffered = lines.pop() ?? ""
        for (const line of lines) {
          controller.enqueue(encoder.encode(`${normalizeLine(line)}\n`))
        }
      },
      flush(controller) {
        buffered += decoder.decode()
        if (buffered)
          controller.enqueue(encoder.encode(normalizeLine(buffered)))
      },
    }),
  )
}
