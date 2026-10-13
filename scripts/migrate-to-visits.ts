/**
 * scripts/migrate-to-visits.ts
 *
 * ONE-OFF MIGRATION SCRIPT. This is a standalone, manually-run utility — it
 * is NOT part of the app and is never imported from anywhere under src/. Its
 * only job is to move each place's user-generated content (photos,
 * description, rating, submitter) out of the "places" document and into a
 * new "visits" document, as part of the place-aggregation data model.
 *
 * DRY RUN BY DEFAULT. Without --execute this script only reads, and prints
 * exactly what it WOULD write for every document. Nothing is written unless
 * --execute is passed:
 *
 *   Dry run (read-only):
 *     ADMIN_EMAIL=<the admin account's email> ADMIN_PASSWORD=<the admin account's password> npx tsx scripts/migrate-to-visits.ts
 *
 *   Real run (writes to Firestore):
 *     ADMIN_EMAIL=<the admin account's email> ADMIN_PASSWORD=<the admin account's password> npx tsx scripts/migrate-to-visits.ts --execute
 *
 * DO NOT run with --execute until the app reads photos/description/rating
 * from "visits" and createdBy/createdByName from "places" — every screen that
 * currently reads those fields off a place will show them as missing the
 * moment this runs. firestore.rules also needs a "visits" match block (and
 * the places rules need submittedBy -> createdBy) before --execute can
 * succeed at all; today there is no visits rule, so those writes are denied.
 *
 * WHAT IT DOES, for every document in "places":
 *   1. Creates visits/{placeId} with placeId, visitedBy, visitedByName,
 *      photoURLs, description, rating, createdAt (copied from the place),
 *      status (copied from the place — see STATUS below) and
 *      isBillboard: true.
 *   2. Updates the place: deletes photoURLs, description, rating,
 *      submittedBy and submittedByName, and adds createdBy / createdByName
 *      (renamed from submittedBy / submittedByName). name, lat, lng,
 *      category, createdAt and status are left untouched.
 *   Both writes for a place go in one writeBatch, so a place is never left
 *   half-migrated (visit created but place not stripped, or vice versa).
 *
 * STATUS: the visit copies the place's own status rather than hardcoding
 * 'approved'. "places" also holds pending and rejected submissions, and
 * migrating those as approved visits would publish content an admin never
 * approved (or already rejected).
 *
 * FIELDS OUTSIDE THE NEW SCHEMA (e.g. reviewedAt, notified — written by
 * admin.tsx on approve/reject and read by index.tsx's approval
 * notifications) are LEFT AS-IS, not deleted, and listed per place in the
 * log. Deleting `notified` would break the approval-notification flow and
 * the owner-update rule in firestore.rules, so dropping them is a decision
 * for the Part 2 app changes, not this script.
 *
 * RE-RUNNABLE: the visit's document id is the place's id, and a place that
 * already has createdBy and no submittedBy is reported as already migrated
 * and skipped. Re-running after a partial failure never creates duplicate
 * visits.
 *
 * CURATED ATTRACTIONS are NOT migrated. They live in a separate collection
 * ("curatedAttractions", read only by explore-canada.tsx), and have no
 * submitter, rating or status, so there is nothing to map onto visitedBy /
 * visitedByName / rating. This script only reads and lists them, so the
 * dry-run output shows that they were looked at and deliberately skipped.
 *
 * SECURITY RULES: like the other admin scripts, this uses the app's normal
 * client-side `db`/`auth` exports from src/lib/firebase.ts and signs in as
 * ADMIN_EMAIL with signInWithEmailAndPassword (password from the
 * ADMIN_PASSWORD env var, never hardcoded). firestore.rules' isAdmin()
 * checks users/{uid}.role == 'admin', so that account needs the admin role.
 * Signing in is required even for a dry run, because only an admin can read
 * pending and rejected places.
 */

