#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { NetworkStack, StorageStack } from "../lib/stacks/index.js";

const app = new cdk.App();

// Step 1-2: Network & Storage
new NetworkStack(app, "NetworkStack");
new StorageStack(app, "StorageStack");

// Step 1-5에서 구현:
// new ApiStack(app, "ApiStack");

// Step 1-6에서 구현:
// new AuthStack(app, "AuthStack");

// Step 1-7에서 구현:
// new ComputeStack(app, "ComputeStack");

// Step 1-8에서 구현:
// new WebStack(app, "WebStack");

app.synth();
