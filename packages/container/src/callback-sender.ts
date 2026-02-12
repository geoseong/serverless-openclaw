import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import type { ServerMessage } from "@serverless-openclaw/shared";

export class CallbackSender {
  private client: ApiGatewayManagementApiClient;

  constructor(endpoint: string) {
    this.client = new ApiGatewayManagementApiClient({ endpoint });
  }

  async send(connectionId: string, data: ServerMessage): Promise<void> {
    // Telegram connections don't have WebSocket connectionIds — skip @connections
    // TODO: Route Telegram responses via Telegram Bot API
    if (connectionId.startsWith("telegram:")) {
      if (data.type === "stream_end" || data.type === "error") {
        console.log(`[callback] Telegram response complete for ${connectionId}`);
      }
      return;
    }

    try {
      await this.client.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: JSON.stringify(data),
        }),
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "GoneException") {
        // Client disconnected — silently ignore
        return;
      }
      throw err;
    }
  }
}
