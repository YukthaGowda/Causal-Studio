import { useEffect, useState } from "react";
import { getBackendHealth } from "../api/health";

type Status = "checking" | "connected" | "disconnected";

export function BackendStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let isMounted = true;

    getBackendHealth()
      .then(() => {
        if (isMounted) {
          setStatus("connected");
        }
      })
      .catch(() => {
        if (isMounted) {
          setStatus("disconnected");
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const statusText =
    status === "checking"
      ? "Checking backend..."
      : status === "connected"
        ? "Backend connected"
        : "Backend not connected";

  return (
    <section className={`backend-status backend-status--${status}`}>
      <span className="backend-status__indicator" aria-hidden="true" />
      <div>
        <p className="eyebrow">Backend Status</p>
        <strong>{statusText}</strong>
      </div>
    </section>
  );
}
