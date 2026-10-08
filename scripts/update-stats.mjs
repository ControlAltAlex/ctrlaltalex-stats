#!/usr/bin/env node
/**
 * Refreshes data/stats.json with current follower / view counts.
 *
 *   node scripts/update-stats.mjs
 *
 * Sources, best first. Each platform falls back to the value already in
 * stats.json, so a failing source never wipes a good number.
 *
 *   YouTube    YOUTUBE_API_KEY set  ->  Data API v3 (exact)
 *              otherwise            ->  public channel page (rounded, e.g. 4.31k)
 *   TikTok     public profile page  (exact)
 *   Instagram  IG_USER_ID + IG_ACCESS_TOKEN  ->  Graph API (exact)
 *              otherwise            ->  unchanged; Instagram blocks anonymous reads
 *
 * Env (all optional):
 *   YOUTUBE_API_KEY, YOUTUBE_CHANNEL_ID, YOUTUBE_HANDLE
 *   IG_USER_ID, IG_ACCESS_TOKEN
 *   TIKTOK_HANDLE
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATS_PATH = join(HERE, '..', 'data', 'stats.json');

const YT_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || 'UCVhQ9ejzvcESjT7V67jG0lg';
const YT_HANDLE     = process.env.YOUTUBE_HANDLE     || 'CtrlAltAlex';
const TT_HANDLE     = process.env.TIKTOK_HANDLE      || 'ctrlaltalex';
const IG_HANDLE     = process.env.IG_HANDLE          || 'ctrlaltalex';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const log = [];
function note(platform, ok, detail) {
  log.push(`${ok ? '  ok  ' : ' skip '} ${platform.padEnd(10)} ${detail}`);
}

async function getText(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-GB,en;q=0.9',
      // Skips the EU consent interstitial that otherwise replaces the page.
      'Cookie': 'CONSENT=YES+cb; SOCS=CAI',
      ...extraHeaders
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** "4.31k" / "1.2M" / "189,600" -> 4310 / 1200000 / 189600 */
function parseCount(raw) {
  if (raw == null) return null;
  const m = String(raw).trim().replace(/,/g, '').match(/^([\d.]+)\s*([kKmMbB]?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] || 1;
  return Math.round(n * mult);
}

/* ─────────────── YouTube ─────────────── */

async function youtube(prev) {
  const key = process.env.YOUTUBE_API_KEY;

  if (key) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${YT_CHANNEL_ID}&key=${key}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const s = body?.items?.[0]?.statistics;
      if (s) {
        note('youtube', true, `Data API — ${s.subscriberCount} subs, ${s.viewCount} views`);
        return {
          subscribers: Number(s.subscriberCount) || prev.subscribers,
          views: Number(s.viewCount) || prev.views,
          videos: Number(s.videoCount) || prev.videos
        };
      }
      throw new Error('no items in response');
    } catch (err) {
      note('youtube', false, `Data API failed (${err.message}), trying page scrape`);
    }
  }

  try {
    const html = await getText(`https://www.youtube.com/@${YT_HANDLE}?hl=en`);
    // The channel's own row reads: "@CtrlAltAlex • 4.31k subscribers"
    const subRe = new RegExp(`@${YT_HANDLE}[^"]{0,40}?([\\d.,]+\\s*[kKmMbB]?)\\s*subscribers`, 'i');
    const subs = parseCount((html.match(subRe) || [])[1]);
    const videos = parseCount((html.match(/([\d,]+)\s*videos/) || [])[1]);

    if (!subs) throw new Error('subscriber count not found in page');
    note('youtube', true, `page scrape — ${subs} subs (rounded; set YOUTUBE_API_KEY for exact)`);
    return {
      subscribers: subs,
      views: prev.views,            // lifetime views are API-only
      videos: videos || prev.videos
    };
  } catch (err) {
    note('youtube', false, `${err.message} — keeping previous values`);
    return prev;
  }
}

/* ─────────────── TikTok ─────────────── */

async function tiktok(prev) {
  try {
    const html = await getText(`https://www.tiktok.com/@${TT_HANDLE}`);
    const followers = Number((html.match(/"followerCount":(\d+)/) || [])[1]);
    if (!followers) throw new Error('followerCount not found (TikTok may be blocking this IP)');
    note('tiktok', true, `${followers} followers`);
    return { followers };
  } catch (err) {
    note('tiktok', false, `${err.message} — keeping previous value`);
    return prev;
  }
}

/* ─────────────── Instagram ─────────────── */

async function instagram(prev) {
  const id = process.env.IG_USER_ID;
  const token = process.env.IG_ACCESS_TOKEN;

  if (!id || !token) {
    // Best effort without a token. Meta rate-limits this hard (HTTP 429 from
    // most datacentre IPs), so it is a bonus, never something to rely on.
    try {
      const res = await fetch('https://www.instagram.com/api/v1/users/web_profile_info/?username=' + IG_HANDLE, {
        headers: {
          'User-Agent': UA,
          'x-ig-app-id': '936619743392459',
          'Accept': '*/*',
          'Accept-Language': 'en-GB,en;q=0.9',
          'Referer': 'https://www.instagram.com/' + IG_HANDLE + '/'
        }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      const followers = body?.data?.user?.edge_followed_by?.count;
      if (!followers) throw new Error('no count in response');
      note('instagram', true, followers + ' followers (public endpoint, no token)');
      return { ...prev, followers };
    } catch (err) {
      note('instagram', false, 'no token and public endpoint blocked (' + err.message + ') — keeping previous value');
      return prev;
    }
  }

  try {
    const url = `https://graph.facebook.com/v21.0/${id}?fields=followers_count,media_count&access_token=${token}`;
    const res = await fetch(url);
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
    note('instagram', true, `${body.followers_count} followers`);
    return { ...prev, followers: body.followers_count ?? prev.followers };
  } catch (err) {
    note('instagram', false, `Graph API failed (${err.message}) — keeping previous value`);
    return prev;
  }
}

/* ─────────────── main ─────────────── */

const prev = JSON.parse(await readFile(STATS_PATH, 'utf8'));

const [yt, tt, ig] = await Promise.all([
  youtube(prev.youtube),
  tiktok(prev.tiktok),
  instagram(prev.instagram)
]);

const next = {
  updated: new Date().toISOString(),
  instagram: ig,
  tiktok: tt,
  youtube: yt,
  topVideo: prev.topVideo          // set by hand; it spans several platforms
};

const changed = JSON.stringify({ ...prev, updated: null }) !== JSON.stringify({ ...next, updated: null });

console.log(log.join('\n'));

// Only touch the file when a number moved, so "updated" on the site means the
// counts actually changed rather than that the job ran.
if (changed) {
  await writeFile(STATS_PATH, JSON.stringify(next, null, 2) + '\n');
  console.log('\nstats.json updated.');
} else {
  console.log('\nNo count changed; stats.json left as is.');
}
