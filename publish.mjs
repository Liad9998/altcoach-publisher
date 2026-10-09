// AltCoach Instagram publisher. Publishes due posts from the queue through the Instagram API (Instagram Login).
// Runs every 10 minutes on GitHub Actions: a post is prepared a few minutes early, published at its time
// (or late, up to MAX_LATE_MIN, if a run was delayed), never twice, then gets its first comment.
//
//   node publish.mjs            publish what is due
//   node publish.mjs --check    verify the token and show the next posts (publishes nothing)
//   DRY_RUN=1 node publish.mjs  print what would be sent
//
// Env: IG_TOKEN, QUEUE_URL (https URL or local path of queue.json), IG_USER_ID (the Instagram business account id),
//      optional IG_API_HOST, LEAD_MIN (default 12), MAX_LATE_MIN (default 1440).
// Default is the Facebook Login path: IG_TOKEN = the Page token from setup-fb.mjs (it doesn't expire).
// For Instagram Login set IG_API_HOST=https://graph.instagram.com/v25.0 and leave IG_USER_ID empty.
import { readFileSync } from "node:fs";

const API = process.env.IG_API_HOST ?? "https://graph.facebook.com/v25.0";
const { IG_TOKEN, QUEUE_URL } = process.env;
const DRY = process.env.DRY_RUN === "1";
const CHECK = process.argv.includes("--check");
const LEAD_MIN = Number(process.env.LEAD_MIN ?? 12);
const MAX_LATE_MIN = Number(process.env.MAX_LATE_MIN ?? 1440); // GitHub can delay or skip scheduled runs: late beats never

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function api(path, params = {}, method = "GET") {
  if (DRY && method === "POST") {
    log("DRY POST", path, JSON.stringify(params).slice(0, 300));
    return { id: `dry-${path.split("/").pop()}-${Math.random().toString(36).slice(2, 7)}` };
  }
  const url = new URL(API + path);
  const all = { ...params, access_token: IG_TOKEN };
  const init = { method };
  if (method === "GET") for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
  else init.body = new URLSearchParams(all);
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error ?? {};
    throw new Error(`${method} ${path}: ${res.status} ${e.type ?? ""} ${e.code ?? ""} ${e.error_user_msg ?? e.message ?? JSON.stringify(body)}`);
  }
  return body;
}

// "2026-10-19" + "19:30" in Asia/Jerusalem -> epoch ms (handles the DST change without a library).
function zonedTime(date, time, tz = "Asia/Jerusalem") {
  const guess = Date.parse(`${date}T${time}:00Z`);
  const offset = (t) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(t).map((x) => [x.type, x.value]));
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`) - t;
  };
  const first = guess - offset(guess);
  return guess - offset(first);
}

const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 80);

async function loadQueue() {
  if (!QUEUE_URL) throw new Error("QUEUE_URL is not set");
  const text = /^https?:/.test(QUEUE_URL)
    ? await (await fetch(QUEUE_URL, { cache: "no-store" })).text()
    : readFileSync(QUEUE_URL, "utf8");
  const q = JSON.parse(text);
  return (q.posts ?? q).map((p) => ({ ...p, at: zonedTime(p.date, p.time, q.timezone) }));
}

async function waitFinished(id, what) {
  if (DRY) return;
  for (let i = 0; i < 40; i++) {
    const { status_code: s } = await api(`/${id}`, { fields: "status_code" });
    if (s === "FINISHED") return;
    if (s === "ERROR" || s === "EXPIRED") throw new Error(`${what}: container ${id} ${s}`);
    await sleep(15000);
  }
  throw new Error(`${what}: container ${id} still processing after 10 minutes`);
}

// Creates the container(s) for one post and waits until Instagram has processed them.
async function prepare(igId, p) {
  const ai = p.aiGenerated === false ? {} : { is_ai_generated: "true" };
  if (p.type === "REEL") {
    const c = await api(`/${igId}/media`, { media_type: "REELS", video_url: p.video, cover_url: p.cover,
      caption: p.caption, share_to_feed: "true", ...ai }, "POST");
    await waitFinished(c.id, p.key);
    return c.id;
  }
  if (p.type === "CAROUSEL") {
    const children = [];
    for (const image_url of p.images) children.push((await api(`/${igId}/media`, { image_url, is_carousel_item: "true" }, "POST")).id);
    for (const id of children) await waitFinished(id, p.key);
    const c = await api(`/${igId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: p.caption, ...ai }, "POST");
    await waitFinished(c.id, p.key);
    return c.id;
  }
  if (p.type === "IMAGE") {
    const c = await api(`/${igId}/media`, { image_url: p.images[0], caption: p.caption, ...ai }, "POST");
    await waitFinished(c.id, p.key);
    return c.id;
  }
  throw new Error(`${p.key}: unknown type ${p.type}`);
}

