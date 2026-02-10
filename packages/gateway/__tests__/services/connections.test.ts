import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  saveConnection,
  getConnection,
  deleteConnection,
} from "../../src/services/connections.js";

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  PutCommand: vi.fn((params: unknown) => ({ input: params, _tag: "PutCommand" })),
  GetCommand: vi.fn((params: unknown) => ({ input: params, _tag: "GetCommand" })),
  DeleteCommand: vi.fn((params: unknown) => ({ input: params, _tag: "DeleteCommand" })),
}));

describe("connections service", () => {
  const mockSend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("saveConnection", () => {
    it("should save a connection with TTL", async () => {
      mockSend.mockResolvedValueOnce({});

      await saveConnection(mockSend, "conn-abc", "user-123");

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: expect.stringContaining("Connections"),
            Item: expect.objectContaining({
              PK: "CONN#conn-abc",
              userId: "user-123",
              connectedAt: expect.any(String),
              ttl: expect.any(Number),
            }),
          }),
        }),
      );
    });

    it("should set TTL to ~24 hours from now", async () => {
      mockSend.mockResolvedValueOnce({});
      const before = Math.floor(Date.now() / 1000) + 86400 - 1;

      await saveConnection(mockSend, "conn-abc", "user-123");

      const call = mockSend.mock.calls[0][0];
      const ttl = call.input.Item.ttl;
      const after = Math.floor(Date.now() / 1000) + 86400 + 1;
      expect(ttl).toBeGreaterThanOrEqual(before);
      expect(ttl).toBeLessThanOrEqual(after);
    });
  });

  describe("getConnection", () => {
    it("should return ConnectionItem when found", async () => {
      const item = {
        PK: "CONN#conn-abc",
        userId: "user-123",
        connectedAt: "2024-01-01T00:00:00Z",
        ttl: 9999999999,
      };
      mockSend.mockResolvedValueOnce({ Item: item });

      const result = await getConnection(mockSend, "conn-abc");

      expect(result).toEqual(item);
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: expect.stringContaining("Connections"),
            Key: { PK: "CONN#conn-abc" },
          }),
        }),
      );
    });

    it("should return null when not found", async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await getConnection(mockSend, "conn-999");

      expect(result).toBeNull();
    });
  });

  describe("deleteConnection", () => {
    it("should delete a connection by connectionId", async () => {
      mockSend.mockResolvedValueOnce({});

      await deleteConnection(mockSend, "conn-abc");

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: expect.stringContaining("Connections"),
            Key: { PK: "CONN#conn-abc" },
          }),
        }),
      );
    });
  });
});
