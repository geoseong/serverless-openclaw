import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  routeMessage,
  savePendingMessage,
  sendToBridge,
} from "../../src/services/message.js";

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  PutCommand: vi.fn((params: unknown) => ({ input: params, _tag: "PutCommand" })),
}));

describe("message service", () => {
  const mockDynamoSend = vi.fn();
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, status: 202 });
  });

  describe("sendToBridge", () => {
    it("should POST to bridge with Bearer token", async () => {
      await sendToBridge(mockFetch, "1.2.3.4", "my-token", {
        userId: "user-123",
        message: "hello",
        channel: "web",
        connectionId: "conn-1",
        callbackUrl: "https://api.example.com",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://1.2.3.4:8080/message",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer my-token",
          }),
          body: expect.any(String),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.userId).toBe("user-123");
      expect(body.message).toBe("hello");
    });

    it("should throw on non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(
        sendToBridge(mockFetch, "1.2.3.4", "token", {
          userId: "u",
          message: "m",
          channel: "web",
          connectionId: "c",
          callbackUrl: "https://cb",
        }),
      ).rejects.toThrow("Bridge returned 500");
    });
  });

  describe("savePendingMessage", () => {
    it("should save message with TTL to PendingMessages table", async () => {
      mockDynamoSend.mockResolvedValueOnce({});

      const item = {
        PK: "USER#user-123",
        SK: "MSG#1000#uuid-1",
        message: "hello",
        channel: "web" as const,
        connectionId: "conn-1",
        createdAt: "2024-01-01T00:00:00Z",
        ttl: 9999999999,
      };

      await savePendingMessage(mockDynamoSend, item);

      expect(mockDynamoSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: expect.stringContaining("PendingMessages"),
            Item: item,
          }),
        }),
      );
    });
  });

  describe("routeMessage", () => {
    it("should send to bridge when task is Running with publicIp", async () => {
      const mockGetTaskState = vi.fn().mockResolvedValue({
        PK: "USER#user-123",
        status: "Running",
        publicIp: "1.2.3.4",
        taskArn: "arn:task",
        startedAt: "2024-01-01T00:00:00Z",
        lastActivity: "2024-01-01T00:00:00Z",
      });
      const mockStartTask = vi.fn();
      const mockPutTaskState = vi.fn();
      const mockSavePending = vi.fn();

      await routeMessage({
        userId: "user-123",
        message: "hello",
        channel: "web",
        connectionId: "conn-1",
        callbackUrl: "https://cb",
        bridgeAuthToken: "token",
        fetchFn: mockFetch,
        getTaskState: mockGetTaskState,
        startTask: mockStartTask,
        putTaskState: mockPutTaskState,
        savePendingMessage: mockSavePending,
        startTaskParams: { cluster: "c", taskDefinition: "td", subnets: ["s"], securityGroups: ["sg"], containerName: "openclaw", environment: [] },
      });

      expect(mockFetch).toHaveBeenCalled();
      expect(mockStartTask).not.toHaveBeenCalled();
    });

    it("should save pending + start task when no active task", async () => {
      const mockGetTaskState = vi.fn().mockResolvedValue(null);
      const mockStartTask = vi.fn().mockResolvedValue("arn:new-task");
      const mockPutTaskState = vi.fn();
      const mockSavePending = vi.fn();

      await routeMessage({
        userId: "user-123",
        message: "hello",
        channel: "web",
        connectionId: "conn-1",
        callbackUrl: "https://cb",
        bridgeAuthToken: "token",
        fetchFn: mockFetch,
        getTaskState: mockGetTaskState,
        startTask: mockStartTask,
        putTaskState: mockPutTaskState,
        savePendingMessage: mockSavePending,
        startTaskParams: { cluster: "c", taskDefinition: "td", subnets: ["s"], securityGroups: ["sg"], containerName: "openclaw", environment: [] },
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockSavePending).toHaveBeenCalled();
      expect(mockStartTask).toHaveBeenCalled();
      expect(mockPutTaskState).toHaveBeenCalledWith(
        expect.objectContaining({
          PK: "USER#user-123",
          status: "Starting",
          taskArn: "arn:new-task",
        }),
      );
    });

    it("should save pending when task is Starting (no publicIp yet)", async () => {
      const mockGetTaskState = vi.fn().mockResolvedValue({
        PK: "USER#user-123",
        status: "Starting",
        taskArn: "arn:task",
        startedAt: "2024-01-01T00:00:00Z",
        lastActivity: "2024-01-01T00:00:00Z",
      });
      const mockStartTask = vi.fn();
      const mockPutTaskState = vi.fn();
      const mockSavePending = vi.fn();

      await routeMessage({
        userId: "user-123",
        message: "hello",
        channel: "web",
        connectionId: "conn-1",
        callbackUrl: "https://cb",
        bridgeAuthToken: "token",
        fetchFn: mockFetch,
        getTaskState: mockGetTaskState,
        startTask: mockStartTask,
        putTaskState: mockPutTaskState,
        savePendingMessage: mockSavePending,
        startTaskParams: { cluster: "c", taskDefinition: "td", subnets: ["s"], securityGroups: ["sg"], containerName: "openclaw", environment: [] },
      });

      expect(mockSavePending).toHaveBeenCalled();
      expect(mockStartTask).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
