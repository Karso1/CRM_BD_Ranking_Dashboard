import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.deployment/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";
const deploymentEnv = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ?? "production";
const dashboardSnapshotBinding =
  deploymentEnv === "staging"
    ? { binding: "DASHBOARD_SNAPSHOTS", id: "0f6940e225fd4cc68efe030644fa58a4" }
    : deploymentEnv === "production"
      ? { binding: "DASHBOARD_SNAPSHOTS", id: "7578a636222346f79889458e92082121" }
      : undefined;

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  name: deploymentEnv === "staging" ? "upay-bd-ranking-staging" : "upay-bd-ranking",
  main: "worker.ts",
  compatibility_flags: ["nodejs_compat"],
  // Bundled dashboard snapshots are sensitive too: authenticate assets before
  // Cloudflare serves them, not just HTML and /api/dashboard.
  ...({
    assets: { binding: "ASSETS", run_worker_first: true },
    secrets: { required: ["DASHBOARD_USERNAME", "DASHBOARD_PASSWORD", "DASHBOARD_SESSION_SECRET",
      ...(deploymentEnv === "staging" ? ["DASHBOARD_BD_ACCOUNTS"] : [])] },
  }),
  ratelimits: [{
    name: "LOGIN_RATE_LIMITER", namespace_id: deploymentEnv === "staging" ? "2026092801" : "2026092901",
    simple: { limit: 10, period: 60 as const },
  }],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  kv_namespaces: dashboardSnapshotBinding ? [dashboardSnapshotBinding] : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    define: {
      "process.env.NEXT_PUBLIC_DEPLOYMENT_ENV": JSON.stringify(
        process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ?? "production",
      ),
    },
    server: {
      ...(managedLinux ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] } : {}),
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux }),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
