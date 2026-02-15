---
name: architecture
description: References Serverless OpenClaw architecture. Covers network design, CDK stack structure, DynamoDB data model, API protocols, and container design.
allowed-tools: Read, Glob, Grep
---

# Architecture Reference

## Design Documents

- [architecture.md](../../../docs/architecture.md) — VPC/network, security groups, CDK stacks, DynamoDB schema, API protocols, security model
- [implementation-plan.md](../../../docs/implementation-plan.md) — Detailed design based on MoltWorker reference
- [cold-start-analysis.md](../../../docs/cold-start-analysis.md) — Cold start timeline, bottleneck analysis, optimization roadmap (issues #2-#6)

## Core Architecture Principles

1. **Cost minimization**: No NAT Gateway, no ALB, no Interface Endpoints
2. **Serverless-first**: Lambda (events), Fargate Spot (long-running), DynamoDB (PAY_PER_REQUEST)
3. **Single responsibility**: 6 separate Lambdas, 6 separate CDK stacks
4. **Layer separation**: API Gateway → Lambda → Bridge → OpenClaw Gateway
5. **Protocol translation**: Lambda(HTTP) ↔ Bridge ↔ OpenClaw Gateway(JSON-RPC 2.0 WebSocket)
