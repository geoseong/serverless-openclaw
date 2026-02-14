import { describe, it, expect, vi, beforeEach } from "vitest";
import { handler } from "../../src/handlers/api-handler.js";
import type { APIGatewayProxyEventV2 } from "aws-lambda";

const mockGetConversations = vi.fn();
const mockGetTaskState = vi.fn();
const mockSaveConversation = vi.fn();
const mockGenerateOtp = vi.fn();
const mockGetLinkStatus = vi.fn();
const mockUnlinkTelegram = vi.fn();

vi.mock("../../src/services/conversations.js", () => ({
  getConversations: (...args: unknown[]) => mockGetConversations(...args),
  saveConversation: (...args: unknown[]) => mockSaveConversation(...args),
}));

vi.mock("../../src/services/task-state.js", () => ({
  getTaskState: (...args: unknown[]) => mockGetTaskState(...args),
}));

vi.mock("../../src/services/identity.js", () => ({
  generateOtp: (...args: unknown[]) => mockGenerateOtp(...args),
  getLinkStatus: (...args: unknown[]) => mockGetLinkStatus(...args),
  unlinkTelegram: (...args: unknown[]) => mockUnlinkTelegram(...args),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: vi.fn() })) },
  QueryCommand: vi.fn(),
  PutCommand: vi.fn(),
  GetCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

function makeEvent(
  method: string,
  path: string,
  userId = "user-123",
  body?: string,
): APIGatewayProxyEventV2 {
  return {
    requestContext: {
      http: { method, path },
      authorizer: { jwt: { claims: { sub: userId } } },
    },
    rawPath: path,
    body,
  } as unknown as APIGatewayProxyEventV2;
}

describe("api-handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /conversations should return conversation list", async () => {
    const items = [
      { PK: "USER#user-123", SK: "CONV#c1#MSG#1000", role: "user", content: "hi", channel: "web" },
    ];
    mockGetConversations.mockResolvedValueOnce(items);

    const result = await handler(makeEvent("GET", "/conversations"));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body).toEqual(items);
  });

  it("GET /status should return task state", async () => {
    mockGetTaskState.mockResolvedValueOnce({
      PK: "USER#user-123",
      status: "Running",
      taskArn: "arn:task",
      publicIp: "1.2.3.4",
      startedAt: "2024-01-01T00:00:00Z",
      lastActivity: "2024-01-01T00:00:00Z",
    });

    const result = await handler(makeEvent("GET", "/status"));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe("Running");
  });

  it("GET /status should return idle when no task", async () => {
    mockGetTaskState.mockResolvedValueOnce(null);

    const result = await handler(makeEvent("GET", "/status"));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe("idle");
  });

  it("should return 401 when no authorizer context", async () => {
    const event = {
      requestContext: {
        http: { method: "GET", path: "/status" },
        authorizer: undefined,
      },
      rawPath: "/status",
    } as unknown as APIGatewayProxyEventV2;

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
  });

  it("should return 404 for unknown routes", async () => {
    const result = await handler(makeEvent("GET", "/unknown"));

    expect(result.statusCode).toBe(404);
  });

  // ── Link endpoints ──

  it("POST /link/generate-otp should return OTP code", async () => {
    mockGenerateOtp.mockResolvedValueOnce("123456");

    const result = await handler(makeEvent("POST", "/link/generate-otp"));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.code).toBe("123456");
    expect(mockGenerateOtp).toHaveBeenCalledWith(expect.anything(), "user-123");
  });

  it("GET /link/status should return linked status", async () => {
    mockGetLinkStatus.mockResolvedValueOnce({ linked: true, telegramUserId: "67890" });

    const result = await handler(makeEvent("GET", "/link/status"));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.linked).toBe(true);
    expect(body.telegramUserId).toBe("67890");
  });

  it("GET /link/status should return unlinked status", async () => {
    mockGetLinkStatus.mockResolvedValueOnce({ linked: false });

    const result = await handler(makeEvent("GET", "/link/status"));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.linked).toBe(false);
  });

  it("POST /link/unlink should unlink and return success", async () => {
    mockUnlinkTelegram.mockResolvedValueOnce(undefined);

    const result = await handler(makeEvent("POST", "/link/unlink"));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.success).toBe(true);
    expect(mockUnlinkTelegram).toHaveBeenCalledWith(expect.anything(), "user-123");
  });
});
