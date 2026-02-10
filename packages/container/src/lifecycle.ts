import { execSync } from "node:child_process";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  TABLE_NAMES,
  KEY_PREFIX,
  PERIODIC_BACKUP_INTERVAL_MS,
} from "@serverless-openclaw/shared";
import type { TaskStatus } from "@serverless-openclaw/shared";

interface LifecycleDeps {
  dynamoSend: (command: unknown) => Promise<unknown>;
  userId: string;
  taskArn: string;
  s3Bucket: string;
  s3Prefix: string;
  workspacePath: string;
}

export class LifecycleManager {
  private deps: LifecycleDeps;
  private backupTimer: ReturnType<typeof setInterval> | null = null;
  private _lastActivity: Date;

  constructor(deps: LifecycleDeps) {
    this.deps = deps;
    this._lastActivity = new Date();
  }

  get lastActivityTime(): Date {
    return this._lastActivity;
  }

  updateLastActivity(): void {
    this._lastActivity = new Date();
  }

  async updateTaskState(status: TaskStatus, publicIp?: string): Promise<void> {
    const item: Record<string, unknown> = {
      PK: `${KEY_PREFIX.USER}${this.deps.userId}`,
      taskArn: this.deps.taskArn,
      status,
      startedAt: new Date().toISOString(),
      lastActivity: this._lastActivity.toISOString(),
    };
    if (publicIp) {
      item.publicIp = publicIp;
    }
    if (status === "Idle") {
      item.ttl = Math.floor(Date.now() / 1000) + 86400; // 24h TTL for idle
    }
    await this.deps.dynamoSend(
      new PutCommand({
        TableName: TABLE_NAMES.TASK_STATE,
        Item: item,
      }),
    );
  }

  async backupToS3(): Promise<void> {
    execSync(
      `aws s3 sync ${this.deps.workspacePath} s3://${this.deps.s3Bucket}/${this.deps.s3Prefix} --quiet`,
    );
  }

  startPeriodicBackup(): void {
    this.backupTimer = setInterval(() => {
      this.backupToS3().catch(() => {
        // Backup failure is non-fatal
      });
    }, PERIODIC_BACKUP_INTERVAL_MS);
  }

  stopPeriodicBackup(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
      this.backupTimer = null;
    }
  }

  async gracefulShutdown(): Promise<void> {
    this.stopPeriodicBackup();
    await this.backupToS3();
    await this.updateTaskState("Idle");
  }
}
