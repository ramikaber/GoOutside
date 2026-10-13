/**
 * scripts/backfill-attraction-photos.ts
 *
 * ONE-OFF BACKFILL SCRIPT. This is a standalone, manually-run utility — it
 * is NOT part of the app and is never imported from anywhere under src/.
 * Its only job is to fill in the `photoURLs` field on existing
 * "curatedAttractions" documents by looking up real, high-resolution photos
 * on Wikipedia for each attraction's name.
 *
 * RUN MANUALLY with:
 *   ADMIN_EMAIL=<the admin account's email> ADMIN_PASSWORD=<the admin account's password> npx tsx scripts/backfill-attraction-photos.ts
 *
 * (tsx isn't a project dependency; npx will fetch it on the fly the first
 * time you run this. No changes to package.json are needed. Requires
 * Node 18+ for the built-in `fetch`.)
 *
 * WHAT IT DOES: for every "curatedAttractions" document —
 *   1. Queries the MediaWiki Action API for the page matching the
 *      attraction's name, asking for both `prop=images` (every file
 *      referenced on the page) and `prop=pageimages&piprop=name` (the
 *      article's lead image filename) in a single request. The lead image is
 *      ordered first so each carousel opens on the representative shot
 *      instead of whatever sorts first alphabetically; the rest follow, with
 *      the lead de-duplicated out of the tail.
 *   2. Filters out files that are almost certainly not real photos: skips
 *      any filename containing "icon", "logo", "flag", "coat_of_arms",
 *      "symbol", or "map" (case-insensitive), and skips .svg files
 *      outright (these are almost always icons/diagrams).
 *   3. Takes up to MAX_PHOTOS of the remaining candidates and resolves each
 *      to a full-resolution direct URL via the `prop=imageinfo` API,
 *      requesting a 1200px-wide rendition (`iiurlwidth=1200`) — using
 *      `thumburl` from that response, or `url` (the original file) if no
 *      thumburl comes back.
 *   4. Writes the resulting array to `photoURLs` via updateDoc, REPLACING
 *      whatever was there before (this script is meant to be re-run over
 *      all documents, including ones a previous single-thumbnail version of
 *      this script already touched).
 *   5. If no candidates survive filtering, or none of them resolve to a
 *      usable URL, falls back to the old REST summary API's single small
 *      thumbnail as better-than-nothing. If even that comes up empty, the
 *      attraction is logged in the final "needs a manual photo" list.
 * A failure looking up or resolving one attraction (or one candidate file
 * within an attraction) never aborts the run — it's logged and the script
 * moves on.
 *
 * COMMONS GOTCHA (this bit is load-bearing): when en.wikipedia is asked for
 * a File: page whose description page lives on Wikimedia Commons — which is
 * true of almost every photo — it replies with pageid -1 and `missing: ""`
 * alongside `imagerepository: "shared"`, AND a perfectly valid `imageinfo`
 * payload. So the usual "treat `missing` as not-found" check must NOT be
 * applied to imageinfo lookups; doing that is what made an earlier version
 * of this script silently discard nearly every candidate and fall back to
 * the small summary thumbnail for almost every attraction.
 *
 * RATE LIMITING: every Wikipedia request goes through wikiFetch(), which
 * waits REQUEST_DELAY_MS between calls — an earlier version fired requests
 * flat out and started getting 429s partway through the run. If 429s show
 * up again, raise that one constant.
 *
 * WIKIPEDIA USER-AGENT: the Wikimedia REST/Action APIs ask callers to
 * identify themselves with a descriptive User-Agent including contact info
 * (see https://meta.wikimedia.org/wiki/User-Agent_policy). WIKI_USER_AGENT
 * below is set to the maintainer's contact info.
 *
 * SECURITY RULES: same as scripts/seed-curated-attractions.ts — this uses
 * the app's normal client-side `db`/`auth` exports from src/lib/firebase.ts,
 * and firestore.rules restricts writes to "curatedAttractions" to the admin
 * account (isAdmin(), role 'admin' on its users/{uid} doc). So this script
 * signs in as ADMIN_EMAIL with signInWithEmailAndPassword before writing
 * anything, reading the password from the ADMIN_PASSWORD env var (never
 * hardcoded here). That requires the ADMIN_EMAIL account to already exist in
 * Firebase Auth with email/password sign-in enabled. Reading the existing
 * documents is unaffected by any of this, since "curatedAttractions" allows
 * public reads.
 */

