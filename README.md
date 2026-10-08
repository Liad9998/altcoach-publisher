# AltCoach publisher

Publishes AltCoach's Instagram posts (reels with a custom cover, carousels, single images) through the Instagram API
with Facebook Login (graph.facebook.com, app "AltCoach Publisher", Page Altcoach.app), from a queue built out of `marketing/publish/plan.json`. Free and without a monthly cap
(Instagram allows 100 API posts per 24 hours), so it takes over what Metricool's free plan (20 posts a month) can't.

- `publish.mjs` runs every 10 minutes on GitHub Actions (`.github/workflows/publish.yml`). It prepares a post up to
  12 minutes early, publishes it at its time, adds the first comment (the sources) and sets the AI label.
  It never posts twice: it skips a post whose caption is already on the profile.
- `sync.mjs` (paths in a git-ignored `local.json`) writes the queue (posts marked `"via": "api"` in plan.json) to the media site, next to the media.
  Deploy the media site after it.
- `setup-fb.mjs` turns a long-lived user token (`.token`, from Graph API Explorer + Access Token Tool > Extend) into the
  Page token (`.page-token`, does not expire) and finds the Instagram account id (`.ig-user-id`). Needed scopes:
  instagram_basic, instagram_content_publish, instagram_manage_comments, pages_show_list, pages_read_engagement.
- `refresh-token.mjs` is only for the Instagram Login path (60-day `IG...` tokens); the Page token never expires.

Secrets: `IG_TOKEN` (the Page token), `IG_USER_ID` (17841416444422365) and `QUEUE_URL` (`node sync.mjs --url`).

Check without publishing: Actions > publish > Run workflow (check = on), or locally
`IG_TOKEN=... QUEUE_URL=... node publish.mjs --check`. A failed run (red) emails the repo owner.
