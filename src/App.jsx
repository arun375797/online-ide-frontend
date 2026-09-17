import { useAuth } from "./auth.jsx";
import Login from "./pages/Login.jsx";
import Ide from "./pages/Ide.jsx";

export default function App() {
  const { token } = useAuth();
  return token ? <Ide /> : <Login />;
}
