const TOKEN_KEY = "myide.token";
const EXP_KEY = "myide.exp";

function apiBase() {
  return import.meta.env.VITE_API_URL || "";
}

export async function api(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || "Request failed");
    error.status = res.status;
    throw error;
  }
  return data;
}

export function readSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiresAt = Number(localStorage.getItem(EXP_KEY) || 0);
  if (!token || expiresAt <= Date.now()) {
    clearSession();
    return { token: null, expiresAt: 0 };
  }
  return { token, expiresAt };
}

export function saveSession(token, expiresAt) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EXP_KEY, String(expiresAt));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EXP_KEY);
}
