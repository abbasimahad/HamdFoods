"use client";

import { useEffect, useRef, useState } from "react";

export function PwaLifecycle() {
  const [online, setOnline] = useState(true);
  const [blockedSubmission, setBlockedSubmission] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const updateRequested = useRef(false);
  const reloadingForUpdate = useRef(false);

  useEffect(() => {
    const syncConnection = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) setBlockedSubmission(false);
    };
    const blockOfflineSubmission = (event: SubmitEvent) => {
      if (navigator.onLine) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setBlockedSubmission(true);
    };

    syncConnection();
    window.addEventListener("online", syncConnection);
    window.addEventListener("offline", syncConnection);
    document.addEventListener("submit", blockOfflineSubmission, true);
    return () => {
      window.removeEventListener("online", syncConnection);
      window.removeEventListener("offline", syncConnection);
      document.removeEventListener("submit", blockOfflineSubmission, true);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;

    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    const onControllerChange = () => {
      if (!updateRequested.current || reloadingForUpdate.current) return;
      reloadingForUpdate.current = true;
      window.location.reload();
    };
    const watchWorker = (worker: ServiceWorker | null) => {
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (!disposed && worker.state === "installed" && navigator.serviceWorker.controller)
          setWaitingWorker(worker);
      });
    };
    const onUpdateFound = () => watchWorker(registration?.installing ?? null);

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((current) => {
        if (disposed) return;
        registration = current;
        if (current.waiting && navigator.serviceWorker.controller)
          setWaitingWorker(current.waiting);
        current.addEventListener("updatefound", onUpdateFound);
        void current.update().catch(() => undefined);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      registration?.removeEventListener("updatefound", onUpdateFound);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (online && !waitingWorker) return null;

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="erp-chrome fixed inset-x-3 bottom-3 z-[70] mx-auto max-w-3xl space-y-2 sm:inset-x-6 sm:bottom-6"
    >
      {!online && (
        <section
          className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning-ink)] shadow-lg sm:flex sm:items-center sm:justify-between sm:gap-4"
          data-testid="offline-notice"
          role="status"
        >
          <div>
            <p className="font-bold">Hamd Foods ERP is offline</p>
            <p className="mt-1 leading-5">
              Live inventory, production, sales, and accounting actions require a connection.
              {blockedSubmission
                ? " Nothing was sent. Reconnect, review the form, and submit it again."
                : " No business transactions will be queued or replayed."}
            </p>
          </div>
          <button
            className="mt-3 min-h-11 w-full shrink-0 rounded-lg border border-[var(--warning-border)] bg-white px-4 font-semibold sm:mt-0 sm:w-auto"
            onClick={() => window.location.reload()}
            type="button"
          >
            Retry connection
          </button>
        </section>
      )}
      {online && waitingWorker && (
        <section
          className="rounded-xl border border-[var(--info-border)] bg-[var(--info-surface)] p-3 text-sm text-[var(--info-ink)] shadow-lg sm:flex sm:items-center sm:justify-between sm:gap-4"
          data-testid="update-notice"
          role="status"
        >
          <div>
            <p className="font-bold">Application update available</p>
            <p className="mt-1 leading-5">Update now to load the latest compatible app shell.</p>
          </div>
          <button
            className="mt-3 min-h-11 w-full shrink-0 rounded-lg bg-[var(--info-ink)] px-4 font-semibold text-white sm:mt-0 sm:w-auto"
            onClick={() => {
              updateRequested.current = true;
              waitingWorker.postMessage({ type: "SKIP_WAITING" });
            }}
            type="button"
          >
            Update now
          </button>
        </section>
      )}
    </div>
  );
}
