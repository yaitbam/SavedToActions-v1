const messages: Record<string, string> = {
  network_error: "Something went wrong. Please try again",
  unsupported_image: "Use a PNG, JPEG or WebP image",
  image_unreadable: "That image could not be read",
  image_required: "Add a screenshot first",
  note_too_long: "That note is too long",
  not_found: "We could not find this item. Please try again",
  slot_no_longer_available: "Your calendar changed. Here is the next free time",
  slot_in_past: "That time has passed. Find another time",
  outside_working_hours: "That time is outside your working hours",
  after_deadline: "That time is after the deadline",
  missing_timezone: "Set your timezone in Settings first",
  operation_in_progress: "Another change is running. Try again in a moment",
  model_failed: "Something went wrong. Please try again",
  demo_readonly: "Sign in to do this",
  operations_in_progress: "Something is still running. Wait a moment, then try again",
  confirmation_required: "Type the confirmation text exactly to continue",
  daily_limit_reached: "No free credits left today. They reset at 00:00",
  already_planned: "This save is already on your calendar",
  action_closed: "This save is closed",
  effort_not_confirmed: "Confirm how long this takes first",
  invalid_working_hours: "Use valid working hours with the end after the start",
  invalid_timezone: "Use a valid IANA timezone, such as Africa/Casablanca",
  invalid_ignore_all_day: "Could not save the all-day event preference. Try again",
  invalid_goal_or_name: "Give each goal a valid name",
  calendar_remove_failed: "Google Calendar did not confirm the removal. Nothing was deleted",
  google_not_connected: "Google Calendar is not connected. Nothing was deleted",
  google_unavailable: "Google Calendar is not answering. Nothing was deleted",
  extraction_in_progress: "Wait for the extraction to finish, then delete this save",
};

export function errorText(error: unknown, fallback = "Something went wrong. Please try again"): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return messages[error.code] ?? fallback;
  return fallback;
}
