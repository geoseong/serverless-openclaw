export const SSM_PARAMS = {
  TASK_DEFINITION_ARN: "/serverless-openclaw/compute/task-definition-arn",
  TASK_ROLE_ARN: "/serverless-openclaw/compute/task-role-arn",
  EXECUTION_ROLE_ARN: "/serverless-openclaw/compute/execution-role-arn",
  CLUSTER_ARN: "/serverless-openclaw/compute/cluster-arn",
} as const;

export const SSM_SECRETS = {
  BRIDGE_AUTH_TOKEN: "/serverless-openclaw/secrets/bridge-auth-token",
  OPENCLAW_GATEWAY_TOKEN: "/serverless-openclaw/secrets/openclaw-gateway-token",
  ANTHROPIC_API_KEY: "/serverless-openclaw/secrets/anthropic-api-key",
  OPENAI_API_KEY: "/serverless-openclaw/secrets/openai-api-key",
  OPENROUTER_API_KEY: "/serverless-openclaw/secrets/openrouter-api-key",
  GEMINI_API_KEY: "/serverless-openclaw/secrets/gemini-api-key",
  OLLAMA_API_KEY: "/serverless-openclaw/secrets/ollama-api-key",
  TELEGRAM_BOT_TOKEN: "/serverless-openclaw/secrets/telegram-bot-token",
  TELEGRAM_WEBHOOK_SECRET: "/serverless-openclaw/secrets/telegram-webhook-secret",
} as const;
