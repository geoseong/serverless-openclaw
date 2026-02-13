import { describe, it, expect, vi } from "vitest";
import { discoverPublicIp } from "../src/discover-public-ip.js";

describe("discoverPublicIp", () => {
  it("should return public IP from ENI", async () => {
    const ecsSend = vi.fn().mockResolvedValue({
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
    const ec2Send = vi.fn().mockResolvedValue({
      NetworkInterfaces: [
        { Association: { PublicIp: "52.78.1.100" } },
      ],
    });

    const ip = await discoverPublicIp(ecsSend, ec2Send, "my-cluster", "arn:task/123");
    expect(ip).toBe("52.78.1.100");
    expect(ecsSend).toHaveBeenCalledOnce();
    expect(ec2Send).toHaveBeenCalledOnce();
  });

  it("should return null when no tasks returned", async () => {
    const ecsSend = vi.fn().mockResolvedValue({ tasks: [] });
    const ec2Send = vi.fn();

    const ip = await discoverPublicIp(ecsSend, ec2Send, "my-cluster", "arn:task/123");
    expect(ip).toBeNull();
    expect(ec2Send).not.toHaveBeenCalled();
  });

  it("should return null when no ENI attachment found", async () => {
    const ecsSend = vi.fn().mockResolvedValue({
      tasks: [{ attachments: [{ type: "Other" }] }],
    });
    const ec2Send = vi.fn();

    const ip = await discoverPublicIp(ecsSend, ec2Send, "my-cluster", "arn:task/123");
    expect(ip).toBeNull();
    expect(ec2Send).not.toHaveBeenCalled();
  });

  it("should return null when no public IP associated", async () => {
    const ecsSend = vi.fn().mockResolvedValue({
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
    const ec2Send = vi.fn().mockResolvedValue({
      NetworkInterfaces: [{ Association: null }],
    });

    const ip = await discoverPublicIp(ecsSend, ec2Send, "my-cluster", "arn:task/123");
    expect(ip).toBeNull();
  });

  it("should return null when attachments is undefined", async () => {
    const ecsSend = vi.fn().mockResolvedValue({
      tasks: [{ attachments: undefined }],
    });
    const ec2Send = vi.fn();

    const ip = await discoverPublicIp(ecsSend, ec2Send, "my-cluster", "arn:task/123");
    expect(ip).toBeNull();
  });
});
