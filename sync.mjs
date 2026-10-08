// Builds the publisher's queue from marketing/publish/plan.json and drops it in the media site, next to the media.
// Only posts with "via": "api" go in; media follow the media-site naming (r/<id>.mp4, r/<id>-cover.jpg, r/<id>-<n>.jpg).
// Then deploy the media site. Local paths live in local.json (git-ignored): { "plan": "...", "site": "...", "base": "https://..." }.
//
//   node sync.mjs           write the queue and list it
//   node sync.mjs --url     print the QUEUE_URL (for the GitHub secret)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

const local = JSON.parse(readFileSync(new URL("./local.json", import.meta.url), "utf8"));
const PLAN = process.env.PLAN ?? local.plan;
const SITE = local.site;
const BASE = local.base;

// The queue sits at an unlisted path; its content is public on Instagram soon after anyway.
const idFile = new URL("./.queue-id", import.meta.url);
if (!existsSync(idFile)) writeFileSync(idFile, randomBytes(12).toString("hex"));
const qid = readFileSync(idFile, "utf8").trim();
const url = `${BASE}/q/${qid}.json`;
if (process.argv.includes("--url")) { console.log(url); process.exit(0); }

const plan = JSON.parse(readFileSync(PLAN, "utf8"));
const media = (name) => {
  if (!existsSync(join(SITE, "r", name))) throw new Error(`missing media-site/r/${name}`);
  return `${BASE}/r/${name}`;
};
const slides = (id) => {
  const out = [];
  for (let n = 1; existsSync(join(SITE, "r", `${id}-${n}.jpg`)); n++) out.push(media(`${id}-${n}.jpg`));
  if (out.length < 2) throw new Error(`${id}: a carousel needs at least 2 slides in media-site/r`);
  return out;
};

const posts = plan.posts.filter((p) => p.via === "api" && !p.published).map((p) => {
  const base = { key: p.id, date: p.date, time: p.time, caption: p.caption, firstComment: p.firstComment || "" };
  return p.video ? { ...base, type: "REEL", video: media(`${p.id}.mp4`), cover: media(`${p.id}-cover.jpg`) }
                 : { ...base, type: "CAROUSEL", images: slides(p.id) };
});

mkdirSync(join(SITE, "q"), { recursive: true });
writeFileSync(join(SITE, "q", `${qid}.json`), JSON.stringify({ timezone: plan.timezone || "Asia/Jerusalem", posts }, null, 1) + "\n");
for (const p of posts) console.log(p.date, p.time, p.type.padEnd(8), p.key);
console.log(`${posts.length} posts -> ${url}`);
