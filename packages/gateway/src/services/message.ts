import { PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  TABLE_NAMES,
  KEY_PREFIX,
  BRIDGE_PORT,
  BRIDGE_HTTP_TIMEOUT_MS,
  PENDING_MESSAGE_TTL_SEC,
} from "@serverless-openclaw/shared";
import type {
  BridgeMessageRequest,
  PendingMessageItem,
  TaskStateItem,
} from "@serverless-openclaw/shared";
import type { StartTaskParams } from "./container.js";

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; statusText: string }>;
type Send = (command: unknown) => Promise<unknown>;

export async function sendToBridge(
  fetchFn: FetchFn,
  publicIp: string,
  authToken: string,
  body: BridgeMessageRequest,
): Promise<void> {
  const resp = await fetchFn(`http://${publicIp}:${BRIDGE_PORT}/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(BRIDGE_HTTP_TIMEOUT_MS),
  });

  if (!resp.ok) {
    throw new Error(`Bridge returned ${resp.status}`);
  }
}

export async function savePendingMessage(
  send: Send,
  item: PendingMessageItem,
): Promise<void> {
  await send(
    new PutCommand({
      TableName: TABLE_NAMES.PENDING_MESSAGES,
      Item: item,
    }),
  );
}

export interface RouteDeps {
  userId: string;
  message: string;
  channel: "web" | "telegram";
  connectionId: string;
  callbackUrl: string;
  bridgeAuthToken: string;
  fetchFn: FetchFn;
  getTaskState: (userId: string) => Promise<TaskStateItem | null>;
  startTask: (params: StartTaskParams) => Promise<string>;
  putTaskState: (item: TaskStateItem) => Promise<void>;
  savePendingMessage: (item: PendingMessageItem) => Promise<void>;
  deleteTaskState: (userId: string) => Promise<void>;
  startTaskParams: StartTaskParams;
}

export type RouteResult = "sent" | "queued" | "started";

export async function routeMessage(deps: RouteDeps): Promise<RouteResult> {
  const taskState = await deps.getTaskState(deps.userId);

  if (taskState?.status === "Running" && taskState.publicIp) {
    try {
      await sendToBridge(deps.fetchFn, taskState.publicIp, deps.bridgeAuthToken, {
        userId: deps.userId,
        message: deps.message,
        channel: deps.channel,
        connectionId: deps.connectionId,
        callbackUrl: deps.callbackUrl,
      });
      return "sent";
    } catch (err) {
      console.warn(`Bridge unreachable at ${taskState.publicIp}, falling back to pending queue`, err);
    }
  }

  // Save to pending messages
  const now = Date.now();
  const uuid = `${now}-${Math.random().toString(36).slice(2, 8)}`;
  await deps.savePendingMessage({
    PK: `${KEY_PREFIX.USER}${deps.userId}`,
    SK: `${KEY_PREFIX.MSG}${now}#${uuid}`,
    message: deps.message,
    channel: deps.channel,
    connectionId: deps.connectionId,
    createdAt: new Date(now).toISOString(),
    ttl: Math.floor(now / 1000) + PENDING_MESSAGE_TTL_SEC,
  });

  // If no task or stale Running state, clear stale state and start a new one
  if (!taskState || (taskState.status === "Running" && taskState.publicIp)) {
    if (taskState) {
      await deps.deleteTaskState(deps.userId);
    }
    const taskArn = await deps.startTask(deps.startTaskParams);
    await deps.putTaskState({
      PK: `${KEY_PREFIX.USER}${deps.userId}`,
      taskArn,
      status: "Starting",
      startedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    });
    return "started";
  }

  return "queued";
}
