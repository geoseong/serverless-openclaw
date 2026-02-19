import { readFileSync, writeFileSync } from "node:fs";
import { GATEWAY_PORT } from "@serverless-openclaw/shared";

export function patchConfig(configPath: string): void {
  const raw = readFileSync(configPath, "utf-8");
  const config = JSON.parse(raw) as Record<string, Record<string, unknown>>;

  // Set gateway port
  config.gateway = { ...config.gateway, port: GATEWAY_PORT };

  // Remove auth secrets from config (API keys delivered via env vars only)
  if (config.auth) {
    delete config.auth.token;
  }

  // Remove Telegram section entirely (webhook-only, configured via env)
  delete config.telegram;

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  console.log("[patch-config] Config patched successfully");
}
