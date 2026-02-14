import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import type { Construct } from "constructs";
import { TABLE_NAMES } from "@serverless-openclaw/shared";

const NAMESPACE = "ServerlessOpenClaw";
const CHANNELS = ["web", "telegram"];

const LAMBDA_FUNCTIONS = [
  "serverless-openclaw-ws-connect",
  "serverless-openclaw-ws-disconnect",
  "serverless-openclaw-ws-message",
  "serverless-openclaw-telegram-webhook",
  "serverless-openclaw-api-handler",
  "serverless-openclaw-watchdog",
];

const KEY_LAMBDA_FUNCTIONS = [
  "serverless-openclaw-ws-message",
  "serverless-openclaw-telegram-webhook",
];

/** Custom metric with Channel dimension — one per channel for correct CloudWatch lookup */
function channelMetrics(
  metricName: string,
  statistic: string,
  unit?: cloudwatch.Unit,
): cloudwatch.Metric[] {
  return CHANNELS.map(
    (ch) =>
      new cloudwatch.Metric({
        namespace: NAMESPACE,
        metricName,
        dimensionsMap: { Channel: ch },
        statistic,
        unit,
        period: cdk.Duration.minutes(5),
        label: `${metricName} (${ch})`,
      }),
  );
}

function lambdaMetric(
  functionName: string,
  metricName: string,
  statistic: string,
): cloudwatch.Metric {
  return new cloudwatch.Metric({
    namespace: "AWS/Lambda",
    metricName,
    dimensionsMap: { FunctionName: functionName },
    statistic,
    period: cdk.Duration.minutes(5),
    label: functionName.replace("serverless-openclaw-", ""),
  });
}

