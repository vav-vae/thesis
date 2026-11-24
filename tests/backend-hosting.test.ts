import test from "node:test";
import assert from "node:assert/strict";
import { backendUrl } from "../src/lib/backend-url.ts";

test("backend URL keeps legacy defaults and normalizes Railway URLs", () => {
  assert.equal(backendUrl(undefined, true), "/api/backend");
  assert.equal(backendUrl(undefined), "http://127.0.0.1:8000");
  assert.equal(backendUrl(" https://libot-test.up.railway.app/// ", true), "https://libot-test.up.railway.app");
  assert.equal(backendUrl("/api/backend/", true), "/api/backend");
});

test("production backend URLs reject insecure or ambiguous destinations", () => {
  for (const value of ["http://backend.example", "//backend.example", "https://u:p@backend.example", "https://backend.example?key=secret", "https://backend.example#api", "data:text/plain,test", "https://backend.example;connect-src *"]) {
    assert.throws(() => backendUrl(value, true), /NEXT_PUBLIC_PANORAMA_API_URL/);
  }
});

test("Next production headers permit only the configured backend origin and proxy legacy paths", async () => {
  const saved = { nodeEnv: process.env.NODE_ENV, backend: process.env.NEXT_PUBLIC_PANORAMA_API_URL };
  try {
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.NEXT_PUBLIC_PANORAMA_API_URL = "https://libot-test.up.railway.app/";
    const configPath = new URL("../next.config.ts", import.meta.url);
    configPath.searchParams.set("hosting-test", "railway");
    const { default: config } = await import(configPath.href);
    const rules = await config.headers();
    const csp = rules.find((rule: { source: string }) => rule.source === "/:path*").headers
      .find((header: { key: string }) => header.key === "Content-Security-Policy").value as string;
    for (const directive of ["connect-src", "img-src"]) {
      const policy = csp.split("; ").find((value) => value.startsWith(`${directive} `));
      assert.ok(policy?.includes("https://libot-test.up.railway.app"));
      assert.ok(!policy?.includes("https://*.up.railway.app"));
      assert.ok(!policy?.includes("http://127.0.0.1:8000"));
    }
    assert.deepEqual(await config.rewrites(), [{ source: "/api/backend/:path*", destination: "https://libot-test.up.railway.app/:path*" }]);

    delete process.env.NEXT_PUBLIC_PANORAMA_API_URL;
    configPath.searchParams.set("hosting-test", "legacy");
    const legacy = (await import(configPath.href)).default;
    assert.deepEqual(await legacy.rewrites(), []);
  } finally {
    if (saved.nodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: saved.nodeEnv });
    if (saved.backend === undefined) delete process.env.NEXT_PUBLIC_PANORAMA_API_URL;
    else process.env.NEXT_PUBLIC_PANORAMA_API_URL = saved.backend;
  }
});
