import { describe, it, expect, vi, beforeEach } from "vitest";
import { handler } from "../../src/handlers/telegram-webhook.js";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const mockRouteMessage = vi.fn();
const mockSendTelegramMessage = vi.fn();
const mockGetTaskState = vi.fn();

vi.mock("../../src/services/message.js", () => ({
  routeMessage: (...args: unknown[]) => mockRouteMessage(...args),
  savePendingMessage: vi.fn(),
  sendToBridge: vi.fn(),
}));

vi.mock("../../src/services/task-state.js", () => ({
  getTaskState: (...args: unknown[]) => mockGetTaskState(...args),
  putTaskState: vi.fn(),
}));

vi.mock("../../src/services/telegram.js", () => ({
  sendTelegramMessage: (...args: unknown[]) => mockSendTelegramMessage(...args),
}));

vi.mock("../../src/services/container.js", () => ({
  startTask: vi.fn(),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: vi.fn() })) },
  GetCommand: vi.fn(),
  PutCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock("@aws-sdk/client-ecs", () => ({
  ECSClient: vi.fn(() => ({ send: vi.fn() })),
  RunTaskCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-ec2", () => ({
  EC2Client: vi.fn(() => ({ send: vi.fn() })),
}));

function makeEvent(
  body: Record<string, unknown>,
  secretToken?: string,
): APIGatewayProxyEventV2 {
  return {
    headers: secretToken
      ? { "x-telegram-bot-api-secret-token": secretToken }
      : {},
    body: JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2;
}

describe("telegram-webhook handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TELEGRAM_SECRET_TOKEN", "my-secret");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456:ABC-DEF");
    vi.stubEnv("ECS_CLUSTER_ARN", "arn:cluster");
    vi.stubEnv("TASK_DEFINITION_ARN", "arn:taskdef");
    vi.stubEnv("SUBNET_IDS", "subnet-1");
    vi.stubEnv("SECURITY_GROUP_IDS", "sg-1");
    vi.stubEnv("BRIDGE_AUTH_TOKEN", "bridge-token");
    vi.stubEnv("WEBSOCKET_CALLBACK_URL", "https://api.example.com");
    mockRouteMessage.mockResolvedValue(undefined);
    mockSendTelegramMessage.mockResolvedValue(undefined);
    mockGetTaskState.mockResolvedValue(null);
  });

  it("should return 403 for invalid secret token", async () => {
    const event = makeEvent(
      { message: { chat: { id: 123 }, text: "hi" } },
      "wrong-secret",
    );

    const result = await handler(event);

    expect(result.statusCode).toBe(403);
    expect(mockRouteMessage).not.toHaveBeenCalled();
  });

  it("should return 403 when secret token is missing", async () => {
    const event = makeEvent({ message: { chat: { id: 123 }, text: "hi" } });

    const result = await handler(event);

    expect(result.statusCode).toBe(403);
  });

  it("should route message with valid secret token", async () => {
    mockGetTaskState.mockResolvedValue({
      status: "Running",
      publicIp: "1.2.3.4",
    });

    const event = makeEvent(
      {
        message: {
          chat: { id: 12345 },
          from: { id: 67890 },
          text: "hello bot",
        },
      },
      "my-secret",
    );

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockRouteMessage).toHaveBeenCalled();
  });

  it("should send cold start reply when no task exists", async () => {
    mockGetTaskState.mockResolvedValue(null);

    const event = makeEvent(
      {
        message: {
          chat: { id: 12345 },
          from: { id: 67890 },
          text: "hello",
        },
      },
      "my-secret",
    );

    await handler(event);

    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      expect.anything(),
      "123456:ABC-DEF",
      "telegram:12345",
      expect.stringContaining("깨우는 중"),
    );
    expect(mockRouteMessage).toHaveBeenCalled();
  });

  it("should send cold start reply when task is Starting", async () => {
    mockGetTaskState.mockResolvedValue({ status: "Starting" });

    const event = makeEvent(
      {
        message: {
          chat: { id: 12345 },
          from: { id: 67890 },
          text: "hello",
        },
      },
      "my-secret",
    );

    await handler(event);

    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      expect.anything(),
      "123456:ABC-DEF",
      "telegram:12345",
      expect.stringContaining("깨우는 중"),
    );
  });

  it("should NOT send cold start reply when task is Running", async () => {
    mockGetTaskState.mockResolvedValue({
      status: "Running",
      publicIp: "1.2.3.4",
    });

    const event = makeEvent(
      {
        message: {
          chat: { id: 12345 },
          from: { id: 67890 },
          text: "hello",
        },
      },
      "my-secret",
    );

    await handler(event);

    expect(mockSendTelegramMessage).not.toHaveBeenCalled();
  });

  it("should return 200 for updates without message", async () => {
    const event = makeEvent(
      { edited_message: { chat: { id: 123 }, text: "edited" } },
      "my-secret",
    );

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(mockRouteMessage).not.toHaveBeenCalled();
  });
});
