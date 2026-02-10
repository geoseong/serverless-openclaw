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
