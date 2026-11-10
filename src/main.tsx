import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import "./index.css";
import "./silver-theme.css";
import "./avanca-theme.css";

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);

