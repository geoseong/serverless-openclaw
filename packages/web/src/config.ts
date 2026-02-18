// Runtime configuration loaded from /config.json
export interface RuntimeConfig {
  cognitoUserPoolId: string;
  cognitoClientId: string;
  webSocketUrl: string;
  apiUrl: string;
}

let config: RuntimeConfig | null = null;

export async function loadConfig(): Promise<RuntimeConfig> {
  if (config) return config;

  try {
    const response = await fetch("/config.json");
    if (!response.ok) {
      throw new Error(`Failed to load config: ${response.statusText}`);
    }
    config = await response.json();
    return config;
  } catch (error) {
    console.error("Failed to load runtime config:", error);
    throw error;
  }
}

export function getConfig(): RuntimeConfig {
  if (!config) {
    throw new Error("Config not loaded. Call loadConfig() first.");
  }
  return config;
}
