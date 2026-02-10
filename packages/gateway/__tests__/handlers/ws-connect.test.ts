import { describe, it, expect, vi, beforeEach } from "vitest";
import { handler } from "../../src/handlers/ws-connect.js";
import type { APIGatewayProxyEventV2WithRequestContext } from "aws-lambda";

const mockSaveConnection = vi.fn();

vi.mock("../../src/services/connections.js", () => ({
  saveConnection: (...args: unknown[]) => mockSaveConnection(...args),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: vi.fn() })) },
  PutCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    requestContext: {
      connectionId: "conn-abc",
      authorizer: { jwt: { claims: { sub: "user-123" } } },
      ...overrides,
    },
  } as unknown as APIGatewayProxyEventV2WithRequestContext<never>;
}

describe("ws-connect handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveConnection.mockResolvedValue(undefined);
  });

  it("should save connection and return 200", async () => {
    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(200);
    expect(mockSaveConnection).toHaveBeenCalledWith(
      expect.any(Function),
      "conn-abc",
      "user-123",
    );
  });

  it("should return 401 when no authorizer context", async () => {
    const event = makeEvent({ authorizer: undefined });

    const result = await handler(event);

    expect(result.statusCode).toBe(401);
    expect(mockSaveConnection).not.toHaveBeenCalled();
  });
});
