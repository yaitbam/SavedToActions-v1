import { ApiError } from "./client";

const messages: Record<string, string> = {
  network_error: "Could not reach the server",
  unsupported_image: "Use a PNG, JPEG or WebP image",
  image_unreadable: "That image could not be read",
  image_required: "Add a screenshot first",
  note_too_long: "That note is too long",
  not_found: "Not found",
  slot_no_longer_available: "Your calendar changed. Here is the next free time",
  slot_in_past: "That time has passed. Find another time",
  outside_working_hours: "That time is outside your working hours",
  after_deadline: "That time is after the deadline",
  missing_timezone: "Set your timezone in Settings first",
  operation_in_progress: "Another change is running. Try again in a moment",
  model_failed: "Muse Spark Open could not plan this. Try again",
  already_planned: "This save is already on your calendar",
  action_closed: "This save is closed",
  effort_not_confirmed: "Confirm how long this takes first",
};

export function errorText(error: unknown, fallback = "Something went wrong. Try again"): string {
  if (error instanceof ApiError) return messages[error.code] ?? error.detail ?? fallback;
  return fallback;
}
