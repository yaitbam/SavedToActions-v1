import { ApiError } from "../api/client";
import { Button } from "./Button";
import { Card } from "./Card";

interface ErrorStateProps {
  error?: unknown;
  title?: string;
  onRetry?: () => void;
}

export function ErrorState({ error, title = "Something went wrong", onRetry }: ErrorStateProps) {
  const detail = error instanceof ApiError ? (error.detail ?? error.code) : null;
  return (
    <Card role="alert" className="flex flex-col items-start gap-3">
      <h2 className="font-display text-xl">{title}</h2>
      {detail && <p className="text-small text-muted">{detail}</p>}
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
    </Card>
  );
}
