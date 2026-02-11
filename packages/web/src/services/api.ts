const BASE_URL = import.meta.env.VITE_API_URL;

async function request<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface StatusResponse {
  status: string;
  publicIp?: string;
}

export function fetchConversations(token: string): Promise<ConversationMessage[]> {
  return request<ConversationMessage[]>("/conversations", token);
}

export function fetchStatus(token: string): Promise<StatusResponse> {
  return request<StatusResponse>("/status", token);
}
