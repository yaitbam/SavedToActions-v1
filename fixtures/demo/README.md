# SavedToAction demo posts

14 original images made for SavedToAction on Nov 3 2026. Every account, event, venue, grant and organization is invented. No real people, no platform logos.

- 01 to 10: feed style saved posts (image post plus caption)
- 11 to 14: forum style saved text posts
- manifest.json: per file, the goal we expect and the deadline written in the image (null if none). Use it to check extraction, never as model input.

Coverage: 6 posts with a future deadline (01, 02, 06, 07, 12, 13), prompts and templates (03, 04), skills (05, 09), money (02, 04, 08, 11), 2 with no action (10, 14) to test that the model returns Missing.

Rules for use:
- Import through the real extraction pipeline. Do not hand write extracted fields.
- Mark every save from this folder as is_demo and show "Imported demo data".
- Do not present them as real saves in the demo or README. Say "illustrative posts".
