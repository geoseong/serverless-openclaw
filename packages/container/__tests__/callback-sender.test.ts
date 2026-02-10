import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { CallbackSender } from "../src/callback-sender.js";

vi.mock("@aws-sdk/client-apigatewaymanagementapi", () => {
  const send = vi.fn();
  return {
    ApiGatewayManagementApiClient: vi.fn().mockImplementation(() => ({ send })),
    PostToConnectionCommand: vi.fn(),
    GoneException: class GoneException extends Error {
      override name = "GoneException";
      $metadata = {};
      constructor() {
        super("Gone");
      }
    },
  };
});

describe("CallbackSender", () => {
  let sender: CallbackSender;
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sender = new CallbackSender("https://example.execute-api.amazonaws.com/prod");
    const client = vi.mocked(ApiGatewayManagementApiClient);
    mockSend = (client.mock.results[0].value as { send: ReturnType<typeof vi.fn> }).send;
  });

  it("should send data to a connection successfully", async () => {
    mockSend.mockResolvedValue({});

    await sender.send("conn-123", { type: "message", content: "hello" });

    expect(PostToConnectionCommand).toHaveBeenCalledWith({
      ConnectionId: "conn-123",
      Data: JSON.stringify({ type: "message", content: "hello" }),
    });
    expect(mockSend).toHaveBeenCalled();
  });

  it("should silently ignore GoneException (disconnected client)", async () => {
    mockSend.mockRejectedValue(new GoneException());

    await expect(
      sender.send("conn-gone", { type: "message", content: "hello" }),
    ).resolves.toBeUndefined();
  });

  it("should throw on non-GoneException errors", async () => {
    mockSend.mockRejectedValue(new Error("InternalServerError"));

    await expect(
      sender.send("conn-123", { type: "message", content: "hello" }),
    ).rejects.toThrow("InternalServerError");
  });

  it("should create client with correct endpoint", () => {
    expect(ApiGatewayManagementApiClient).toHaveBeenCalledWith({
      endpoint: "https://example.execute-api.amazonaws.com/prod",
    });
  });
});
