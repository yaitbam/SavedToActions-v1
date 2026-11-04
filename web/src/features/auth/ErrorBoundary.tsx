import { Component, type ReactNode } from "react";
import { ServerError } from "../../pages/StatusPages";

// A page that crashes while rendering shows the 500 page and not a blank screen.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("Page crashed", error instanceof Error ? error.name : "error"); }
  render() { return this.state.failed ? <ServerError from={window.location.pathname} /> : this.props.children; }
}