import { signInWithEmailAndPassword } from 'firebase/auth';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';

import { auth, db } from '../src/lib/firebase';

// The admin account's email comes from the ADMIN_EMAIL env var, like the
// password, so no personal address is stored in the repo.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? '';

const WIKI_USER_AGENT = 'GoOutside-App/1.0 (https://github.com/ramikaber/GoOutside)';

const MAX_PHOTOS = 5;
const THUMB_WIDTH = 1200;
const REQUEST_DELAY_MS = 250;

// Filenames containing any of these (case-insensitive, spaces and
// underscores treated the same) are almost certainly not real photos.
const EXCLUDED_KEYWORDS = ['icon', 'logo', 'flag', 'coat_of_arms', 'symbol', 'map'];

interface WikiImagesResponse {
  query?: {
    pages?: Record<
      string,
      { missing?: string; images?: { title: string }[]; pageimage?: string }
    >;
  };
}

interface WikiImageInfoResponse {
  query?: {
    pages?: Record<string, { missing?: string; imageinfo?: { url?: string; thumburl?: string }[] }>;
  };
}

interface WikipediaSummary {
  thumbnail?: { source: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Single choke point for every Wikipedia call (both Action API and REST),
// so one delay covers the whole run's request rate.
async function wikiFetch(url: string): Promise<Response> {
  await sleep(REQUEST_DELAY_MS);
  return fetch(url, {
    headers: { 'User-Agent': WIKI_USER_AGENT, Accept: 'application/json' },
  });
}

async function fetchWikiJson<T>(url: string): Promise<T> {
  const response = await wikiFetch(url);
  if (!response.ok) {
    throw new Error(`Wikipedia API returned ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

// `pageimage` comes back with underscores ("CN_Tower_logo.png") while
// `images[].title` comes back with spaces ("File:CN Tower logo.png"), so
// both keyword matching and de-duplication need a normalized form.
function normalizeFileKey(fileTitle: string): string {
  return fileTitle.replace(/^File:/i, '').toLowerCase().replace(/ /g, '_');
}

function isLikelyPhoto(fileTitle: string): boolean {
  const normalized = normalizeFileKey(fileTitle);
  if (normalized.endsWith('.svg')) return false;
  return !EXCLUDED_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

async function getCandidateFilenames(name: string): Promise<string[]> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(name)}` +
    '&prop=images%7Cpageimages&piprop=name&format=json&imlimit=20&redirects=1';

  const data = await fetchWikiJson<WikiImagesResponse>(url);
  const page = data.query?.pages ? Object.values(data.query.pages)[0] : undefined;

  // Here `missing` genuinely means "no such article", so there's nothing to
  // pull images from. (Contrast with resolveImageUrl below.)
  if (!page || page.missing !== undefined) {
    console.warn(`    ! No Wikipedia article found for "${name}"`);
    return [];
  }

  // `pageimage` is the article's lead image — the very same file the REST
  // summary endpoint serves as its thumbnail, but given to us as a filename,
  // so it can be resolved at THUMB_WIDTH instead of the summary's ~330px.
  // Ordering it first makes each carousel open on the representative shot
  // rather than whatever sorts first alphabetically. It is deliberately NOT
  // exempt from isLikelyPhoto(): plenty of pages use a logo as their lead
  // image (CN Tower's is CN_Tower_logo.png), and a logo hero would be worse
  // than the alphabetical pick it replaced.
  const listed = (page.images ?? []).map((image) => image.title);
  const ordered = page.pageimage ? [`File:${page.pageimage}`, ...listed] : listed;

  const seen = new Set<string>();
  return ordered
    .filter((title) => {
      const key = normalizeFileKey(title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter(isLikelyPhoto)
    .slice(0, MAX_PHOTOS);
}

async function resolveImageUrl(fileTitle: string): Promise<string | null> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}` +
    `&prop=imageinfo&iiprop=url&iiurlwidth=${THUMB_WIDTH}&format=json&redirects=1`;

  try {
    const data = await fetchWikiJson<WikiImageInfoResponse>(url);
    const page = data.query?.pages ? Object.values(data.query.pages)[0] : undefined;

    // Deliberately NOT checking `missing` here — see the COMMONS GOTCHA note
    // at the top of this file. A Commons-hosted file reports missing: "" but
    // still carries a valid imageinfo payload.
    const info = page?.imageinfo?.[0];
    if (!info) {
      console.warn(`    ! No imageinfo returned for "${fileTitle}"`);
      return null;
    }

    const resolved = info.thumburl ?? info.url ?? null;
    if (!resolved) {
      console.warn(`    ! imageinfo for "${fileTitle}" had neither thumburl nor url`);
    }
    return resolved;
  } catch (err) {
    console.warn(`    ! Failed to resolve "${fileTitle}": ${(err as Error).message}`);
    return null;
  }
}

async function findFallbackThumbnail(name: string): Promise<string | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`;

  const response = await wikiFetch(url);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Wikipedia API returned ${response.status} ${response.statusText}`);
  }

  const summary = (await response.json()) as WikipediaSummary;
  return summary.thumbnail?.source ?? null;
}

async function findAttractionPhotos(
  name: string,
): Promise<{ photoURLs: string[]; usedFallback: boolean }> {
  const candidateFilenames = await getCandidateFilenames(name);
  console.log(
    `    ${candidateFilenames.length} candidate photo${candidateFilenames.length === 1 ? '' : 's'} after filtering`,
  );

  // resolveImageUrl logs and returns null on failure rather than throwing,
  // so one bad candidate never costs us the rest of the attraction's photos.
  const photoURLs: string[] = [];
  for (const filename of candidateFilenames) {
    const resolvedUrl = await resolveImageUrl(filename);
    if (resolvedUrl) photoURLs.push(resolvedUrl);
  }

  if (photoURLs.length > 0) {
    return { photoURLs, usedFallback: false };
  }

  const fallbackUrl = await findFallbackThumbnail(name);
  return { photoURLs: fallbackUrl ? [fallbackUrl] : [], usedFallback: true };
}

async function backfill() {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!ADMIN_EMAIL || !adminPassword) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD env vars must both be set. Run this as:\n' +
        '  ADMIN_EMAIL=<the admin account\'s email> ADMIN_PASSWORD=<the admin account\'s password> npx tsx scripts/backfill-attraction-photos.ts',
    );
  }

  console.log(`Signing in as ${ADMIN_EMAIL}...`);
  await signInWithEmailAndPassword(auth, ADMIN_EMAIL, adminPassword);

  const snapshot = await getDocs(collection(db, 'curatedAttractions'));
  console.log(`Found ${snapshot.docs.length} curated attractions. Looking up photos...`);

  const needsManualPhoto: string[] = [];
  let updatedCount = 0;

  for (const docSnapshot of snapshot.docs) {
    const name = docSnapshot.data().name as string | undefined;
    if (!name) {
      console.warn(`Skipping ${docSnapshot.id}: document has no "name" field.`);
      needsManualPhoto.push(docSnapshot.id);
      continue;
    }

    console.log(`  → ${name}`);
    try {
      const { photoURLs, usedFallback } = await findAttractionPhotos(name);
      if (photoURLs.length === 0) {
        console.log(`  ✗ No usable photos found for "${name}" — needs a manual photo.`);
        needsManualPhoto.push(name);
        continue;
      }

      await updateDoc(doc(db, 'curatedAttractions', docSnapshot.id), { photoURLs });
      updatedCount += 1;
      const countLabel = `${photoURLs.length} photo${photoURLs.length === 1 ? '' : 's'}`;
      console.log(
        `  + [${docSnapshot.id}] ${name} -> ${countLabel}${usedFallback ? ' (fallback thumbnail)' : ''}`,
      );
    } catch (err) {
      console.error(`  ✗ Lookup/update failed for "${name}": ${(err as Error).message}`);
      needsManualPhoto.push(name);
    }
  }

  console.log('\nDone.');
  console.log(`Updated: ${updatedCount}/${snapshot.docs.length}`);
  if (needsManualPhoto.length > 0) {
    console.log(`\nNeeds a manual photo (${needsManualPhoto.length}):`);
    for (const entry of needsManualPhoto) {
      console.log(`  - ${entry}`);
    }
  }
}

backfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
