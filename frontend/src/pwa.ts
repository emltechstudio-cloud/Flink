let installPrompt: BeforeInstallPromptEvent | null = null;

export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (navigator.serviceWorker.controller) {
    let refreshed = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshed) return;
      refreshed = true;
      window.location.reload();
    });
  }
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as BeforeInstallPromptEvent;
    const userAgent = navigator.userAgent;
    if (/Android/i.test(userAgent) && !/iPhone|iPad|Windows|Macintosh/i.test(userAgent)) {
      window.setTimeout(() => { void installApp(); }, 350);
    }
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
  });
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
    scope: import.meta.env.BASE_URL,
    updateViaCache: "none",
  }).catch((error) => console.warn("Flink offline shell could not start", error));
}

export async function installApp() {
  if (!installPrompt) {
    return;
  }
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
}

declare global {
  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  }
}
