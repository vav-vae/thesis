type ProgressEvent<T> = {
  type?: string;
  stage?: string;
  detail?: string;
  result?: T;
};

export async function readProgressStream<T>(
  response: Response,
  onProgress?: (stage: string) => void,
): Promise<T> {
  let complete: T | undefined;

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    let event: ProgressEvent<T>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") throw new Error("Invalid progress event");
      event = parsed as ProgressEvent<T>;
    } catch {
      throw new Error("The panorama processor sent an unreadable progress update.");
    }
    if (event.type === "progress" && typeof event.stage === "string") onProgress?.(event.stage);
    if (event.type === "error") throw new Error(event.detail || "The panorama processor could not finish this tour.");
    if (event.type === "complete") complete = event.result;
  };

  const reader = response.body?.getReader();
  if (!reader) {
    (await response.text()).split("\n").forEach(consumeLine);
  } else {
    const decoder = new TextDecoder();
    let pending = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        lines.forEach(consumeLine);
        if (done) break;
      }
      consumeLine(pending);
    } finally {
      reader.releaseLock();
    }
  }

  if (complete === undefined) throw new Error("The panorama processor stopped before sending a result.");
  return complete;
}
