import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { backendUrl } from "../src/lib/backend-url.ts";

const { values } = parseArgs({ options: {
  "backend-url": { type: "string" },
  "frontend-origin": { type: "string" },
  apply: { type: "boolean", default: false },
} });

try {
  assert.ok(values["backend-url"] && values["frontend-origin"],
    "Usage: node scripts/railway-cutover.mjs --backend-url https://YOUR-SERVICE.up.railway.app --frontend-origin https://YOUR-WEBSITE [--apply]");
  const api = backendUrl(values["backend-url"], true);
  assert.ok(api.startsWith("https://"), "Use the public HTTPS Railway backend URL.");
  const frontend = new URL(values["frontend-origin"]);
  assert.equal(frontend.protocol, "https:", "Use the HTTPS production website origin.");
  assert.equal(frontend.href, `${frontend.origin}/`, "Frontend origin must not include a path, credentials, query, or fragment.");
  assert.ok(!frontend.username && !frontend.password, "Frontend origin must not include credentials.");

  const request = (path, options = {}) => fetch(`${api}${path}`, {
    ...options, redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  const health = await request("/health");
  assert.equal(health.status, 200, "Railway health check failed.");
  const status = await health.json();
  assert.equal(status.status, "healthy");
  assert.equal(status.sift_available, true, "Railway must have OpenCV SIFT support.");

  const preflight = await request("/uploads/sign", { method: "OPTIONS", headers: {
    Origin: frontend.origin,
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "authorization,content-type",
  } });
  assert.equal(preflight.status, 200, "Railway CORS preflight failed. Check FRONTEND_ORIGINS.");
  assert.equal(preflight.headers.get("access-control-allow-origin"), frontend.origin);
  const unsigned = await request("/uploads/sign", { method: "POST", headers: {
    Origin: frontend.origin, "Content-Type": "application/json",
  }, body: JSON.stringify({ purpose: "image" }) });
  assert.equal(unsigned.status, 401, "The backend must reject unsigned uploads with JSON HTTP 401.");
  assert.equal(typeof (await unsigned.json()).detail, "string");
  assert.equal(unsigned.headers.get("access-control-allow-origin"), frontend.origin);
  assert.ok(unsigned.headers.get("x-request-id"), "Missing backend request ID.");
  assert.match(unsigned.headers.get("access-control-expose-headers") ?? "", /x-request-id/i);

  console.log("Passed Railway health, OpenCV SIFT, production CORS, and unsigned-upload checks.");
  if (values.apply) {
    const root = new URL("../", import.meta.url);
    const target = new URL("vercel.json", root);
    const previous = await readFile(target, "utf8");
    const config = JSON.parse(previous);
    if (config.services?.backend) {
      for (const service of Object.values(config.services)) {
        assert.ok(!service.bindings?.some((binding) => binding.service === "backend"),
          "Remove internal backend service bindings before cutting over.");
      }
      delete config.services.backend;
      config.rewrites = (config.rewrites ?? []).filter((rule) => rule.destination?.service !== "backend");
      const backup = new URL(".local/railway-cutover/", root);
      await mkdir(backup, { recursive: true });
      await writeFile(new URL(`vercel-${Date.now()}.json`, backup), previous);
      await writeFile(target, `${JSON.stringify(config, null, 2)}\n`);
      console.log(`Prepared ${fileURLToPath(target)} for frontend-only hosting.`);
    } else {
      console.log("Vercel backend service is already removed; configuration left unchanged.");
    }
  } else {
    console.log("Verification only. Add --apply after the authenticated upload and panorama smoke test.");
  }
  console.log(`Set NEXT_PUBLIC_PANORAMA_API_URL=${api} in Vercel before rebuilding.`);
  console.log("Commit and push the tested changes to main before deploying. This script does not deploy.");
} catch (error) {
  console.error(`Railway cutover stopped: ${error.message}`);
  process.exitCode = 1;
}
