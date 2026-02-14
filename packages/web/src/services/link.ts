const BASE_URL = import.meta.env.VITE_API_URL;

async function postJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function getJson<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface LinkStatus {
  linked: boolean;
  telegramUserId?: string;
}

export function generateOtp(token: string): Promise<{ code: string }> {
  return postJson<{ code: string }>("/link/generate-otp", token);
}

export function getLinkStatus(token: string): Promise<LinkStatus> {
  return getJson<LinkStatus>("/link/status", token);
}

export function unlinkTelegram(token: string): Promise<void> {
  return postJson("/link/unlink", token).then(() => undefined);
}
