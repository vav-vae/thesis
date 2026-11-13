export type TourLogDiagnosis = {
  code: string;
  title: string;
  explanation: string;
  suggestions: string[];
  facts: { label: string; value: string }[];
};

/** Interpret both old text diagnostics and newer stream diagnostics without inventing a root cause. */
export function diagnoseTourLog(log: { message: string; detail: string; online: boolean }): TourLogDiagnosis {
  const text = `${log.message}\n${log.detail}`;
  const field = (name: string) => log.detail.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1]?.trim();
  const status = field("HTTP")?.split(" ")[0];
  const stage = field("Last received stage") || field("Stage");
  const facts = [
    { label: "Job ID", value: field("Job ID") },
    { label: "Last client update", value: stage },
    { label: "Capture set", value: field("Capture set") },
    { label: "Total elapsed", value: field("Elapsed") },
    { label: "Stream elapsed", value: field("Stream duration") },
    { label: "Since last update", value: field("Time since last progress") },
    { label: "Progress updates", value: field("Progress events received") },
    { label: "Received bytes", value: field("Stream bytes received") },
    { label: "HTTP", value: status === "200" ? "200 · response started; completion not guaranteed" : field("HTTP") },
    { label: "Request", value: field("Response URL") || field("Request") },
    { label: "Request ID", value: field("Request ID") },
    { label: "Vercel request ID", value: field("Vercel request ID") },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));

  const result = (code: string, title: string, explanation: string, suggestions: string[]): TourLogDiagnosis => ({ code, title, explanation, suggestions, facts });
  if (/TOUR_JOB_FAILED|TOUR_JOB_EXPIRED|Background tour job failed/.test(text)) return result(field("Error code") || "TOUR_JOB_FAILED", "The saved generation job needs attention", "The generation job reported a failure, or its worker stopped before saving a result. Its uploaded photos remain available for retry.", ["Search the Job ID and Request ID in Vercel Logs to locate worker errors and processing time.", "Use Retry saved photos on the capture page to start a new job without recapturing. Check saved job first if only the status connection was interrupted."]);
  if (/TOUR_STREAM_INTERRUPTED|response stream was interrupted|stopped before sending a result|TOUR_STREAM_INCOMPLETE/.test(text)) {
    return result(field("Error code") || (/interrupted/.test(text) ? "TOUR_STREAM_INTERRUPTED" : "TOUR_STREAM_INCOMPLETE"), "Connection ended before the tour result arrived",
      "The browser did not receive a final result. The last client update is not proof that processing failed at that photo: the backend may have continued. HTTP 200 only confirms the response began. The exact cause is unconfirmed.", [
        "In Vercel → libot → Logs, search the Request ID above around this event’s client time. Check whether processing continued, completed, timed out, or raised an exception.",
        "Ask the tester whether Safari was backgrounded, the screen locked, or Wi-Fi/mobile data changed. An ‘online’ browser flag does not confirm a stable server connection.",
        "Keep the capture tab open and the phone awake on a stable connection; retry Generate tour with the retained photos before recapturing.",
      ]);
  }
  if (status === "401" || status === "403" || /permission-denied/.test(text)) return result("TOUR_ACCESS_DENIED", "Authentication or permissions rejected the operation", "The account, token, or access rules did not permit this operation.", ["Confirm the tester is signed in with an active broker account; sign out and back in if the session expired.", "Use the request endpoint to distinguish backend token/role checks from Firestore collection rules; inspect the matching request or rule deployment."]);
  if (status === "413") return result("TOUR_PAYLOAD_TOO_LARGE", "The request exceeded an upload limit", "The server rejected the request size before it could finish.", ["Check the endpoint and photo sizes in the raw details. Reduce image size or batch size and compare against the configured upload limits."]);
  if (status === "429" || status === "503") return result("TOUR_PROCESSOR_BUSY", "Request throttled or processor unavailable", "The service could not accept this operation at this time; inspect the raw response to distinguish capacity limits from other availability failures.", ["Check Retry-After in the raw details and wait before retrying.", "Check concurrent tests and backend availability using the Request ID; avoid simultaneous retries."]);
  if (status === "504" || /timed out|timeout/i.test(text)) return result("TOUR_TIMEOUT", "An operation exceeded its time limit", "The reported operation timed out. The raw error and request logs identify whether this was a photo download, processing, or hosting limit.", ["Search the Request ID in Vercel Logs and compare elapsed time against the operation’s configured limit.", "Check remote photo availability and resolution; retry once with a smaller capture set to compare timing."]);
  if (/TOUR_STREAM_INVALID_EVENT|unreadable progress update/.test(text)) return result("TOUR_STREAM_INVALID_EVENT", "The server sent an invalid progress event", "The response could not be parsed as the expected tour progress format.", ["Inspect the response Content-Type and the matching server request for a proxy error or malformed NDJSON output."]);
  if (status && Number(status) >= 500 && Number(status) <= 599) return result("TOUR_SERVER_ERROR", "The server failed to handle the request", "An HTTP server error was received. Check the matching Vercel request for startup, dependency installation, or application errors.", ["Search the Vercel request ID in Vercel Logs around this event’s client time.", "If runtime dependency installation reports no disk space, bundle Python dependencies at build time and redeploy; retrying photos alone will not fix the deployment."]);
  if (!log.online || /failed to fetch|\bload failed\b|network ?error/i.test(text)) return result("TOUR_NETWORK_ERROR", "The browser could not finish the request", "A browser transport error was reported. It does not identify whether the network, proxy, or backend caused the failure.", ["Check connection changes, Safari tab suspension, and the backend health endpoint.", "Use the Request ID when present to see whether the server received the request."]);
  return result(field("Error code") || "TOUR_OPERATION_FAILED", "The tour operation reported an error", "Read the original error below and the last client update to locate the failing operation. A root cause has not been automatically confirmed.", ["Search the Request ID in Vercel Logs, or inspect Firestore permissions if the request names a Firestore collection.", "Compare earlier events from the same session to find the last successful step; preserve the copied event when reproducing."]);
}