import { signInWithEmailAndPassword } from 'firebase/auth';
import {
  collection,
  deleteField,
  doc,
  getDocs,
  Timestamp,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';

import { auth, db } from '../src/lib/firebase';

// The admin account's email comes from the ADMIN_EMAIL env var, like the
// password, so no personal address is stored in the repo.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? '';

const EXECUTE = process.argv.includes('--execute');

// Fields that move to the visit (or are renamed) and get deleted from the place.
const STRIPPED_FIELDS = ['photoURLs', 'description', 'rating', 'submittedBy', 'submittedByName'];

// Fields the new place schema keeps as-is.
const KEPT_FIELDS = ['name', 'lat', 'lng', 'category', 'createdAt', 'status'];

// The new place schema's other fields, i.e. the ones this script adds.
const ADDED_FIELDS = ['createdBy', 'createdByName'];

function formatTimestamp(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value === undefined || value === null) return '(missing)';
  return `(unexpected: ${JSON.stringify(value)})`;
}

function truncate(text: string, max = 70): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function buildVisit(placeId: string, place: DocumentData) {
  return {
    placeId,
    visitedBy: place.submittedBy as string,
    visitedByName: (place.submittedByName as string | undefined) ?? '',
    photoURLs: (place.photoURLs as string[] | undefined) ?? [],
    description: (place.description as string | undefined) ?? '',
    rating: (place.rating as number | null | undefined) ?? null,
    createdAt: place.createdAt ?? null,
    status: place.status as 'pending' | 'approved' | 'rejected',
    isBillboard: true,
  };
}

function logVisit(placeId: string, visit: ReturnType<typeof buildVisit>) {
  const verb = EXECUTE ? 'CREATE' : 'WOULD CREATE';
  console.log(`    ${verb} visits/${placeId}`);
  console.log(`      placeId:       ${visit.placeId}`);
  console.log(`      visitedBy:     ${visit.visitedBy}`);
  console.log(`      visitedByName: ${JSON.stringify(visit.visitedByName)}`);
  console.log(
    `      photoURLs:     ${visit.photoURLs.length} URL${visit.photoURLs.length === 1 ? '' : 's'}`,
  );
  for (const url of visit.photoURLs) {
    console.log(`                     - ${truncate(url, 90)}`);
  }
  console.log(
    `      description:   ${visit.description ? JSON.stringify(truncate(visit.description)) : '(empty)'}`,
  );
  console.log(`      rating:        ${visit.rating ?? '(none)'}`);
  console.log(`      createdAt:     ${formatTimestamp(visit.createdAt)}`);
  console.log(`      status:        ${visit.status}`);
  console.log(`      isBillboard:   ${visit.isBillboard}`);
}

function logPlaceUpdate(placeId: string, place: DocumentData) {
  const verb = EXECUTE ? 'UPDATE' : 'WOULD UPDATE';
  const present = (field: string) => field in place;
  const untouched = Object.keys(place).filter(
    (field) => !STRIPPED_FIELDS.includes(field) && !KEPT_FIELDS.includes(field),
  );

  console.log(`    ${verb} places/${placeId}`);
  console.log(`      delete:  ${STRIPPED_FIELDS.filter(present).join(', ') || '(none present)'}`);
  console.log(`      add:     createdBy = ${place.submittedBy}`);
  console.log(`               createdByName = ${JSON.stringify(place.submittedByName ?? '')}`);
  console.log(`      keep:    ${KEPT_FIELDS.filter(present).join(', ')}`);
  const missingKept = KEPT_FIELDS.filter((field) => !present(field));
  if (missingKept.length > 0) {
    console.log(`      ! missing from source doc: ${missingKept.join(', ')}`);
  }
  if (untouched.length > 0) {
    console.log(`      left as-is (not in new schema): ${untouched.join(', ')}`);
  }
}

