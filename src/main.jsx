import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { AuthProvider } from "./auth.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  import.meta.env.DEV ? (
    <StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </StrictMode>
  ) : (
    <AuthProvider>
      <App />
    </AuthProvider>
  )
);
