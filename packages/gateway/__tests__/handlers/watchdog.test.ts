import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDynamoSend, mockEcsSend } = vi.hoisted(() => ({
  mockDynamoSend: vi.fn(),
  mockEcsSend: vi.fn(),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockDynamoSend })) },
  ScanCommand: vi.fn((params: unknown) => ({ input: params, _tag: "ScanCommand" })),
  DeleteCommand: vi.fn((params: unknown) => ({ input: params, _tag: "DeleteCommand" })),
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock("@aws-sdk/client-ecs", () => ({
  ECSClient: vi.fn(() => ({ send: mockEcsSend })),
  StopTaskCommand: vi.fn((params: unknown) => ({ input: params, _tag: "StopTaskCommand" })),
}));

describe("watchdog handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ECS_CLUSTER_ARN", "arn:cluster");
  });

  it("should stop tasks inactive for more than 15 minutes", async () => {
    const { handler } = await import("../../src/handlers/watchdog.js");

    const oldTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        {
          PK: "USER#user-1",
          taskArn: "arn:task-1",
          status: "Running",
          startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          lastActivity: oldTime,
        },
      ],
    });
    mockEcsSend.mockResolvedValue({});
    mockDynamoSend.mockResolvedValue({});

    await handler();

    expect(mockEcsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          cluster: "arn:cluster",
          task: "arn:task-1",
          reason: expect.stringContaining("inactivity"),
        }),
      }),
    );
  });

  it("should skip tasks started less than 5 minutes ago", async () => {
    const { handler } = await import("../../src/handlers/watchdog.js");

    const recentTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        {
          PK: "USER#user-1",
          taskArn: "arn:task-1",
          status: "Running",
          startedAt: recentTime,
          lastActivity: recentTime,
        },
      ],
    });

    await handler();

    expect(mockEcsSend).not.toHaveBeenCalled();
  });

  it("should skip tasks with recent activity", async () => {
    const { handler } = await import("../../src/handlers/watchdog.js");

    const recentActivity = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        {
          PK: "USER#user-1",
          taskArn: "arn:task-1",
          status: "Running",
          startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
          lastActivity: recentActivity,
        },
      ],
    });

    await handler();

    expect(mockEcsSend).not.toHaveBeenCalled();
  });

  it("should handle empty scan result", async () => {
    const { handler } = await import("../../src/handlers/watchdog.js");

    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    await handler();

    expect(mockEcsSend).not.toHaveBeenCalled();
  });
});
