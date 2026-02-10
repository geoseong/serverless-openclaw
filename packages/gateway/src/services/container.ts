import { RunTaskCommand, DescribeTasksCommand, StopTaskCommand } from "@aws-sdk/client-ecs";
import { DescribeNetworkInterfacesCommand } from "@aws-sdk/client-ec2";

type Send = (command: unknown) => Promise<unknown>;

export interface StartTaskParams {
  cluster: string;
  taskDefinition: string;
  subnets: string[];
  securityGroups: string[];
  containerName: string;
  environment: Array<{ name: string; value: string }>;
}

export async function startTask(
  ecsSend: Send,
  params: StartTaskParams,
): Promise<string> {
  const result = (await ecsSend(
    new RunTaskCommand({
      cluster: params.cluster,
      taskDefinition: params.taskDefinition,
      capacityProviderStrategy: [
        { capacityProvider: "FARGATE_SPOT", weight: 1 },
      ],
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: params.subnets,
          securityGroups: params.securityGroups,
          assignPublicIp: "ENABLED",
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: params.containerName,
            environment: params.environment,
          },
        ],
      },
    }),
  )) as { tasks?: Array<{ taskArn?: string }> };

  const taskArn = result.tasks?.[0]?.taskArn;
  if (!taskArn) throw new Error("RunTask returned no tasks");
  return taskArn;
}

export async function getPublicIp(
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
      Association?: { PublicIp?: string };
    }>;
  };

  return niResult.NetworkInterfaces?.[0]?.Association?.PublicIp ?? null;
}

export async function stopTask(
  ecsSend: Send,
  cluster: string,
  taskArn: string,
  reason: string,
): Promise<void> {
  await ecsSend(
    new StopTaskCommand({ cluster, task: taskArn, reason }),
  );
}
