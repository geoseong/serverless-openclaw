import {
  CloudWatchClient,
  PutMetricDataCommand,
} from "@aws-sdk/client-cloudwatch";
import type { MetricDatum } from "@aws-sdk/client-cloudwatch";

const NAMESPACE = "ServerlessOpenClaw";
const enabled = process.env.METRICS_ENABLED === "true";
const client = new CloudWatchClient({});

async function putMetrics(metrics: MetricDatum[]): Promise<void> {
  if (!enabled) return;
  try {
    await client.send(
      new PutMetricDataCommand({
        Namespace: NAMESPACE,
        MetricData: metrics,
      }),
    );
  } catch (err) {
    console.warn("Failed to publish CloudWatch metrics:", err);
  }
}

export interface StartupTimings {
  total: number;
  s3Restore: number;
  gatewayWait: number;
  clientReady: number;
  pendingMessages: number;
  userId: string;
  channel: string;
}

export async function publishStartupMetrics(
  timings: StartupTimings,
): Promise<void> {
  const dimensions = [{ Name: "Channel", Value: timings.channel }];
  const timestamp = new Date();

  await putMetrics([
    {
      MetricName: "StartupTotal",
      Value: timings.total,
      Unit: "Milliseconds",
      Dimensions: dimensions,
      Timestamp: timestamp,
    },
    {
      MetricName: "StartupS3Restore",
      Value: timings.s3Restore,
      Unit: "Milliseconds",
      Dimensions: dimensions,
      Timestamp: timestamp,
    },
    {
      MetricName: "StartupGatewayWait",
      Value: timings.gatewayWait,
      Unit: "Milliseconds",
      Dimensions: dimensions,
      Timestamp: timestamp,
    },
    {
      MetricName: "StartupClientReady",
      Value: timings.clientReady,
      Unit: "Milliseconds",
      Dimensions: dimensions,
      Timestamp: timestamp,
    },
    {
      MetricName: "PendingMessagesConsumed",
      Value: timings.pendingMessages,
      Unit: "Count",
      Dimensions: dimensions,
      Timestamp: timestamp,
    },
  ]);
}

export interface MessageMetrics {
  latency: number;
  responseLength: number;
  channel: string;
}

export async function publishMessageMetrics(
  metrics: MessageMetrics,
): Promise<void> {
  const dimensions = [{ Name: "Channel", Value: metrics.channel }];
  const timestamp = new Date();

  await putMetrics([
    {
      MetricName: "MessageLatency",
      Value: metrics.latency,
      Unit: "Milliseconds",
      Dimensions: dimensions,
      Timestamp: timestamp,
    },
    {
      MetricName: "ResponseLength",
      Value: metrics.responseLength,
      Unit: "Count",
      Dimensions: dimensions,
      Timestamp: timestamp,
    },
  ]);
}

export async function publishFirstResponseTime(
  ms: number,
  channel: string,
): Promise<void> {
  await putMetrics([
    {
      MetricName: "FirstResponseTime",
      Value: ms,
      Unit: "Milliseconds",
      Dimensions: [{ Name: "Channel", Value: channel }],
      Timestamp: new Date(),
    },
  ]);
}
