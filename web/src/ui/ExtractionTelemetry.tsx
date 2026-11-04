import { useEffect, useState } from "react";
import "./telemetry.css";

export function ExtractionTelemetry() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="xt" role="status">
      <span className="xt-spin" aria-hidden="true" />
      <div>
        <b>Muse is reading your screenshot</b>
        <p className="xt-time">{seconds}s</p>
        <p>{seconds > 25 ? "Still working. Nothing is scheduled while Muse reads." : "Usually 10 to 20 seconds. Some screenshots take longer."}</p>
        <p className="xt-next">Next: Muse suggests a time and you approve it.</p>
      </div>
    </div>
  );
}
