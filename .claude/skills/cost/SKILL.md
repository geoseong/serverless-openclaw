---
name: cost
description: References Serverless OpenClaw cost optimization guidelines. Validates that no resources exceeding the cost target ($1/month) are created during implementation. Use when writing CDK stacks or making infrastructure changes.
allowed-tools: Read, Glob, Grep
---

# Cost Optimization Reference

## Detailed Cost Analysis

Per-service cost breakdown, before/after optimization comparison, checklist:
- [cost-optimization.md](../../../docs/cost-optimization.md)
- [cold-start-analysis.md](../../../docs/cold-start-analysis.md) — Cold start optimization proposals with cost impact analysis (CPU upgrade, SOCI, timeout tuning)

## Cost Validation (Required for Infrastructure Changes)

Verify the following resources are **NOT created**:

| Prohibited Resource | Monthly Cost | Alternative |
|---------------------|-------------|-------------|
| NAT Gateway | ~$33 | Fargate Public IP |
| ALB/ELB | ~$18-25 | API Gateway |
| Interface Endpoint | ~$7/each | Public IP for public endpoint access |
| DynamoDB Provisioned | Variable | PAY_PER_REQUEST |
| Lambda in VPC | Requires NAT | Deploy outside VPC |

## Cost Targets

| Category | Target |
|----------|--------|
| Within Free Tier | ~$0.23/month |
| After Free Tier | ~$1.07/month |
| Maximum allowed | Under $10/month |
