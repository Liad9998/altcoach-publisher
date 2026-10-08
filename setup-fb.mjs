// One-time setup for the Facebook Login path: turns the long-lived user token in .token into the Page token
// (does not expire when it comes from a long-lived user token), finds the Instagram business account behind the Page,
// and writes .page-token + .ig-user-id. Prints no token.
//
//   node setup-fb.mjs
import { readFileSync, writeFileSync } from "node:fs";

const G = "https://graph.facebook.com/v25.0";
const user = readFileSync(new URL("./.token", import.meta.url), "utf8").trim();
const get = async (path, token, params = {}) => {
  const url = new URL(G + path);
  for (const [k, v] of Object.entries({ ...params, access_token: token })) url.searchParams.set(k, v);
  const body = await (await fetch(url)).json();
  if (body.error) throw new Error(`${path}: ${body.error.code} ${body.error.message}`);
  return body;
};

const me = await get("/me", user, { fields: "id,name" });
console.log(`user: ${me.name}`);
const dbg = (await get("/debug_token", user, { input_token: user })).data;
console.log(`user token: ${dbg.is_valid ? "valid" : "INVALID"}, expires ${dbg.expires_at ? new Date(dbg.expires_at * 1000).toISOString().slice(0, 10) : "never"}`);
const perms = (await get("/me/permissions", user)).data.filter((p) => p.status === "granted").map((p) => p.permission);
console.log(`granted: ${perms.join(", ")}`);
const need = ["instagram_basic", "instagram_content_publish", "instagram_manage_comments", "pages_show_list", "pages_read_engagement"];
const missing = need.filter((p) => !perms.includes(p));
if (missing.length) console.log(`MISSING: ${missing.join(", ")}`);

const pages = (await get("/me/accounts", user, { fields: "id,name,access_token,instagram_business_account{id,username}" })).data;
for (const p of pages) console.log(`page: ${p.name} (${p.id}) -> instagram: ${p.instagram_business_account ? "@" + p.instagram_business_account.username : "none"}`);
const page = pages.find((p) => p.instagram_business_account?.username === "altcoach.app") ?? pages.find((p) => p.instagram_business_account);
if (!page) throw new Error("no Page with a connected Instagram business account was granted to this token");

const pdbg = (await get("/debug_token", user, { input_token: page.access_token })).data;
console.log(`page token: ${pdbg.is_valid ? "valid" : "INVALID"}, expires ${pdbg.expires_at ? new Date(pdbg.expires_at * 1000).toISOString().slice(0, 10) : "never"}`);
writeFileSync(new URL("./.page-token", import.meta.url), page.access_token);
writeFileSync(new URL("./.ig-user-id", import.meta.url), page.instagram_business_account.id);
console.log(`saved .page-token and .ig-user-id (@${page.instagram_business_account.username}, ${page.instagram_business_account.id})`);
