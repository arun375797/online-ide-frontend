import { lazy, Suspense, useEffect } from "react";
import { useAuth } from "./auth.jsx";
import Login from "./pages/Login.jsx";

const Ide = lazy(() => import("./pages/Ide.jsx"));

function bootIde() {
  return import("./pages/Ide.jsx");
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
    <Suspense fallback={<div className="grid h-full place-items-center bg-deep text-muted">Loading IDE…</div>}>
      <Ide />
    </Suspense>
  );
}