async function main() {
  if (!IG_TOKEN && !DRY) throw new Error("IG_TOKEN is not set");
  const fixedId = process.env.IG_USER_ID;
  const me = DRY && !IG_TOKEN ? { user_id: "DRY", username: "dry-run" }
    : fixedId ? { user_id: fixedId, ...(await api(`/${fixedId}`, { fields: "username" })) }
    : await api("/me", { fields: "user_id,username" });
  const igId = me.user_id;
  const queue = await loadQueue();
  const now = Date.now();

  if (CHECK) {
    log(`account @${me.username} (${igId})`);
    if (!DRY) {
      const lim = await api(`/${igId}/content_publishing_limit`, { fields: "quota_usage,config" });
      log("publishing limit", JSON.stringify(lim.data?.[0] ?? lim));
    }
    const next = queue.filter((p) => p.at > now - MAX_LATE_MIN * 60e3).sort((a, b) => a.at - b.at).slice(0, 8);
    log(`queue: ${queue.length} posts, next ${next.length}:`);
    for (const p of next) log(`  ${p.date} ${p.time} (${new Date(p.at).toISOString()}) ${p.type} ${p.key}`);
    return;
  }

  const due = queue.filter((p) => p.at - now <= LEAD_MIN * 60e3 && now - p.at <= MAX_LATE_MIN * 60e3).sort((a, b) => a.at - b.at);
  const missed = queue.filter((p) => now - p.at > MAX_LATE_MIN * 60e3 && now - p.at <= (MAX_LATE_MIN + 15) * 60e3);
  if (!due.length && !missed.length) return log("nothing due");

  // What is already on the profile, so a post never goes out twice (a rerun, two overlapping runs).
  const recent = DRY && !IG_TOKEN ? [] : (await api(`/${igId}/media`, { fields: "id,caption,timestamp", limit: "40" })).data ?? [];
  const posted = (p) => recent.some((m) => norm(m.caption) && norm(m.caption) === norm(p.caption));

  let failed = 0;
  for (const p of missed) if (!posted(p)) { console.log(`::warning::${p.key} (${p.date} ${p.time}) was not published: more than ${MAX_LATE_MIN} min late`); failed++; }

  for (const p of due) {
    if (posted(p)) { log(`${p.key}: already on the profile, skipping`); continue; }
    try {
      log(`${p.key}: preparing ${p.type} for ${p.date} ${p.time}`);
      const container = await prepare(igId, p);
      const wait = p.at - Date.now();
      if (wait > 0) { log(`${p.key}: ready, publishing in ${Math.round(wait / 1000)}s`); await sleep(DRY ? 0 : wait); }
      const { id } = await api(`/${igId}/media_publish`, { creation_id: container }, "POST");
      const link = DRY ? "" : (await api(`/${id}`, { fields: "permalink" }).catch(() => ({}))).permalink ?? "";
      log(`${p.key}: published ${id} ${link}`);
      if (p.firstComment) {
        try { await api(`/${id}/comments`, { message: p.firstComment }, "POST"); log(`${p.key}: first comment posted`); }
        catch (e) { console.log(`::warning::${p.key}: published, but the first comment failed: ${e.message}`); failed++; }
      }
    } catch (e) {
      console.log(`::error::${p.key}: ${e.message}`);
      failed++;
    }
  }
  if (failed) process.exitCode = 1; // a red run emails the repo owner
}

main().catch((e) => { console.log(`::error::${e.message}`); process.exitCode = 1; });
