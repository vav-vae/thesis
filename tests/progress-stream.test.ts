import assert from "node:assert/strict";
import test from "node:test";
import { readProgressStream } from "../src/lib/progress-stream.ts";

function chunkedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { "Content-Type": "application/x-ndjson" } });
}

test("progress stream reads events split across network chunks", async () => {
  const stages: string[] = [];
  const response = chunkedResponse([
    '{"type":"progress","stage":"Downloading',
    ' photos"}\n{"type":"progress","stage":"Reconstructing"}\n',
    '{"type":"complete","result":{"success":true,"panorama_url":"tour.jpg"}}\n',
  ]);
  const result = await readProgressStream<{ success: boolean; panorama_url: string }>(response, (stage) => stages.push(stage));
  assert.deepEqual(stages, ["Downloading photos", "Reconstructing"]);
  assert.deepEqual(result, { success: true, panorama_url: "tour.jpg" });
});

test("progress stream surfaces processor errors", async () => {
  const response = chunkedResponse(['{"type":"error","detail":"Photo download timed out."}\n']);
  await assert.rejects(readProgressStream(response), /Photo download timed out/);
});

test("progress stream rejects a missing final result", async () => {
  const response = chunkedResponse(['{"type":"progress","stage":"Reconstructing"}\n']);
  await assert.rejects(readProgressStream(response), /stopped before sending a result/);
});
