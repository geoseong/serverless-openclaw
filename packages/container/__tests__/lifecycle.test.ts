import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LifecycleManager } from "../src/lifecycle.js";

const mockDynamoSend = vi.fn();
const mockS3Send = vi.fn();

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({ send: mockDynamoSend })),
  },
  PutCommand: vi.fn((params: unknown) => ({ input: params, _tag: "PutCommand" })),
  UpdateCommand: vi.fn((params: unknown) => ({ input: params, _tag: "UpdateCommand" })),
}));

vi.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: vi.fn(() => ({})),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn(() => ({ send: mockS3Send })),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("LifecycleManager", () => {
  let lifecycle: LifecycleManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockDynamoSend.mockResolvedValue({});
    mockS3Send.mockResolvedValue({});

    lifecycle = new LifecycleManager({
      dynamoSend: mockDynamoSend,
      userId: "user-123",
      taskArn: "arn:aws:ecs:us-east-1:123456:task/my-cluster/abc123",
      s3Bucket: "my-backup-bucket",
      s3Prefix: "backups/user-123",
      workspacePath: "/data/workspace",
    });
  });

  afterEach(() => {
    lifecycle.stopPeriodicBackup();
    vi.useRealTimers();
  });

  it("should update TaskState to Starting", async () => {
    await lifecycle.updateTaskState("Starting");

    expect(mockDynamoSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          TableName: expect.stringContaining("TaskState"),
          Item: expect.objectContaining({
            PK: "USER#user-123",
            status: "Starting",
          }),
        }),
      }),
    );
  });

  it("should update TaskState to Running with publicIp", async () => {
    await lifecycle.updateTaskState("Running", "1.2.3.4");

    expect(mockDynamoSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Item: expect.objectContaining({
            status: "Running",
            publicIp: "1.2.3.4",
          }),
        }),
      }),
    );
  });

  it("should update TaskState to Idle on gracefulShutdown", async () => {
    await lifecycle.gracefulShutdown();

    expect(mockDynamoSend).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Item: expect.objectContaining({
            status: "Idle",
          }),
        }),
      }),
    );
  });

  it("should call S3 sync on backupToS3", async () => {
    const { execSync } = await import("node:child_process");
    await lifecycle.backupToS3();

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("aws s3 sync"),
    );
  });

  it("should start and stop periodic backup", async () => {
    const backupSpy = vi.spyOn(lifecycle, "backupToS3").mockResolvedValue();

    lifecycle.startPeriodicBackup();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(backupSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(backupSpy).toHaveBeenCalledTimes(2);

    lifecycle.stopPeriodicBackup();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(backupSpy).toHaveBeenCalledTimes(2);
  });

  it("should track lastActivity", () => {
    const before = lifecycle.lastActivityTime;
    vi.advanceTimersByTime(1000);
    lifecycle.updateLastActivity();
    expect(lifecycle.lastActivityTime.getTime()).toBeGreaterThan(
      before.getTime(),
    );
  });

  it("should backup before shutdown", async () => {
    const { execSync } = await import("node:child_process");
    await lifecycle.gracefulShutdown();

    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining("aws s3 sync"),
    );
  });
});
