import { HttpResponseError } from "./http-response.ts";

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
  let lastStage = "";

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    let event: ProgressEvent<T>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") throw new Error("Invalid progress event");
      event = parsed as ProgressEvent<T>;
    } catch {
      throw new HttpResponseError("The panorama processor sent an unreadable progress update.", response);
    }
    if (event.type === "progress" && typeof event.stage === "string") {
      lastStage = event.stage;
      onProgress?.(event.stage);
    }
    if (event.type === "error") throw new HttpResponseError(event.detail || "The panorama processor could not finish this tour.", response);
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
    } catch (error) {
      if (error instanceof HttpResponseError) throw error;
      throw new HttpResponseError("The panorama response stream was interrupted.", response, { cause: error });
    } finally {
      reader.releaseLock();
    }
  }

  if (complete === undefined) throw new HttpResponseError(`The panorama processor stopped before sending a result${lastStage ? ` during “${lastStage}”` : ""}. Your photos are still on this page; try generating again.`, response);
  return complete;
}
