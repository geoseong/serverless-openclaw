import { describe, it, expect, vi, beforeEach } from "vitest";
import { consumePendingMessages } from "../src/pending-messages.js";

const mockDynamoSend = vi.fn();

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockDynamoSend })),
  },
  QueryCommand: vi.fn((params: unknown) => ({ input: params, _tag: "QueryCommand" })),
  DeleteCommand: vi.fn((params: unknown) => ({ input: params, _tag: "DeleteCommand" })),
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

describe("consumePendingMessages", () => {
  const mockProcessMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockProcessMessage.mockResolvedValue(undefined);
  });

  it("should query PendingMessages for the user", async () => {
    mockDynamoSend
      .mockResolvedValueOnce({ Items: [] }); // Query returns empty

    await consumePendingMessages({
      dynamoSend: mockDynamoSend,
      userId: "user-123",
      processMessage: mockProcessMessage,
    });

    expect(mockDynamoSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: expect.stringContaining("PendingMessages"),
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": "USER#user-123" },
        }),
      }),
    );
  });

  it("should process messages in order and delete them", async () => {
    const messages = [
      {
        PK: "USER#user-123",
        SK: "MSG#1000#uuid1",
        message: "hello",
        channel: "web",
        connectionId: "conn-1",
        createdAt: "2024-01-01T00:00:00Z",
        ttl: 9999999999,
      },
      {
        PK: "USER#user-123",
        SK: "MSG#1001#uuid2",
        message: "world",
        channel: "web",
        connectionId: "conn-1",
        createdAt: "2024-01-01T00:00:01Z",
        ttl: 9999999999,
      },
    ];

    mockDynamoSend
      .mockResolvedValueOnce({ Items: messages }) // Query
      .mockResolvedValue({}); // DeleteCommand calls

    const count = await consumePendingMessages({
      dynamoSend: mockDynamoSend,
      userId: "user-123",
      processMessage: mockProcessMessage,
    });

    expect(count).toBe(2);
    expect(mockProcessMessage).toHaveBeenCalledTimes(2);
    expect(mockProcessMessage).toHaveBeenNthCalledWith(1, messages[0]);
    expect(mockProcessMessage).toHaveBeenNthCalledWith(2, messages[1]);

    // Should have 1 Query + 2 Deletes = 3 calls total
    expect(mockDynamoSend).toHaveBeenCalledTimes(3);
  });

  it("should return 0 for empty queue", async () => {
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const count = await consumePendingMessages({
      dynamoSend: mockDynamoSend,
      userId: "user-123",
      processMessage: mockProcessMessage,
    });

    expect(count).toBe(0);
    expect(mockProcessMessage).not.toHaveBeenCalled();
  });

  it("should handle undefined Items in query response", async () => {
    mockDynamoSend.mockResolvedValueOnce({});

    const count = await consumePendingMessages({
      dynamoSend: mockDynamoSend,
      userId: "user-123",
      processMessage: mockProcessMessage,
    });

    expect(count).toBe(0);
  });

  it("should delete message after successful processing", async () => {
    const msg = {
      PK: "USER#user-123",
      SK: "MSG#1000#uuid1",
      message: "hello",
      channel: "web",
      connectionId: "conn-1",
      createdAt: "2024-01-01T00:00:00Z",
      ttl: 9999999999,
    };

    mockDynamoSend
      .mockResolvedValueOnce({ Items: [msg] })
      .mockResolvedValue({});

    await consumePendingMessages({
      dynamoSend: mockDynamoSend,
      userId: "user-123",
      processMessage: mockProcessMessage,
    });

    // Second call should be DeleteCommand
    expect(mockDynamoSend).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: expect.stringContaining("PendingMessages"),
          Key: { PK: "USER#user-123", SK: "MSG#1000#uuid1" },
        }),
      }),
    );
  });
});
