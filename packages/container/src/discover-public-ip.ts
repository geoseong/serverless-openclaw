import { DescribeTasksCommand } from "@aws-sdk/client-ecs";
import { DescribeNetworkInterfacesCommand } from "@aws-sdk/client-ec2";

type Send = (command: unknown) => Promise<unknown>;

export async function discoverPublicIp(
  ecsSend: Send,
  ec2Send: Send,
  cluster: string,
  taskArn: string,
): Promise<string | null> {
  const descResult = (await ecsSend(
    new DescribeTasksCommand({ cluster, tasks: [taskArn] }),
  )) as {
    tasks?: Array<{
      attachments?: Array<{
        type?: string;
        details?: Array<{ name?: string; value?: string }>;
      }>;
    }>;
  };

  const attachments = descResult.tasks?.[0]?.attachments;
  if (!attachments) return null;

  const eniAttachment = attachments.find(
    (a) => a.type === "ElasticNetworkInterface",
  );
  const eniId = eniAttachment?.details?.find(
    (d) => d.name === "networkInterfaceId",
  )?.value;
  if (!eniId) return null;

  const niResult = (await ec2Send(
    new DescribeNetworkInterfacesCommand({
      NetworkInterfaceIds: [eniId],
    }),
  )) as {
    NetworkInterfaces?: Array<{
      Association?: { PublicIp?: string } | null;
    }>;
  };

  return niResult.NetworkInterfaces?.[0]?.Association?.PublicIp ?? null;
}
