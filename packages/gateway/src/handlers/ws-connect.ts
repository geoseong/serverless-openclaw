import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { saveConnection } from "../services/connections.js";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamoSend = ddb.send.bind(ddb) as (cmd: any) => Promise<any>;

export async function handler(event: {
  requestContext: {
    connectionId?: string;
    authorizer?: { jwt?: { claims?: { sub?: string } } };
  };
}): Promise<APIGatewayProxyResultV2> {
  const connectionId = event.requestContext.connectionId;
  const userId = event.requestContext.authorizer?.jwt?.claims?.sub;

  if (!userId) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  await saveConnection(dynamoSend, connectionId!, userId);

  return { statusCode: 200, body: "Connected" };
}
