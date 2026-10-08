// Refreshes the long-lived Instagram token (valid 60 days; refresh it at least once a month) and stores the new one
// as the IG_TOKEN secret of the GitHub repo. Reads the current token from .token (git-ignored), writes the new one back.
//
//   node refresh-token.mjs <owner/repo>
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const repo = process.argv[2];
if (!repo) throw new Error("usage: node refresh-token.mjs <owner/repo>");
const file = new URL("./.token", import.meta.url);
const current = readFileSync(file, "utf8").trim();

const res = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(current)}`);
const body = await res.json();
if (!res.ok || !body.access_token) throw new Error(`refresh failed: ${JSON.stringify(body.error ?? body)}`);

writeFileSync(file, body.access_token);
execFileSync("gh", ["secret", "set", "IG_TOKEN", "--repo", repo], { input: body.access_token, stdio: ["pipe", "inherit", "inherit"] });
console.log(`token refreshed, valid ${Math.round(body.expires_in / 86400)} more days; IG_TOKEN updated in ${repo}`);
