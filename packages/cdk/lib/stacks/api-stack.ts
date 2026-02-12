import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import {
  WebSocketApi,
  WebSocketStage,
  HttpApi,
  HttpMethod,
} from "aws-cdk-lib/aws-apigatewayv2";
import {
  WebSocketLambdaIntegration,
  HttpLambdaIntegration,
} from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import type { Construct } from "constructs";
import { WATCHDOG_INTERVAL_MINUTES } from "@serverless-openclaw/shared";

export interface ApiStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  fargateSecurityGroup: ec2.ISecurityGroup;
  conversationsTable: dynamodb.ITable;
  settingsTable: dynamodb.ITable;
  taskStateTable: dynamodb.ITable;
  connectionsTable: dynamodb.ITable;
  pendingMessagesTable: dynamodb.ITable;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  cluster: ecs.ICluster;
  taskDefinition: ecs.FargateTaskDefinition;
}

export class ApiStack extends cdk.Stack {
  public readonly webSocketApi: WebSocketApi;
  public readonly webSocketStage: WebSocketStage;
  public readonly httpApi: HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const monorepoRoot = path.join(__dirname, "..", "..", "..", "..");
    const handlersDir = path.join(monorepoRoot, "packages", "gateway", "src", "handlers");

    // Secrets Manager references
    const bridgeAuthToken = secretsmanager.Secret.fromSecretNameV2(
      this,
      "BridgeAuthToken",
      "serverless-openclaw/bridge-auth-token",
    );
    const telegramBotToken = secretsmanager.Secret.fromSecretNameV2(
      this,
      "TelegramBotToken",
      "serverless-openclaw/telegram-bot-token",
    );
    const telegramWebhookSecretName = "serverless-openclaw/telegram-webhook-secret";
    const telegramWebhookSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "TelegramWebhookSecret",
      telegramWebhookSecretName,
    );

    // Common environment variables for Lambda functions
    const subnetIds = props.vpc.publicSubnets.map((s) => s.subnetId).join(",");
    const securityGroupIds = props.fargateSecurityGroup.securityGroupId;

    const commonEnv: Record<string, string> = {
      CONVERSATIONS_TABLE: props.conversationsTable.tableName,
      SETTINGS_TABLE: props.settingsTable.tableName,
      TASK_STATE_TABLE: props.taskStateTable.tableName,
      CONNECTIONS_TABLE: props.connectionsTable.tableName,
      PENDING_MESSAGES_TABLE: props.pendingMessagesTable.tableName,
      ECS_CLUSTER_ARN: props.cluster.clusterArn,
      TASK_DEFINITION_ARN: props.taskDefinition.taskDefinitionArn,
      SUBNET_IDS: subnetIds,
      SECURITY_GROUP_IDS: securityGroupIds,
    };

    // Common bundling options for NodejsFunction
    const bundlingDefaults = {
      externalModules: ["@aws-sdk/*"],
      sourceMap: true,
      target: "node20",
    };

    const nodejsFunctionDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      projectRoot: monorepoRoot,
      depsLockFilePath: path.join(monorepoRoot, "package-lock.json"),
      bundling: bundlingDefaults,
    };

    // ── Lambda Functions ──

    const wsConnectFn = new NodejsFunction(this, "WsConnectFn", {
      ...nodejsFunctionDefaults,
      functionName: "serverless-openclaw-ws-connect",
      entry: path.join(handlersDir, "ws-connect.ts"),
      handler: "handler",
      environment: { ...commonEnv },
    });

    const wsDisconnectFn = new NodejsFunction(this, "WsDisconnectFn", {
      ...nodejsFunctionDefaults,
      functionName: "serverless-openclaw-ws-disconnect",
      entry: path.join(handlersDir, "ws-disconnect.ts"),
      handler: "handler",
      environment: { ...commonEnv },
    });

    const wsMessageFn = new NodejsFunction(this, "WsMessageFn", {
      ...nodejsFunctionDefaults,
      functionName: "serverless-openclaw-ws-message",
      entry: path.join(handlersDir, "ws-message.ts"),
      handler: "handler",
      environment: { ...commonEnv },
    });

    const telegramWebhookFn = new NodejsFunction(this, "TelegramWebhookFn", {
      ...nodejsFunctionDefaults,
      functionName: "serverless-openclaw-telegram-webhook",
      entry: path.join(handlersDir, "telegram-webhook.ts"),
      handler: "handler",
      environment: { ...commonEnv },
    });

    const apiHandlerFn = new NodejsFunction(this, "ApiHandlerFn", {
      ...nodejsFunctionDefaults,
      functionName: "serverless-openclaw-api-handler",
      entry: path.join(handlersDir, "api-handler.ts"),
      handler: "handler",
      environment: { ...commonEnv },
    });

    const watchdogFn = new NodejsFunction(this, "WatchdogFn", {
      ...nodejsFunctionDefaults,
      functionName: "serverless-openclaw-watchdog",
      entry: path.join(handlersDir, "watchdog.ts"),
      handler: "handler",
      environment: { ...commonEnv },
    });

    // Inject secrets as env vars
    const secretFunctions = [wsMessageFn, telegramWebhookFn, watchdogFn];
    for (const fn of secretFunctions) {
      fn.addEnvironment("BRIDGE_AUTH_TOKEN", bridgeAuthToken.secretValue.unsafeUnwrap());
    }
    telegramWebhookFn.addEnvironment(
      "TELEGRAM_SECRET_TOKEN",
      cdk.SecretValue.secretsManager(telegramWebhookSecretName).unsafeUnwrap(),
    );
    telegramWebhookFn.addEnvironment(
      "TELEGRAM_BOT_TOKEN",
      telegramBotToken.secretValue.unsafeUnwrap(),
    );

    // ── IAM Permissions for all Lambda functions ──

    const allFunctions = [
      wsConnectFn,
      wsDisconnectFn,
      wsMessageFn,
      telegramWebhookFn,
      apiHandlerFn,
      watchdogFn,
    ];

    const tables = [
      props.conversationsTable,
      props.settingsTable,
      props.taskStateTable,
      props.connectionsTable,
      props.pendingMessagesTable,
    ];

    for (const fn of allFunctions) {
      for (const table of tables) {
        table.grantReadWriteData(fn);
      }
    }

    // ECS + EC2 permissions for functions that need container management
    const containerFunctions = [wsMessageFn, telegramWebhookFn, watchdogFn];
    for (const fn of containerFunctions) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: [
            "ecs:RunTask",
            "ecs:StopTask",
            "ecs:DescribeTasks",
          ],
          resources: ["*"],
        }),
      );
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["ec2:DescribeNetworkInterfaces"],
          resources: ["*"],
        }),
      );
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["iam:PassRole"],
          resources: [
            props.taskDefinition.taskRole.roleArn,
            props.taskDefinition.executionRole!.roleArn,
          ],
        }),
      );
    }

    // Secrets read access
    bridgeAuthToken.grantRead(wsMessageFn);
    bridgeAuthToken.grantRead(telegramWebhookFn);
    bridgeAuthToken.grantRead(watchdogFn);
    telegramBotToken.grantRead(telegramWebhookFn);
    telegramWebhookSecret.grantRead(telegramWebhookFn);

    // ── WebSocket API ──

    this.webSocketApi = new WebSocketApi(this, "WebSocketApi", {
      apiName: "serverless-openclaw-ws",
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration("WsConnectInteg", wsConnectFn),
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration("WsDisconnectInteg", wsDisconnectFn),
      },
      defaultRouteOptions: {
        integration: new WebSocketLambdaIntegration("WsMessageInteg", wsMessageFn),
      },
    });

    this.webSocketStage = new WebSocketStage(this, "WebSocketStage", {
      webSocketApi: this.webSocketApi,
      stageName: "prod",
      autoDeploy: true,
    });

    // WebSocket callback URL for @connections
    const callbackUrl = this.webSocketStage.callbackUrl;
    for (const fn of [wsMessageFn, telegramWebhookFn, watchdogFn]) {
      fn.addEnvironment("WEBSOCKET_CALLBACK_URL", callbackUrl);
    }

    // Grant execute-api:ManageConnections for WebSocket push
    for (const fn of containerFunctions) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["execute-api:ManageConnections"],
          resources: [
            `arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/*`,
          ],
        }),
      );
    }

    // ── HTTP API (REST) ──

    const jwtIssuer = `https://cognito-idp.${this.region}.amazonaws.com/${props.userPool.userPoolId}`;
    const jwtAuthorizer = new HttpJwtAuthorizer("CognitoAuthorizer", jwtIssuer, {
      jwtAudience: [props.userPoolClient.userPoolClientId],
    });

    this.httpApi = new HttpApi(this, "HttpApi", {
      apiName: "serverless-openclaw-http",
    });

    // POST /telegram — no authorizer (Telegram secret token verified in Lambda)
    this.httpApi.addRoutes({
      path: "/telegram",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("TelegramInteg", telegramWebhookFn),
    });

    // GET /conversations — Cognito JWT
    this.httpApi.addRoutes({
      path: "/conversations",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("ConversationsInteg", apiHandlerFn),
      authorizer: jwtAuthorizer,
    });

    // GET /status — Cognito JWT
    this.httpApi.addRoutes({
      path: "/status",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("StatusInteg", apiHandlerFn),
      authorizer: jwtAuthorizer,
    });

    // ── EventBridge Rule — Watchdog ──

    new events.Rule(this, "WatchdogRule", {
      ruleName: "serverless-openclaw-watchdog",
      schedule: events.Schedule.rate(cdk.Duration.minutes(WATCHDOG_INTERVAL_MINUTES)),
      targets: [new targets.LambdaFunction(watchdogFn)],
    });

    // ── Outputs ──

    new cdk.CfnOutput(this, "WebSocketApiEndpoint", {
      value: this.webSocketStage.url,
    });
    new cdk.CfnOutput(this, "HttpApiEndpoint", {
      value: this.httpApi.apiEndpoint,
    });
    new cdk.CfnOutput(this, "WebSocketCallbackUrl", {
      value: callbackUrl,
    });
  }
}
