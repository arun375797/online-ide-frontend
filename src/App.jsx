import { Component, lazy, Suspense, useEffect } from "react";
import { useAuth } from "./auth.jsx";
import Login from "./pages/Login.jsx";

const Ide = lazy(() => import("./pages/Ide.jsx"));

function bootIde() {
  return import("./pages/Ide.jsx");
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { message: "" };
  }

  static getDerivedStateFromError(error) {
    return { message: error?.message || "Something went wrong." };
  }

  render() {
    if (this.state.message) {
      return (
        <div className="grid h-full place-items-center bg-deep px-4 text-center text-muted">
          <div>
            <p className="mb-2 text-white">The IDE failed to load.</p>
            <p className="mb-4 text-sm">{this.state.message}</p>
            <button type="button" className="rounded-lg border border-cyan/20 px-3 py-2 text-sm text-cyan" onClick={() => window.location.reload()}>
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
