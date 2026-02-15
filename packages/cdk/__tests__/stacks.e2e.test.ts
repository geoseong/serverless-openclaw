import { describe, it, expect, beforeAll } from "vitest";
import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import {
  NetworkStack,
  StorageStack,
  AuthStack,
  ComputeStack,
  ApiStack,
  WebStack,
  MonitoringStack,
  SecretsStack,
} from "../lib/stacks/index.js";

describe("CDK Stacks E2E — synth all stacks", () => {
  let app: cdk.App;
  let networkTemplate: Template;
  let storageTemplate: Template;
  let authTemplate: Template;
  let computeTemplate: Template;
  let apiTemplate: Template;
  let webTemplate: Template;
  let monitoringTemplate: Template;
  let secretsTemplate: Template;

  beforeAll(() => {
    app = new cdk.App();

    // Secrets
    const secrets = new SecretsStack(app, "TestSecretsStack");

    // Step 1-2: Network & Storage
    const network = new NetworkStack(app, "TestNetworkStack");
    const storage = new StorageStack(app, "TestStorageStack");

    // Step 1-6: Auth
    const auth = new AuthStack(app, "TestAuthStack");

    // Step 1-7: Compute
    const compute = new ComputeStack(app, "TestComputeStack", {
      vpc: network.vpc,
      fargateSecurityGroup: network.fargateSecurityGroup,
      conversationsTable: storage.conversationsTable,
      settingsTable: storage.settingsTable,
      taskStateTable: storage.taskStateTable,
      connectionsTable: storage.connectionsTable,
      pendingMessagesTable: storage.pendingMessagesTable,
      dataBucket: storage.dataBucket,
      ecrRepository: storage.ecrRepository,
    });

    // Step 1-5: API Gateway + Lambda
    const api = new ApiStack(app, "TestApiStack", {
      vpc: network.vpc,
      fargateSecurityGroup: network.fargateSecurityGroup,
      conversationsTable: storage.conversationsTable,
      settingsTable: storage.settingsTable,
      taskStateTable: storage.taskStateTable,
      connectionsTable: storage.connectionsTable,
      pendingMessagesTable: storage.pendingMessagesTable,
      userPool: auth.userPool,
      userPoolClient: auth.userPoolClient,
      cluster: compute.cluster,
      taskDefinition: compute.taskDefinition,
    });

    // Step 1-8: Web UI
    new WebStack(app, "TestWebStack", {
      webSocketUrl: "wss://test.execute-api.us-east-1.amazonaws.com/prod",
      apiUrl: "https://test.execute-api.us-east-1.amazonaws.com",
      userPoolId: "us-east-1_test",
      userPoolClientId: "testclientid",
    });

    // Monitoring Dashboard
    const monitoring = new MonitoringStack(app, "TestMonitoringStack");

    secretsTemplate = Template.fromStack(secrets);
    networkTemplate = Template.fromStack(network);
    storageTemplate = Template.fromStack(storage);
    authTemplate = Template.fromStack(auth);
    computeTemplate = Template.fromStack(compute);
    apiTemplate = Template.fromStack(api);
    webTemplate = Template.fromStack(app.node.findChild("TestWebStack") as cdk.Stack);
    monitoringTemplate = Template.fromStack(monitoring);
  });

  // ── SecretsStack ──

  describe("SecretsStack", () => {
    it("5 SSM SecureString parameters via Custom Resources", () => {
      secretsTemplate.resourceCountIs("Custom::AWS", 5);
    });
  });

  // ── NetworkStack ──

  describe("NetworkStack", () => {
    it("VPC with natGateways: 0", () => {
      networkTemplate.resourceCountIs("AWS::EC2::VPC", 1);
      networkTemplate.resourceCountIs("AWS::EC2::NatGateway", 0);
    });

    it("Public subnets in 2 AZs", () => {
      networkTemplate.resourceCountIs("AWS::EC2::Subnet", 2);
    });

    it("VPC Gateway Endpoints (DynamoDB + S3)", () => {
      networkTemplate.resourceCountIs("AWS::EC2::VPCEndpoint", 2);
    });

    it("Fargate Security Group", () => {
      networkTemplate.resourceCountIs("AWS::EC2::SecurityGroup", 1);
    });
  });

  // ── StorageStack ──

  describe("StorageStack", () => {
    it("5 DynamoDB tables", () => {
      storageTemplate.resourceCountIs("AWS::DynamoDB::Table", 5);
    });

    it("all tables use PAY_PER_REQUEST", () => {
      const tables = storageTemplate.findResources("AWS::DynamoDB::Table");
      for (const [, table] of Object.entries(tables)) {
        expect((table as Record<string, unknown>).Properties).toHaveProperty(
          "BillingMode",
          "PAY_PER_REQUEST",
        );
      }
    });

    it("Connections table has userId-index GSI", () => {
      storageTemplate.hasResourceProperties("AWS::DynamoDB::Table", {
        TableName: "serverless-openclaw-Connections",
        GlobalSecondaryIndexes: [
          {
            IndexName: "userId-index",
          },
        ],
      });
    });

    it("S3 data bucket with BlockPublicAccess", () => {
      storageTemplate.resourceCountIs("AWS::S3::Bucket", 1);
      storageTemplate.hasResourceProperties("AWS::S3::Bucket", {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    it("ECR repository", () => {
      storageTemplate.resourceCountIs("AWS::ECR::Repository", 1);
    });
  });

  // ── AuthStack ──

  describe("AuthStack", () => {
    it("Cognito User Pool", () => {
      authTemplate.resourceCountIs("AWS::Cognito::UserPool", 1);
    });

    it("User Pool Client with SRP auth", () => {
      authTemplate.hasResourceProperties("AWS::Cognito::UserPoolClient", {
        ExplicitAuthFlows: ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
      });
    });

    it("User Pool Domain", () => {
      authTemplate.resourceCountIs("AWS::Cognito::UserPoolDomain", 1);
    });
  });

  // ── ComputeStack ──

  describe("ComputeStack", () => {
    it("ECS Cluster", () => {
      computeTemplate.resourceCountIs("AWS::ECS::Cluster", 1);
    });

    it("Fargate Task Definition with ARM64", () => {
      computeTemplate.hasResourceProperties("AWS::ECS::TaskDefinition", {
        RuntimePlatform: {
          CpuArchitecture: "ARM64",
          OperatingSystemFamily: "LINUX",
        },
        Cpu: "2048",
        Memory: "4096",
      });
    });

    it("CloudWatch Log Group", () => {
      computeTemplate.resourceCountIs("AWS::Logs::LogGroup", 1);
    });
  });

  // ── ApiStack ──

  describe("ApiStack", () => {
    it("6 Lambda functions", () => {
      apiTemplate.resourceCountIs("AWS::Lambda::Function", 6);
    });

    it("WebSocket API", () => {
      apiTemplate.resourceCountIs("AWS::ApiGatewayV2::Api", 2); // WS + HTTP
    });

    it("WebSocket stage (prod)", () => {
      apiTemplate.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
        StageName: "prod",
        AutoDeploy: true,
      });
    });

    it("EventBridge watchdog rule", () => {
      apiTemplate.resourceCountIs("AWS::Events::Rule", 1);
    });

    it("Lambda functions use ARM64", () => {
      const functions = apiTemplate.findResources("AWS::Lambda::Function");
      for (const [, fn] of Object.entries(functions)) {
        expect((fn as Record<string, unknown>).Properties).toHaveProperty(
          "Architectures",
          ["arm64"],
        );
      }
    });
  });

  // ── WebStack ──

  describe("WebStack", () => {
    it("S3 bucket for web assets", () => {
      webTemplate.resourceCountIs("AWS::S3::Bucket", 1);
    });

    it("CloudFront distribution", () => {
      webTemplate.resourceCountIs("AWS::CloudFront::Distribution", 1);
    });

    it("CloudFront OAC", () => {
      webTemplate.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
    });

    it("SPA error responses (403, 404 → index.html)", () => {
      webTemplate.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          CustomErrorResponses: [
            {
              ErrorCode: 403,
              ResponseCode: 200,
              ResponsePagePath: "/index.html",
            },
            {
              ErrorCode: 404,
              ResponseCode: 200,
              ResponsePagePath: "/index.html",
            },
          ],
        },
      });
    });
  });

  // ── MonitoringStack ──

  describe("MonitoringStack", () => {
    it("CloudWatch Dashboard", () => {
      monitoringTemplate.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
    });

    it("Dashboard named ServerlessOpenClaw", () => {
      monitoringTemplate.hasResourceProperties("AWS::CloudWatch::Dashboard", {
        DashboardName: "ServerlessOpenClaw",
      });
    });
  });
});
