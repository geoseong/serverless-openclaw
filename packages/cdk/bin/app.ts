#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
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

const app = new cdk.App();

// Secrets (SSM SecureString parameters)
const secrets = new SecretsStack(app, "SecretsStack");

// Step 1-2: Network & Storage
const network = new NetworkStack(app, "NetworkStack");
const storage = new StorageStack(app, "StorageStack");

// Step 1-6: Auth
const auth = new AuthStack(app, "AuthStack");

// Step 1-7: Compute
const compute = new ComputeStack(app, "ComputeStack", {
  vpc: network.vpc,
  fargateSecurityGroup: network.fargateSecurityGroup,
  conversationsTable: storage.conversationsTable,
  settingsTable: storage.settingsTable,
  taskStateTable: storage.taskStateTable,
  connectionsTable: storage.connectionsTable,
  pendingMessagesTable: storage.pendingMessagesTable,
  dataBucket: storage.dataBucket,
  ecrRepository: storage.ecrRepository,
  fargateCpu: process.env.FARGATE_CPU ? Number(process.env.FARGATE_CPU) : undefined,
  fargateMemory: process.env.FARGATE_MEMORY ? Number(process.env.FARGATE_MEMORY) : undefined,
});

compute.addDependency(secrets);

// Step 1-5: API Gateway + Lambda
// Note: compute resources (TaskDef, Cluster ARNs) read from SSM to avoid cross-stack export issues
const api = new ApiStack(app, "ApiStack", {
  vpc: network.vpc,
  fargateSecurityGroup: network.fargateSecurityGroup,
  conversationsTable: storage.conversationsTable,
  settingsTable: storage.settingsTable,
  taskStateTable: storage.taskStateTable,
  connectionsTable: storage.connectionsTable,
  pendingMessagesTable: storage.pendingMessagesTable,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
});
api.addDependency(compute);
api.addDependency(secrets);

// Step 1-8: Web UI (S3 + CloudFront)
new WebStack(app, "WebStack", {
  webSocketUrl: `wss://${api.webSocketApi.apiId}.execute-api.${cdk.Aws.REGION}.amazonaws.com/prod`,
  apiUrl: api.httpApi.apiEndpoint,
  userPoolId: auth.userPool.userPoolId,
  userPoolClientId: auth.userPoolClient.userPoolClientId,
});

// Monitoring Dashboard
new MonitoringStack(app, "MonitoringStack");

app.synth();
