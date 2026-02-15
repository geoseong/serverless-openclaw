import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDynamoSend, mockEcsSend, mockCloudWatchSend } = vi.hoisted(() => ({
  mockDynamoSend: vi.fn(),
  mockEcsSend: vi.fn(),
  mockCloudWatchSend: vi.fn(),
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: { from: vi.fn(() => ({ send: mockDynamoSend })) },
  ScanCommand: vi.fn((params: unknown) => ({ input: params, _tag: "ScanCommand" })),
  PutCommand: vi.fn((params: unknown) => ({ input: params, _tag: "PutCommand" })),
  UpdateCommand: vi.fn((params: unknown) => ({ input: params, _tag: "UpdateCommand" })),
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock("@aws-sdk/client-ecs", () => ({
  ECSClient: vi.fn(() => ({ send: mockEcsSend })),
  RunTaskCommand: vi.fn((params: unknown) => ({ input: params, _tag: "RunTaskCommand" })),
}));

vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: vi.fn(() => ({ send: mockCloudWatchSend })),
  PutMetricDataCommand: vi.fn((params: unknown) => ({ input: params, _tag: "PutMetricDataCommand" })),
}));

describe("prewarm handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ECS_CLUSTER_ARN", "arn:cluster");
    vi.stubEnv("TASK_DEFINITION_ARN", "arn:task-def");
    vi.stubEnv("SUBNET_IDS", "subnet-1,subnet-2");
    vi.stubEnv("SECURITY_GROUP_IDS", "sg-1");
    vi.stubEnv("WEBSOCKET_CALLBACK_URL", "https://ws.example.com");
    vi.stubEnv("PREWARM_DURATION", "60");
    vi.stubEnv("METRICS_ENABLED", "true");
    mockDynamoSend.mockResolvedValue({});
    mockEcsSend.mockResolvedValue({ tasks: [{ taskArn: "arn:prewarm-task" }] });
    mockCloudWatchSend.mockResolvedValue({});
  });

  it("should start a new task when no active tasks exist", async () => {
    const { handler } = await import("../../src/handlers/prewarm.js");

    // Scan returns no active tasks
    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    await handler();

    // Should call RunTask
    expect(mockEcsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "RunTaskCommand",
        input: expect.objectContaining({
          cluster: "arn:cluster",
          taskDefinition: "arn:task-def",
        }),
      }),
    );

    // Should put TaskState for system:prewarm
    expect(mockDynamoSend).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "PutCommand",
        input: expect.objectContaining({
          TableName: expect.stringContaining("TaskState"),
          Item: expect.objectContaining({
            PK: "USER#system:prewarm",
            status: "Starting",
            taskArn: "arn:prewarm-task",
          }),
        }),
      }),
    );

    // Should emit PrewarmTriggered metric
    expect(mockCloudWatchSend).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "PutMetricDataCommand",
        input: expect.objectContaining({
          Namespace: "ServerlessOpenClaw",
          MetricData: expect.arrayContaining([
            expect.objectContaining({
              MetricName: "PrewarmTriggered",
              Value: 1,
            }),
          ]),
        }),
      }),
    );
  });

  it("should skip RunTask and extend prewarmUntil when a task is already running", async () => {
    const { handler } = await import("../../src/handlers/prewarm.js");

    // Scan returns an existing running task
    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        {
          PK: "USER#some-user",
          taskArn: "arn:existing-task",
          status: "Running",
          startedAt: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
        },
      ],
    });

    await handler();

    // Should NOT call RunTask
    expect(mockEcsSend).not.toHaveBeenCalled();

    // Should update lastActivity + prewarmUntil on existing item
    expect(mockDynamoSend).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "UpdateCommand",
        input: expect.objectContaining({
          TableName: expect.stringContaining("TaskState"),
          Key: { PK: "USER#some-user" },
        }),
      }),
    );

    // Should emit PrewarmSkipped metric
    expect(mockCloudWatchSend).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "PutMetricDataCommand",
        input: expect.objectContaining({
          MetricData: expect.arrayContaining([
            expect.objectContaining({
              MetricName: "PrewarmSkipped",
              Value: 1,
            }),
          ]),
        }),
      }),
    );
  });

  it("should skip RunTask when a task is in Starting state", async () => {
    const { handler } = await import("../../src/handlers/prewarm.js");

    mockDynamoSend.mockResolvedValueOnce({
      Items: [
        {
          PK: "USER#system:prewarm",
          taskArn: "arn:starting-task",
          status: "Starting",
          startedAt: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
        },
      ],
    });

    await handler();

    // Should NOT call RunTask
    expect(mockEcsSend).not.toHaveBeenCalled();

    // Should emit PrewarmSkipped
    expect(mockCloudWatchSend).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "PutMetricDataCommand",
        input: expect.objectContaining({
          MetricData: expect.arrayContaining([
            expect.objectContaining({ MetricName: "PrewarmSkipped" }),
          ]),
        }),
      }),
    );
  });

  it("should set prewarmUntil based on PREWARM_DURATION env var", async () => {
    vi.stubEnv("PREWARM_DURATION", "30");
    const { handler } = await import("../../src/handlers/prewarm.js");

    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const beforeMs = Date.now();
    await handler();
    const afterMs = Date.now();

    // Find the PutCommand call for TaskState
    const putCall = mockDynamoSend.mock.calls.find(
      (call: [{ _tag: string }]) => call[0]._tag === "PutCommand",
    );
    expect(putCall).toBeDefined();
    const item = putCall![0].input.Item;
    expect(item.prewarmUntil).toBeGreaterThanOrEqual(beforeMs + 30 * 60 * 1000);
    expect(item.prewarmUntil).toBeLessThanOrEqual(afterMs + 30 * 60 * 1000);
  });

  it("should use default duration when PREWARM_DURATION is not set", async () => {
    vi.stubEnv("PREWARM_DURATION", "");
    const { handler } = await import("../../src/handlers/prewarm.js");

    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    const beforeMs = Date.now();
    await handler();
    const afterMs = Date.now();

    const putCall = mockDynamoSend.mock.calls.find(
      (call: [{ _tag: string }]) => call[0]._tag === "PutCommand",
    );
    expect(putCall).toBeDefined();
    const item = putCall![0].input.Item;
    // Default is 60 minutes
    expect(item.prewarmUntil).toBeGreaterThanOrEqual(beforeMs + 60 * 60 * 1000);
    expect(item.prewarmUntil).toBeLessThanOrEqual(afterMs + 60 * 60 * 1000);
  });

  it("should set USER_ID override to system:prewarm in RunTask", async () => {
    const { handler } = await import("../../src/handlers/prewarm.js");

    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    await handler();

    expect(mockEcsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "RunTaskCommand",
        input: expect.objectContaining({
          overrides: expect.objectContaining({
            containerOverrides: expect.arrayContaining([
              expect.objectContaining({
                environment: expect.arrayContaining([
                  { name: "USER_ID", value: "system:prewarm" },
                ]),
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("should not emit metrics when METRICS_ENABLED is not set", async () => {
    vi.stubEnv("METRICS_ENABLED", "");
    const { handler } = await import("../../src/handlers/prewarm.js");

    mockDynamoSend.mockResolvedValueOnce({ Items: [] });

    await handler();

    // Should call RunTask but not CloudWatch
    expect(mockEcsSend).toHaveBeenCalled();
    expect(mockCloudWatchSend).not.toHaveBeenCalled();
  });
});
