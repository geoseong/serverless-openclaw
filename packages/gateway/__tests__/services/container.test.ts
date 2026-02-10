import { describe, it, expect, vi, beforeEach } from "vitest";
import { startTask, getPublicIp, stopTask } from "../../src/services/container.js";

vi.mock("@aws-sdk/client-ecs", () => ({
  RunTaskCommand: vi.fn((params: unknown) => ({ input: params, _tag: "RunTaskCommand" })),
  DescribeTasksCommand: vi.fn((params: unknown) => ({ input: params, _tag: "DescribeTasksCommand" })),
  StopTaskCommand: vi.fn((params: unknown) => ({ input: params, _tag: "StopTaskCommand" })),
}));

vi.mock("@aws-sdk/client-ec2", () => ({
  DescribeNetworkInterfacesCommand: vi.fn((params: unknown) => ({
    input: params,
    _tag: "DescribeNetworkInterfacesCommand",
  })),
}));

describe("container service", () => {
  const mockEcsSend = vi.fn();
  const mockEc2Send = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("startTask", () => {
    it("should run a task with capacityProviderStrategy and return taskArn", async () => {
      mockEcsSend.mockResolvedValueOnce({
        tasks: [{ taskArn: "arn:aws:ecs:us-east-1:123:task/cluster/task-id" }],
      });

      const arn = await startTask(mockEcsSend, {
        cluster: "my-cluster",
        taskDefinition: "my-task-def",
        subnets: ["subnet-1", "subnet-2"],
        securityGroups: ["sg-1"],
        containerName: "openclaw",
        environment: [{ name: "FOO", value: "bar" }],
      });

      expect(arn).toBe("arn:aws:ecs:us-east-1:123:task/cluster/task-id");
      expect(mockEcsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            cluster: "my-cluster",
            taskDefinition: "my-task-def",
            capacityProviderStrategy: [
              { capacityProvider: "FARGATE_SPOT", weight: 1 },
            ],
            networkConfiguration: expect.objectContaining({
              awsvpcConfiguration: expect.objectContaining({
                subnets: ["subnet-1", "subnet-2"],
                securityGroups: ["sg-1"],
                assignPublicIp: "ENABLED",
              }),
            }),
          }),
        }),
      );
      // Must NOT have launchType
      const call = mockEcsSend.mock.calls[0][0];
      expect(call.input.launchType).toBeUndefined();
    });

    it("should throw when no tasks returned", async () => {
      mockEcsSend.mockResolvedValueOnce({ tasks: [] });

      await expect(
        startTask(mockEcsSend, {
          cluster: "c",
          taskDefinition: "td",
          subnets: ["s"],
          securityGroups: ["sg"],
          containerName: "openclaw",
          environment: [],
        }),
      ).rejects.toThrow("RunTask returned no tasks");
    });
  });

  describe("getPublicIp", () => {
    it("should follow ENI chain to get public IP", async () => {
      // DescribeTasks returns ENI attachment
      mockEcsSend.mockResolvedValueOnce({
        tasks: [
          {
            attachments: [
              {
                type: "ElasticNetworkInterface",
                details: [
                  { name: "networkInterfaceId", value: "eni-abc123" },
                ],
              },
            ],
          },
        ],
      });

      // DescribeNetworkInterfaces returns public IP
      mockEc2Send.mockResolvedValueOnce({
        NetworkInterfaces: [
          {
            Association: { PublicIp: "54.1.2.3" },
          },
        ],
      });

      const ip = await getPublicIp(mockEcsSend, mockEc2Send, "cluster", "task-arn");

      expect(ip).toBe("54.1.2.3");
    });

    it("should return null when no ENI found", async () => {
      mockEcsSend.mockResolvedValueOnce({
        tasks: [{ attachments: [] }],
      });

      const ip = await getPublicIp(mockEcsSend, mockEc2Send, "cluster", "task-arn");

      expect(ip).toBeNull();
    });

    it("should return null when no public IP associated", async () => {
      mockEcsSend.mockResolvedValueOnce({
        tasks: [
          {
            attachments: [
              {
                type: "ElasticNetworkInterface",
                details: [
                  { name: "networkInterfaceId", value: "eni-abc123" },
                ],
              },
            ],
          },
        ],
      });

      mockEc2Send.mockResolvedValueOnce({
        NetworkInterfaces: [{ Association: undefined }],
      });

      const ip = await getPublicIp(mockEcsSend, mockEc2Send, "cluster", "task-arn");

      expect(ip).toBeNull();
    });

    it("should return null when task has no attachments", async () => {
      mockEcsSend.mockResolvedValueOnce({
        tasks: [{ attachments: undefined }],
      });

      const ip = await getPublicIp(mockEcsSend, mockEc2Send, "cluster", "task-arn");

      expect(ip).toBeNull();
    });
  });

  describe("stopTask", () => {
    it("should call StopTask with reason", async () => {
      mockEcsSend.mockResolvedValueOnce({});

      await stopTask(mockEcsSend, "cluster", "task-arn", "Watchdog timeout");

      expect(mockEcsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            cluster: "cluster",
            task: "task-arn",
            reason: "Watchdog timeout",
          }),
        }),
      );
    });
  });
});
