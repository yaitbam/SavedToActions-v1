import { useEffect, useState } from "react";
export function ExtractionTelemetry() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { const start = Date.now(); const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000); return () => clearInterval(timer); }, []);
  return <div className="pipeline-live"><p className="text-[15px] font-semibold text-brand">Extraction in progress <span aria-hidden="true">· {seconds}s</span></p><p role="status" className="text-small font-medium">Muse Spark Open is reading your screenshot</p><p className="text-small text-muted">The server extracts the text and validates supporting quotes. Your result appears when the request completes.</p><p className="text-small text-muted">{seconds > 15 ? "Still waiting for the server. Nothing is scheduled during extraction." : "About 7 seconds on average; some screenshots take longer."}</p><div className="mt-4 border-t border-line pt-3 font-mono text-[14px] text-muted">NEXT · Review evidence → Confirm minutes → Plan</div></div>;
}
