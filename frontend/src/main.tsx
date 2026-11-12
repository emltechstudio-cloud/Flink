import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FlinkShell } from "./components/flink/shell";
import { RoomPage } from "./room-page";
import "./styles.css";
import { registerServiceWorker } from "./pwa";

function App() {
  const [route, setRoute] = useState(() => window.location.hash);
  useEffect(() => {
    registerServiceWorker();
    const sync = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const match = route.match(/^#room\/([^?]+)(?:\?(.*))?$/);
  if (match) {
    const params = new URLSearchParams(match[2] ?? "");
    let id = match[1]!;
    try { id = decodeURIComponent(id); } catch { /* malformed percent escapes remain literal */ }
    return <RoomPage id={id} mode={params.get("mode") ?? "video"} title={params.get("title") ?? "Room"} host={params.get("host") ?? undefined} />;
  }
  return <FlinkShell />;
}

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Flink runtime error", error, info.componentStack);
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-bg p-6 text-center">
          <section className="max-w-md rounded-2xl border border-danger/20 bg-surface p-6 shadow-lg">
            <h1 className="text-lg font-semibold text-fg">Flink ran into a temporary problem</h1>
            <p className="mt-2 text-sm text-muted">Your recording was not sent. Refresh the app and try again.</p>
            <p className="mt-3 break-words rounded-lg bg-danger/5 p-2 text-left font-mono text-xs text-danger">{this.state.error.message}</p>
            <button type="button" className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg" onClick={() => window.location.reload()}>Refresh Flink</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("app")!).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>,
);