function sectionHeader(title: string, description: string): cloudwatch.TextWidget {
  return new cloudwatch.TextWidget({
    markdown: `### ${title}\n${description}`,
    width: 24,
    height: 1,
  });
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const dashboard = new cloudwatch.Dashboard(this, "Dashboard", {
      dashboardName: "ServerlessOpenClaw",
      periodOverride: cloudwatch.PeriodOverride.AUTO,
    });

    // ════════════════════════════════════════════════════════════════
    //  Section 1: Cold Start Performance
    // ════════════════════════════════════════════════════════════════

    dashboard.addWidgets(
      sectionHeader(
        "Cold Start Performance",
        "Fargate 컨테이너 시작 시간. S3 복원 → Gateway 연결 → 클라이언트 준비 단계별 소요 시간.",
      ),
    );

    dashboard.addWidgets(
      new cloudwatch.SingleValueWidget({
        title: "Startup Total (p50)",
        metrics: channelMetrics("StartupTotal", "p50", cloudwatch.Unit.MILLISECONDS),
        width: 4,
        height: 4,
      }),
      new cloudwatch.GraphWidget({
        title: "Startup Total — p50 / p99",
        left: [
          ...channelMetrics("StartupTotal", "p50", cloudwatch.Unit.MILLISECONDS),
          ...channelMetrics("StartupTotal", "p99", cloudwatch.Unit.MILLISECONDS),
        ],
        width: 8,
        height: 4,
        leftYAxis: { label: "ms" },
      }),
      new cloudwatch.GraphWidget({
        title: "Startup Phase Breakdown (avg)",
        left: [
          ...channelMetrics("StartupS3Restore", "Average", cloudwatch.Unit.MILLISECONDS),
          ...channelMetrics("StartupGatewayWait", "Average", cloudwatch.Unit.MILLISECONDS),
          ...channelMetrics("StartupClientReady", "Average", cloudwatch.Unit.MILLISECONDS),
        ],
        width: 6,
        height: 4,
        stacked: true,
        leftYAxis: { label: "ms" },
      }),
      new cloudwatch.SingleValueWidget({
        title: "First Response (p50)",
        metrics: channelMetrics("FirstResponseTime", "p50", cloudwatch.Unit.MILLISECONDS),
        width: 6,
        height: 4,
      }),
    );

    // ════════════════════════════════════════════════════════════════
    //  Section 2: Message Processing
    // ════════════════════════════════════════════════════════════════

    dashboard.addWidgets(
      sectionHeader(
        "Message Processing",
        "사용자 메시지 → AI 응답 완료까지의 지연 시간과 응답 길이. 콜드 스타트 중 대기열 소비량.",
      ),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Message Latency — p50 / p99",
        left: [
          ...channelMetrics("MessageLatency", "p50", cloudwatch.Unit.MILLISECONDS),
          ...channelMetrics("MessageLatency", "p99", cloudwatch.Unit.MILLISECONDS),
        ],
        width: 8,
        height: 4,
        leftYAxis: { label: "ms" },
      }),
      new cloudwatch.GraphWidget({
        title: "Response Length (avg chars)",
        left: channelMetrics("ResponseLength", "Average", cloudwatch.Unit.COUNT),
        width: 4,
        height: 4,
        leftYAxis: { label: "chars" },
      }),
      new cloudwatch.SingleValueWidget({
        title: "Pending Consumed",
        metrics: channelMetrics("PendingMessagesConsumed", "Sum", cloudwatch.Unit.COUNT),
        width: 4,
        height: 4,
      }),
      new cloudwatch.GraphWidget({
        title: "Message Latency Trend",
        left: channelMetrics("MessageLatency", "Average", cloudwatch.Unit.MILLISECONDS),
        width: 8,
        height: 4,
        leftYAxis: { label: "ms" },
      }),
    );

    // ════════════════════════════════════════════════════════════════
    //  Section 3: Lambda Functions
    // ════════════════════════════════════════════════════════════════

    dashboard.addWidgets(
      sectionHeader(
        "Lambda Functions",
        "Gateway Lambda 호출 수, 에러, 실행 시간. ws-message와 telegram-webhook이 핵심 핸들러.",
      ),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Invocations",
        left: LAMBDA_FUNCTIONS.map((fn) =>
          lambdaMetric(fn, "Invocations", "Sum"),
        ),
        width: 8,
        height: 4,
      }),
      new cloudwatch.GraphWidget({
        title: "Errors",
        left: LAMBDA_FUNCTIONS.map((fn) =>
          lambdaMetric(fn, "Errors", "Sum"),
        ),
        width: 8,
        height: 4,
      }),
      new cloudwatch.GraphWidget({
        title: "Duration — p50 / p99 (key handlers)",
        left: KEY_LAMBDA_FUNCTIONS.flatMap((fn) => [
          lambdaMetric(fn, "Duration", "p50"),
          lambdaMetric(fn, "Duration", "p99"),
        ]),
        width: 8,
        height: 4,
        leftYAxis: { label: "ms" },
      }),
    );

    // ════════════════════════════════════════════════════════════════
    //  Section 4: API Gateway
    // ════════════════════════════════════════════════════════════════

    dashboard.addWidgets(
      sectionHeader(
        "API Gateway",
        "WebSocket 연결 수와 HTTP API 에러율. 4xx는 클라이언트 에러, 5xx는 서버 에러.",
      ),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "WebSocket Connections",
        left: [
          new cloudwatch.Metric({
            namespace: "AWS/ApiGateway",
            metricName: "ConnectCount",
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 8,
        height: 4,
      }),
      new cloudwatch.GraphWidget({
        title: "HTTP API Errors — 4xx / 5xx",
        left: [
          new cloudwatch.Metric({
            namespace: "AWS/ApiGateway",
            metricName: "4xx",
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
            label: "4xx (client)",
          }),
          new cloudwatch.Metric({
            namespace: "AWS/ApiGateway",
            metricName: "5xx",
            statistic: "Sum",
            period: cdk.Duration.minutes(5),
            label: "5xx (server)",
          }),
        ],
        width: 8,
        height: 4,
      }),
    );

    // ════════════════════════════════════════════════════════════════
    //  Section 5: Infrastructure — ECS & DynamoDB
    // ════════════════════════════════════════════════════════════════

    dashboard.addWidgets(
      sectionHeader(
        "Infrastructure — ECS & DynamoDB",
        "Fargate 컨테이너 리소스 사용량과 DynamoDB 테이블별 읽기/쓰기 소비량.",
      ),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "Fargate CPU / Memory (%)",
        left: [
          new cloudwatch.Metric({
            namespace: "AWS/ECS",
            metricName: "CPUUtilization",
            dimensionsMap: { ClusterName: "serverless-openclaw" },
            statistic: "Average",
            period: cdk.Duration.minutes(5),
            label: "CPU",
          }),
          new cloudwatch.Metric({
            namespace: "AWS/ECS",
            metricName: "MemoryUtilization",
            dimensionsMap: { ClusterName: "serverless-openclaw" },
            statistic: "Average",
            period: cdk.Duration.minutes(5),
            label: "Memory",
          }),
        ],
        width: 8,
        height: 4,
        leftYAxis: { label: "%", max: 100 },
      }),
      new cloudwatch.GraphWidget({
        title: "DynamoDB Read Capacity",
        left: Object.values(TABLE_NAMES).map(
          (tableName) =>
            new cloudwatch.Metric({
              namespace: "AWS/DynamoDB",
              metricName: "ConsumedReadCapacityUnits",
              dimensionsMap: { TableName: tableName },
              statistic: "Sum",
              period: cdk.Duration.minutes(5),
              label: tableName.replace("serverless-openclaw-", ""),
            }),
        ),
        width: 8,
        height: 4,
        leftYAxis: { label: "RCU" },
      }),
      new cloudwatch.GraphWidget({
        title: "DynamoDB Write Capacity",
        left: Object.values(TABLE_NAMES).map(
          (tableName) =>
            new cloudwatch.Metric({
              namespace: "AWS/DynamoDB",
              metricName: "ConsumedWriteCapacityUnits",
              dimensionsMap: { TableName: tableName },
              statistic: "Sum",
              period: cdk.Duration.minutes(5),
              label: tableName.replace("serverless-openclaw-", ""),
            }),
        ),
        width: 8,
        height: 4,
        leftYAxis: { label: "WCU" },
      }),
    );
  }
}
