/**
 * scripts/grant-admin-role.ts
 *
 * ONE-OFF SCRIPT. This is a standalone, manually-run utility — it is NOT
 * part of the app and is never imported from anywhere under src/. Its only
 * job is to set `role: 'admin'` on the signed-in account's own
 * users/{uid} document.
 *
 * RUN MANUALLY with:
 *   ADMIN_EMAIL=<the admin account's email> ADMIN_PASSWORD=<the admin account's password> npx tsx scripts/grant-admin-role.ts
 *
 * (tsx isn't a project dependency; npx will fetch it on the fly the first
 * time you run this. No changes to package.json are needed.)
 *
 * SECURITY RULES / DEPLOYMENT ORDER (load-bearing — read before running):
 * this uses the app's normal client-side `db`/`auth` exports from
 * src/lib/firebase.ts, the same connection the app itself uses, and signs in
 * as ADMIN_EMAIL with signInWithEmailAndPassword — same pattern as
 * scripts/seed-curated-attractions.ts. That means the write still goes
 * through firestore.rules like any other client write.
 *
 * firestore.rules' new isAdmin() checks the requester's OWN users/{uid}
 * document for role == 'admin' — which means once that rules file is live,
 * nobody can grant the very first admin: isAdmin() is false for everyone
 * (no one has role: 'admin' yet) and the owner-update branch explicitly
 * forbids changing your own role. So this script MUST be run — successfully,
 * with the resulting role confirmed in the Firestore console — BEFORE
 * publishing the role-based firestore.rules. Whatever rules are live at the
 * time this runs are what govern the write; if those still have no
 * users/{uid} rule at all (true of this repo's firestore.rules before this
 * change), publish just the new `match /users/{uid}` block first (leaving
 * isAdmin() as the old email check) so this script's write is allowed, then
 * run this script, then publish the rest of the new firestore.rules.
 *
 * This also requires the ADMIN_EMAIL account to already exist in Firebase
 * Auth with email/password sign-in enabled, and its users/{uid} document to
 * already exist (created at signup or backfilled on sign-in). The password
 * is read from the ADMIN_PASSWORD env var, never hardcoded here, since this
 * file is committed to source control.
 */

import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';

import { auth, db } from '../src/lib/firebase';

// The admin account's email comes from the ADMIN_EMAIL env var, like the
// password, so no personal address is stored in the repo.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? '';

async function grantAdminRole() {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!ADMIN_EMAIL || !adminPassword) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD env vars must both be set. Run this as:\n' +
        '  ADMIN_EMAIL=<the admin account\'s email> ADMIN_PASSWORD=<the admin account\'s password> npx tsx scripts/grant-admin-role.ts',
    );
  }

  console.log(`Signing in as ${ADMIN_EMAIL}...`);
  const credential = await signInWithEmailAndPassword(auth, ADMIN_EMAIL, adminPassword);

  console.log(`Setting role: 'admin' on users/${credential.user.uid}...`);
  await setDoc(doc(db, 'users', credential.user.uid), { role: 'admin' }, { merge: true });

  console.log('Done. Verify in the Firestore console that the document now has role: "admin".');
}

grantAdminRole()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Granting admin role failed:', err);
    process.exit(1);
  });
