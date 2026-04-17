# Deploy & Rollback SOP — runarca.xyz

## Overview

The Arca site (landing page + blog) is a static Astro site deployed via **Cloudflare Pages** connected to the `unbankedgroup/arca-site` GitHub repo. Every push to `main` triggers an automatic build.

This SOP covers:
- How a normal deploy works
- How to roll back a broken deploy
- How to recover from a build failure
- How to verify a deploy is healthy

---

## Deploy topology

| Component | Location |
|---|---|
| Source repo | github.com/unbankedgroup/arca-site |
| Local working dir | $ARCA_HOME/arca-blog/ |
| Hosting | Cloudflare Pages, project `arca-site` |
| Live domain | runarca.xyz |
| Landing page source | arca-blog/public/index.html |
| Blog content source | arca-blog/src/content/blog/*.md |
| Build command | npm run build |
| Output directory | dist |
| Build trigger | git push origin main |
| Cloudflare account | Mposha.malanga@gmail.com |
| Cloudflare zone ID | bc1e8a209f98c6f3d39fb9548fe91ce4 |

---

## Standard deploy flow

1. Edit files in `$ARCA_HOME/arca-blog/`
2. **Run `npm run build` locally first.** This catches every Astro/YAML/schema error before it costs a failed deploy.
3. `git add`, `git commit`, `git push origin main`
4. Cloudflare Pages auto-builds and deploys (~1–2 minutes)
5. Verify at runarca.xyz

If step 2 passes, step 4 will pass. The build environments are equivalent.

---

## Pre-flight checklist before pushing

Run these from `$ARCA_HOME/arca-blog/`:

```bash
# 1. Build must succeed locally
npm run build

# 2. No duplicate slugs in blog content
grep "^slug:" src/content/blog/*.md | awk '{print $2}' | sort | uniq -d

# 3. No duplicate IDs
grep "^id:" src/content/blog/*.md | awk '{print $2}' | sort | uniq -d

# 4. No bare (unquoted) date_published values
grep -rn "^date_published:" src/content/blog/ | grep -v '"'
```

If any of these fail, fix locally before pushing. Do not push and watch Cloudflare fail.

---

## Rollback: how to revert a broken deploy

### Option A — Cloudflare Pages dashboard (fastest, no git changes)

Cloudflare Pages keeps every deployment forever. You can roll back to any prior good build in 2 clicks.

1. Open Cloudflare dashboard → **Workers & Pages** → **arca-site**
2. Click **Deployments** tab
3. Find the last green (successful) deployment before the bad one
4. Click the `...` menu → **Rollback to this deployment**
5. Confirm

The previous build is now live at runarca.xyz within seconds. The bad commit is still in git — fix it, then push the fix.

**Use this when:** You need to restore the live site immediately while you debug. This is the default rollback action.

### Option B — Git revert (canonical rollback through source control)

When you want the rollback recorded as a commit so the next build matches the rolled-back state.

```bash
cd $ARCA_HOME/arca-blog
git log --oneline -10                    # find the bad commit hash
git revert <bad-commit-hash>             # creates a new commit that undoes it
git push origin main                     # triggers a fresh Cloudflare build
```

`git revert` does NOT rewrite history. It creates a new commit that inverts the bad one. Safe for shared branches.

**Use this when:** You want the rollback to be permanent and traceable in git history, or when multiple commits have happened on top of the bad one.

### Option C — Reset to a known-good commit (destructive — use only if you're sure)

```bash
cd $ARCA_HOME/arca-blog
git reset --hard <good-commit-hash>
git push --force-with-lease origin main
```

**Never use this** unless you're certain no one else has pulled the bad commit and you understand force-push consequences. Prefer Option B.

---

## Recovering from a build failure

When a Cloudflare build fails, the previous successful build stays live. The site is not down — but new changes are not deployed until the build passes.

1. Open Cloudflare dashboard → **arca-site** → **Deployments** → click the failed build
2. Read the error log. 90% of failures fall into these buckets:
   - **YAML frontmatter error** — see Phase 9 of `blog-cluster-seo-geo.md` SOP
   - **Schema mismatch** — a frontmatter field doesn't match `src/content.config.ts`
   - **Missing required field** — usually `title`
   - **Duplicate slug or id**
   - **Template error** — accessing `pubDate` without a guard
3. Fix locally, run `npm run build` to verify, then push
4. Cloudflare auto-builds the new commit

If you can't figure out the error, roll back via Option A above and debug without pressure.

---

## Health check after deploy

After every deploy, verify the live site is actually serving the new content:

```bash
# Landing page
curl -sI -A "Mozilla/5.0" https://runarca.xyz | head -5

# Blog index
curl -sI -A "Mozilla/5.0" https://runarca.xyz/blog | head -5

# A specific post (replace slug)
curl -s -A "Mozilla/5.0" https://runarca.xyz/blog/operations-cost-mistake | grep "<title>"

# robots.txt is reachable
curl -s https://runarca.xyz/robots.txt | head -5
```

Expect HTTP 200 on all of them. If you see 403 from Cloudflare, the custom domain may have been disconnected — go to Pages → arca-site → Custom domains and re-add `runarca.xyz`.

---

## Things that have broken before (and the fix)

| Symptom | Cause | Fix |
|---|---|---|
| Build fails on `title: Required` | A non-post `.md` file in `src/content/blog/` | Move it out of that folder |
| Build fails with `date_published: Expected string, received object` | Bare YAML date (`2026-04-07`) | Quote it: `"2026-04-07"` |
| Build fails with `bad indentation` | Unescaped `"` inside double-quoted YAML title | Use em-dash, single quotes, or escape with `\"` |
| Build fails with `Cannot read properties of undefined` in render | Template called `FormattedDate` on a missing date | Guard with `{pubDate && ...}` |
| Build fails on RSS endpoint | Spread `...post.data` includes non-RSS-compatible fields | Map fields explicitly in `rss.xml.js` |
| `403` on runarca.xyz after working before | Custom domain disconnected from Pages project | Re-add custom domain in Pages settings |
| `Cloudflare error` page | DNS records point to a deleted Pages project | Delete stale CNAMEs, re-add custom domain |
| GitHub Actions build failing on Node version | Old GitHub Pages workflow leftover | Delete `.github/workflows/deploy.yml` — Cloudflare handles deployment |

If a new failure pattern appears that's not in this table, add it after you fix it.