async function migrate() {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!ADMIN_EMAIL || !adminPassword) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD env vars must both be set. Run this as:\n' +
        "  ADMIN_EMAIL=<the admin account's email> ADMIN_PASSWORD=<the admin account's password> npx tsx scripts/migrate-to-visits.ts [--execute]",
    );
  }

  console.log('='.repeat(72));
  console.log(
    EXECUTE
      ? 'EXECUTE MODE — changes WILL be written to Firestore.'
      : 'DRY RUN — read-only. Nothing will be written. Pass --execute to apply.',
  );
  console.log('='.repeat(72));

  console.log(`Signing in as ${ADMIN_EMAIL}...`);
  await signInWithEmailAndPassword(auth, ADMIN_EMAIL, adminPassword);

  const snapshot = await getDocs(collection(db, 'places'));
  const total = snapshot.docs.length;
  console.log(`\nFound ${total} documents in "places".\n`);

  const migrated: string[] = [];
  const alreadyMigrated: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  const statusCounts: Record<string, number> = {};

  for (const [index, placeSnapshot] of snapshot.docs.entries()) {
    const placeId = placeSnapshot.id;
    const place = placeSnapshot.data();
    const label = `places/${placeId} ${JSON.stringify(place.name ?? '(no name)')}`;

    console.log(`[${index + 1}/${total}] ${label} (status: ${place.status ?? '(missing)'})`);

    if (!place.submittedBy && place.createdBy) {
      console.log('    SKIP: already migrated (has createdBy, no submittedBy).\n');
      alreadyMigrated.push(label);
      continue;
    }

    if (!place.submittedBy) {
      console.log('    SKIP: no submittedBy — cannot build visitedBy. Needs manual review.\n');
      skipped.push(`${label} — no submittedBy`);
      continue;
    }

    if (!['pending', 'approved', 'rejected'].includes(place.status)) {
      console.log(
        `    SKIP: unexpected status ${JSON.stringify(place.status)}. Needs manual review.\n`,
      );
      skipped.push(`${label} — unexpected status ${JSON.stringify(place.status)}`);
      continue;
    }

    const visit = buildVisit(placeId, place);
    logVisit(placeId, visit);
    logPlaceUpdate(placeId, place);

    if (EXECUTE) {
      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'visits', placeId), visit);
        batch.update(doc(db, 'places', placeId), {
          photoURLs: deleteField(),
          description: deleteField(),
          rating: deleteField(),
          submittedBy: deleteField(),
          submittedByName: deleteField(),
          createdBy: place.submittedBy,
          createdByName: place.submittedByName ?? '',
        });
        await batch.commit();
        console.log('    ✓ written');
      } catch (err) {
        console.error(`    ✗ FAILED: ${(err as Error).message}`);
        failed.push(`${label} — ${(err as Error).message}`);
        console.log('');
        continue;
      }
    }

    migrated.push(label);
    statusCounts[visit.status] = (statusCounts[visit.status] ?? 0) + 1;
    console.log('');
  }

  // Curated attractions: read and reported only, never written. See the
  // CURATED ATTRACTIONS note at the top of this file.
  const curatedSnapshot = await getDocs(collection(db, 'curatedAttractions'));
  console.log('-'.repeat(72));
  console.log(
    `"curatedAttractions": ${curatedSnapshot.docs.length} documents — NOT migrated ` +
      '(no submitter/rating/status to map onto a visit). Listed for reference:',
  );
  for (const attraction of curatedSnapshot.docs) {
    const data = attraction.data();
    const photoCount = (data.photoURLs as string[] | undefined)?.length ?? 0;
    console.log(
      `  - curatedAttractions/${attraction.id} ${JSON.stringify(data.name ?? '(no name)')} ` +
        `(${photoCount} photo${photoCount === 1 ? '' : 's'}; fields: ${Object.keys(data).sort().join(', ')})`,
    );
  }

  console.log('\n' + '='.repeat(72));
  console.log(EXECUTE ? 'SUMMARY (EXECUTED)' : 'SUMMARY (DRY RUN — nothing was written)');
  console.log('='.repeat(72));
  console.log(`places scanned:              ${total}`);
  console.log(
    `${EXECUTE ? 'migrated' : 'would migrate'}:${' '.repeat(EXECUTE ? 20 : 15)}${migrated.length}` +
      ` (visits by status: ${
        Object.entries(statusCounts)
          .map(([status, count]) => `${status} ${count}`)
          .join(', ') || 'none'
      })`,
  );
  console.log(`already migrated (skipped):  ${alreadyMigrated.length}`);
  console.log(`needs manual review:         ${skipped.length}`);
  for (const entry of skipped) console.log(`  - ${entry}`);
  if (EXECUTE) {
    console.log(`failed:                      ${failed.length}`);
    for (const entry of failed) console.log(`  - ${entry}`);
  }
  console.log(`curatedAttractions (untouched): ${curatedSnapshot.docs.length}`);
  console.log(`\nNew place schema after migration: ${[...KEPT_FIELDS, ...ADDED_FIELDS].join(', ')}`);
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
