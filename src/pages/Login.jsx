import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth.jsx";
import Brand from "../components/Brand.jsx";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "go"];

export default function Login() {
  const { login } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pinRef = useRef("");
  pinRef.current = pin;

  async function submit(value = pinRef.current) {
    if (!value || busy) return;
    setBusy(true);
    setError("");
    try {
      await login(value);
    } catch (err) {
      setError(err.message || "Could not sign in.");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  function press(key) {
    if (key === "clear") {
      setPin("");
      setError("");
      return;
    }
    if (key === "go") {
      submit();
      return;
    }
    setPin((current) => {
      const next = current.length >= 8 ? current : current + key;
      if (next.length === 4) setTimeout(() => submit(next), 0);
      return next;
    });
  }

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Enter") submit();
      if (event.key === "Backspace") {
        event.preventDefault();
        setPin((current) => current.slice(0, -1));
      }
      if (/^[0-9]$/.test(event.key)) press(event.key);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);

  return (
    <div className="grid min-h-full place-items-center bg-deep px-4">
      <div className="w-full max-w-sm rounded-3xl border border-cyan/20 bg-darker p-8 shadow-glow">
        <div className="mb-6">
          <Brand size="lg" subtitle="Unlock with your PIN" />
        </div>

        <div className="mb-5 flex justify-center gap-2">
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <span
              key={i}
              className={`h-3 w-3 rounded-full ${i < pin.length ? "bg-cyan" : "bg-white/15"}`}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          {KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="pad-btn"
              onClick={() => press(key)}
              disabled={busy}
            >
              {key === "clear" ? "C" : key === "go" ? "→" : key}
            </button>
          ))}
        </div>

        {error ? <p className="mt-4 text-center text-sm text-danger">{error}</p> : null}
        <p className="mt-5 text-center text-xs text-muted">Session lasts 4 hours.</p>
      </div>
    </div>
  );
}
