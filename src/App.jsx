import { Component, lazy, Suspense, useEffect } from "react";
import { useAuth } from "./auth.jsx";
import Login from "./pages/Login.jsx";

const CHUNK_RELOAD_KEY = "myide.chunk-reload";

function isChunkLoadError(error) {
  return /dynamically imported module|Loading chunk|ChunkLoadError|error loading dynamically imported/i.test(String(error?.message || error || ""));
}

function reloadForStaleChunk() {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY) === "1") return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
  } catch {
    window.location.reload();
    return true;
  }
  const reload = () => window.location.reload();
  if (window.caches?.keys) {
    window.caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => window.caches.delete(key))))
      .finally(reload);
  } else {
    reload();
  }
  return true;
}

const Ide = lazy(() =>
  import("./pages/Ide.jsx").catch((error) => {
    if (isChunkLoadError(error) && reloadForStaleChunk()) {
      return new Promise(() => {});
    }
    throw error;
  })
);

function bootIde() {
  return import("./pages/Ide.jsx").catch(() => {});
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { message: "" };
  }

  static getDerivedStateFromError(error) {
    return { message: error?.message || "Something went wrong." };
  }

  componentDidCatch(error) {
    if (isChunkLoadError(error)) reloadForStaleChunk();
  }

  render() {
    if (this.state.message) {
      return (
        <div className="grid h-full place-items-center bg-deep px-4 text-center text-muted">
          <div>
            <p className="mb-2 text-white">The IDE failed to load.</p>
            <p className="mb-4 text-sm">{this.state.message}</p>
            <button
              type="button"
              className="rounded-lg border border-cyan/20 px-3 py-2 text-sm text-cyan"
              onClick={() => {
                try {
                  sessionStorage.removeItem(CHUNK_RELOAD_KEY);
                } catch {
                  /* ignore */
                }
                window.location.href = `${window.location.pathname}?t=${Date.now()}`;
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const { token } = useAuth();

  useEffect(() => {
    if (!token) return undefined;
    try {
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch {
      /* ignore */
    }
    return undefined;
  }, [token]);

  useEffect(() => {
    if (token) return undefined;
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 400));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const id = idle(() => {
      bootIde();
    });
    return () => cancel(id);
  }, [token]);

  if (!token) return <Login />;

  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="grid h-full place-items-center bg-deep text-muted">Loading IDE…</div>}>
        <Ide />
      </Suspense>
    </ErrorBoundary>
  );
}
