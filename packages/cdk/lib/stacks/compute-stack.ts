import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";
import { BRIDGE_PORT, TABLE_NAMES } from "@serverless-openclaw/shared";

export interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  fargateSecurityGroup: ec2.ISecurityGroup;
  conversationsTable: dynamodb.ITable;
  settingsTable: dynamodb.ITable;
  taskStateTable: dynamodb.ITable;
  connectionsTable: dynamodb.ITable;
  pendingMessagesTable: dynamodb.ITable;
  dataBucket: s3.IBucket;
  ecrRepository: ecr.IRepository;
}

export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly taskRole: iam.IRole;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    // Secrets Manager references (manually created)
    const bridgeAuthToken = secretsmanager.Secret.fromSecretNameV2(
      this,
      "BridgeAuthToken",
      "serverless-openclaw/bridge-auth-token",
    );
    const openclawGatewayToken = secretsmanager.Secret.fromSecretNameV2(
      this,
      "OpenclawGatewayToken",
      "serverless-openclaw/openclaw-gateway-token",
    );
    const anthropicApiKey = secretsmanager.Secret.fromSecretNameV2(
      this,
      "AnthropicApiKey",
      "serverless-openclaw/anthropic-api-key",
    );

    // ECS Cluster — FARGATE_SPOT only
    this.cluster = new ecs.Cluster(this, "Cluster", {
      clusterName: "serverless-openclaw",
      vpc: props.vpc,
      enableFargateCapacityProviders: true,
    });

    // Fargate Task Definition — ARM64, minimal resources
    this.taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
      memoryLimitMiB: 1024,
      cpu: 256,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    this.taskRole = this.taskDefinition.taskRole;

    // Container
    const logGroup = new logs.LogGroup(this, "TaskLogs", {
      logGroupName: "/ecs/serverless-openclaw",
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.taskDefinition.addContainer("openclaw", {
      image: ecs.ContainerImage.fromEcrRepository(props.ecrRepository, "latest"),
      portMappings: [{ containerPort: BRIDGE_PORT }],
      environment: {
        CONVERSATIONS_TABLE: TABLE_NAMES.CONVERSATIONS,
        SETTINGS_TABLE: TABLE_NAMES.SETTINGS,
        TASK_STATE_TABLE: TABLE_NAMES.TASK_STATE,
        CONNECTIONS_TABLE: TABLE_NAMES.CONNECTIONS,
        PENDING_MESSAGES_TABLE: TABLE_NAMES.PENDING_MESSAGES,
        DATA_BUCKET: props.dataBucket.bucketName,
        BRIDGE_PORT: String(BRIDGE_PORT),
      },
      secrets: {
        BRIDGE_AUTH_TOKEN: ecs.Secret.fromSecretsManager(bridgeAuthToken),
        OPENCLAW_GATEWAY_TOKEN: ecs.Secret.fromSecretsManager(openclawGatewayToken),
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(anthropicApiKey),
      },
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: "openclaw",
      }),
      healthCheck: {
        command: ["CMD-SHELL", `curl -f http://localhost:${BRIDGE_PORT}/health || exit 1`],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(120),
      },
    });

    // IAM — Task Role permissions
    const tables = [
      props.conversationsTable,
      props.settingsTable,
      props.taskStateTable,
      props.connectionsTable,
      props.pendingMessagesTable,
    ];
    for (const table of tables) {
      table.grantReadWriteData(this.taskRole);
    }
    props.dataBucket.grantReadWrite(this.taskRole);

    // Secrets read access
    bridgeAuthToken.grantRead(this.taskRole);
    openclawGatewayToken.grantRead(this.taskRole);
    anthropicApiKey.grantRead(this.taskRole);

    // API Gateway @connections for pushing messages back to WebSocket clients
    this.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["execute-api:ManageConnections"],
        resources: ["*"],
      }),
    );

    // Outputs
    new cdk.CfnOutput(this, "ClusterArn", { value: this.cluster.clusterArn });
    new cdk.CfnOutput(this, "TaskDefinitionArn", {
      value: this.taskDefinition.taskDefinitionArn,
    });
  }
}
