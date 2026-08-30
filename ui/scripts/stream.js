const MAX_EVENT_BYTES = 4 * 1024 * 1024;

/** Read newline-delimited JSON from a fetch response without waiting for EOF. */
export async function readNdjson(response, onEvent) {
  if (!response.body?.getReader) {
    throw new Error('This browser does not support hosted progress streaming.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventCount = 0;

  const consumeLine = async rawLine => {
    const line = rawLine.trim();
    if (!line) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error('The hosted capture returned an invalid progress event.');
    }
    eventCount += 1;
    await onEvent(event);
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    if (buffer.length > MAX_EVENT_BYTES && !buffer.includes('\n')) {
      throw new Error('A hosted progress event exceeded the safe size limit.');
    }

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) await consumeLine(line);
    if (done) break;
  }

  if (buffer.trim()) await consumeLine(buffer);
  return eventCount;
}
