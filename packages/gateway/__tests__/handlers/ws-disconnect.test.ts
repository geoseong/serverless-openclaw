import { describe, it, expect, vi, beforeEach } from "vitest";
import { handler } from "../../src/handlers/ws-disconnect.js";
import type { APIGatewayProxyEventV2WithRequestContext } from "aws-lambda";

const mockDeleteConnection = vi.fn();

vi.mock("../../src/services/connections.js", () => ({
  deleteConnection: (...args: unknown[]) => mockDeleteConnection(...args),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: vi.fn() })) },
  DeleteCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

function makeEvent(connectionId = "conn-abc") {
  return {
    requestContext: { connectionId },
  } as unknown as APIGatewayProxyEventV2WithRequestContext<never>;
}

describe("ws-disconnect handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteConnection.mockResolvedValue(undefined);
  });

  it("should delete connection and return 200", async () => {
    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(200);
    expect(mockDeleteConnection).toHaveBeenCalledWith(
      expect.any(Function),
      "conn-abc",
    );
  });
});
