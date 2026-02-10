import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getConversations,
  saveConversation,
} from "../../src/services/conversations.js";

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  QueryCommand: vi.fn((params: unknown) => ({ input: params, _tag: "QueryCommand" })),
  PutCommand: vi.fn((params: unknown) => ({ input: params, _tag: "PutCommand" })),
}));

describe("conversations service", () => {
  const mockSend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getConversations", () => {
    it("should query conversations for a user", async () => {
      const items = [
        {
          PK: "USER#user-123",
          SK: "CONV#conv1#MSG#1000",
          role: "user",
          content: "hello",
          channel: "web",
        },
        {
          PK: "USER#user-123",
          SK: "CONV#conv1#MSG#1001",
          role: "assistant",
          content: "hi there",
          channel: "web",
        },
      ];
      mockSend.mockResolvedValueOnce({ Items: items });

      const result = await getConversations(mockSend, "user-123");

      expect(result).toEqual(items);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: expect.stringContaining("Conversations"),
            KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
            ExpressionAttributeValues: {
              ":pk": "USER#user-123",
              ":sk": "CONV#",
            },
            ScanIndexForward: false,
          }),
        }),
      );
    });

    it("should respect limit parameter", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await getConversations(mockSend, "user-123", 10);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Limit: 10,
          }),
        }),
      );
    });

    it("should default to 50 messages", async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await getConversations(mockSend, "user-123");

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            Limit: 50,
          }),
        }),
      );
    });

    it("should return empty array when no items", async () => {
      mockSend.mockResolvedValueOnce({ Items: undefined });

      const result = await getConversations(mockSend, "user-123");

      expect(result).toEqual([]);
    });
  });

  describe("saveConversation", () => {
    it("should put a conversation item", async () => {
      mockSend.mockResolvedValueOnce({});

      const item = {
        PK: "USER#user-123",
        SK: "CONV#conv1#MSG#1000",
        role: "user" as const,
        content: "hello world",
        channel: "web" as const,
      };

      await saveConversation(mockSend, item);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: expect.stringContaining("Conversations"),
            Item: item,
          }),
        }),
      );
    });
  });
});
