# ctrlaltalex-stats

Live follower and view counts for [www.ctrlaltalex.com](https://www.ctrlaltalex.com).

`data/stats.json` is refreshed every 6 hours by `.github/workflows/update-stats.yml`,
which runs `scripts/update-stats.mjs`. The website fetches the file straight from

```
https://raw.githubusercontent.com/ControlAltAlex/ctrlaltalex-stats/main/data/stats.json
```

so the counters update without a site deploy. That matters because each Netlify
production deploy costs credits on the free plan. GitHub serves the file with
`Access-Control-Allow-Origin: *` and a 5-minute cache.

The site's own HTML carries fallback numbers, so it still shows sensible counts if
this file can't be reached.

## Sources

| Platform | Source | Needs a secret? |
| --- | --- | --- |
| TikTok | public profile page | no |
| YouTube subs | public channel page, rounded to the nearest 10 | no |
| YouTube exact subs + lifetime views | YouTube Data API v3 | `YOUTUBE_API_KEY` |
| Instagram | Graph API | `IG_USER_ID` + `IG_ACCESS_TOKEN` |

Add secrets under **Settings → Secrets and variables → Actions**. A source that fails
keeps the previous value, so a blocked request never zeroes a count.

`instagram.reach30d` and `topVideo.views` have no automatic source; edit them here by hand.

Run it locally with `node scripts/update-stats.mjs`, or trigger it from the Actions tab.
