import { describe, it, expect, vi, beforeEach } from "vitest";
import { handler } from "../../src/handlers/ws-connect.js";

const mockSaveConnection = vi.fn();
const mockVerify = vi.fn();

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

vi.mock("aws-jwt-verify", () => ({
  CognitoJwtVerifier: {
    create: () => ({ verify: (...args: unknown[]) => mockVerify(...args) }),
  },
}));

function makeEvent(token?: string) {
  return {
    requestContext: { connectionId: "conn-abc" },
    queryStringParameters: token ? { token } : undefined,
  };
}

describe("ws-connect handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveConnection.mockResolvedValue(undefined);
    mockVerify.mockResolvedValue({ sub: "user-123" });
  });

  it("should verify JWT, save connection and return 200", async () => {
    const result = await handler(makeEvent("valid-token"));

    expect(result.statusCode).toBe(200);
    expect(mockVerify).toHaveBeenCalledWith("valid-token");
    expect(mockSaveConnection).toHaveBeenCalledWith(
      expect.any(Function),
      "conn-abc",
      "user-123",
    );
  });

  it("should return 401 when no token provided", async () => {
    const result = await handler(makeEvent());

    expect(result.statusCode).toBe(401);
    expect(mockSaveConnection).not.toHaveBeenCalled();
  });

  it("should return 401 when JWT verification fails", async () => {
    mockVerify.mockRejectedValue(new Error("Invalid token"));

    const result = await handler(makeEvent("bad-token"));

    expect(result.statusCode).toBe(401);
    expect(mockSaveConnection).not.toHaveBeenCalled();
  });
});
