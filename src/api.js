const TOKEN_KEY = "myide.token";
const EXP_KEY = "myide.exp";

function apiBase() {
  const raw = String(import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (/\.railway\.internal(?:[:/?#]|$)/i.test(raw)) {
    throw new Error(
      "VITE_API_URL is a Railway private hostname. Use the public URL from Railway → Settings → Networking (https://….up.railway.app), then redeploy the client."
    );
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
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
    const fallback =
      res.status === 405
        ? "API URL is wrong. Set VITE_API_URL to the public Railway HTTPS URL and redeploy."
        : "Request failed";
    const error = new Error(data.error || fallback);
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
