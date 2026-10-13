/**
 * scripts/seed-test-places.ts
 *
 * TEST / SEED DATA ONLY. This is a standalone, manually-run utility — it is
 * NOT part of the app and is never imported from anywhere under src/. Its
 * only job is to populate Firestore with sample "places" documents so the
 * Discover feed and map have something to show during development.
 *
 * RUN MANUALLY with:
 *   npx tsx scripts/seed-test-places.ts
 *
 * (tsx isn't a project dependency; npx will fetch it on the fly the first
 * time you run this. No changes to package.json are needed.)
 *
 * WHAT IT WRITES: 2 sample places for each category currently defined in
 * src/constants/theme.ts's Categories object. As of when this script was
 * written that's 9 categories, i.e. 18 documents total (not 16 — Categories
 * has grown since the 4-category version of the app). The category list
 * below is a deliberate, hand-picked snapshot rather than something that
 * auto-generates from Categories, so if you add a new category later you'll
 * want to add two entries for it here too — seedPlaceCountByCategory() below
 * will print a warning at run time if the two ever drift out of sync.
 *
 * CLEANUP: every document this script writes has submittedBy set to the
 * fixed test uid below, so they can all be found and bulk-deleted later,
 * e.g. from another script or the Firebase console, with a query like:
 *   where('submittedBy', '==', 'seed-script-test-user')
 *
 * SECURITY RULES CAVEAT: this uses the app's normal client-side `db` export
 * from src/lib/firebase.ts — the same connection the app itself uses, not
 * an admin/service-account connection. If the firestore.rules drafted for
 * this project are live on the Firebase project, they WILL reject these
 * writes: the `create` rule requires request.auth != null and
 * status == 'pending' on the new document, but this script writes
 * unauthenticated documents with status == 'approved' (on purpose, so the
 * seeded places show up immediately without a manual admin approval pass).
 * To actually run this successfully you'll need to either:
 *   1. Temporarily relax the `places` create rule in the Firebase Console
 *      (e.g. `allow create: if true;`) while seeding, then restore it, or
 *   2. Swap this script to the Firebase Admin SDK with a service account
 *      key, which bypasses Security Rules entirely — the standard approach
 *      for seed scripts, but it's a separate setup step (service account
 *      JSON, `firebase-admin` package) this script doesn't do for you.
 * This script does not attempt either automatically; that's a call for
 * whoever runs it.
 */

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

import { Categories } from '../src/constants/theme';
import { db } from '../src/lib/firebase';

const SEED_UID = 'seed-script-test-user';
const SEED_NAME = 'Test Seeder';

interface SeedPlace {
  category: keyof typeof Categories;
  name: string;
  description: string;
  lat: number;
  lng: number;
  rating: number;
}

// Two realistic-sounding, geographically scattered Ontario spots per
// category. photoURLs is seeded as [] rather than a placeholder image URL —
// the app already falls back to a solid category-color card when a place
// has no photos (see index.tsx's placePhoto rendering), so there's no need
// to depend on a fake external image.
const SEED_PLACES: SeedPlace[] = [
  // nature
  {
    category: 'nature',
    name: 'Rattlesnake Point Lookout',
    description:
      'A cliffside lookout over the Niagara Escarpment with sweeping views of the Nassagaweya Canyon.',
    lat: 43.5019,
    lng: -79.9377,
    rating: 5,
  },
  {
    category: 'nature',
    name: "Devil's Glen Trail",
    description: 'A quiet forest trail winding past a waterfall carved into the Blue Mountains.',
    lat: 44.4732,
    lng: -80.1919,
    rating: 4,
  },
  // food
  {
    category: 'food',
    name: 'Maple & Ember Smokehouse',
    description: 'Wood-fired barbecue and local maple glazes in the heart of Prince Edward County.',
    lat: 43.9209,
    lng: -77.1116,
    rating: 4,
  },
  {
    category: 'food',
    name: 'Harbourfront Fish Shack',
    description: 'Fresh Lake Ontario perch served dockside, cash only, lineups worth it.',
    lat: 44.2312,
    lng: -76.486,
    rating: 5,
  },
  // art
  {
    category: 'art',
    name: 'Distillery District Mural Walk',
    description: 'Cobblestone laneways lined with rotating street art installations.',
    lat: 43.6503,
    lng: -79.3596,
    rating: 4,
  },
  {
    category: 'art',
    name: 'Stratford Riverside Sculpture Garden',
    description: 'A public sculpture trail along the Avon River, best visited at golden hour.',
    lat: 43.3701,
    lng: -80.9821,
    rating: 4,
  },
  // hiddenGem
  {
    category: 'hiddenGem',
    name: 'Elora Quarry Swimming Hole',
    description: 'A limestone quarry turned swimming spot — locals know which ledge to jump from.',
    lat: 43.6763,
    lng: -80.4327,
    rating: 5,
  },
  {
    category: 'hiddenGem',
    name: 'Scarborough Bluffs Secret Beach',
    description: 'A tucked-away shoreline below the bluffs — easy to miss the unmarked trailhead.',
    lat: 43.7064,
    lng: -79.2318,
    rating: 5,
  },
  // adventure
  {
    category: 'adventure',
    name: 'Ouimet Canyon Ziplines',
    description: 'A high-speed zipline run across a 100-metre-deep canyon near Thunder Bay.',
    lat: 48.746,
    lng: -88.669,
    rating: 5,
  },
  {
    category: 'adventure',
    name: 'White Squall Rapids Kayak Run',
    description: "Whitewater kayaking through the French River's rocky channels.",
    lat: 46.021,
    lng: -80.439,
    rating: 4,
  },
  // historic
  {
    category: 'historic',
    name: 'Fort Henry Ramparts',
    description: 'A restored 19th-century fortress overlooking the St. Lawrence River.',
    lat: 44.2295,
    lng: -76.472,
    rating: 4,
  },
  {
    category: 'historic',
    name: 'Black Creek Pioneer Village',
    description: 'A recreated 1860s village with costumed interpreters and working mills.',
    lat: 43.7735,
    lng: -79.5192,
    rating: 3,
  },
  // nightlife
  {
    category: 'nightlife',
    name: 'Ossington Strip Speakeasy',
    description: "An unmarked door, a jazz trio, and the city's best old fashioned.",
    lat: 43.6467,
    lng: -79.42,
    rating: 5,
  },
  {
    category: 'nightlife',
    name: 'Byward Market Rooftop Lounge',
    description: "Rooftop cocktails overlooking Ottawa's oldest market district.",
    lat: 45.4285,
    lng: -75.691,
    rating: 4,
  },
  // seasonal
  {
    category: 'seasonal',
    name: 'Blue Mountain Night Skiing',
    description: 'Floodlit runs and a heated gondola once the sun goes down.',
    lat: 44.5001,
    lng: -80.3117,
    rating: 4,
  },
  {
    category: 'seasonal',
    name: 'Winterlude Ice Sculptures',
    description: 'Massive hand-carved ice sculptures line the frozen Rideau Canal each February.',
    lat: 45.4112,
    lng: -75.6981,
    rating: 5,
  },
  // roadTrip
  {
    category: 'roadTrip',
    name: 'Agawa Canyon Lookout Stop',
    description: 'A dramatic highway pullover on the Trans-Canada with canyon views.',
    lat: 47.048,
    lng: -84.557,
    rating: 4,
  },
  {
    category: 'roadTrip',
    name: 'Thousand Islands Skydeck Pullover',
    description: "A can't-miss stop for river views on the drive toward Gananoque.",
    lat: 44.3312,
    lng: -76.013,
    rating: 3,
  },
];

function warnIfCategoriesDrifted() {
  const counts = new Map<string, number>();
  for (const place of SEED_PLACES) {
    counts.set(place.category, (counts.get(place.category) ?? 0) + 1);
  }

  for (const key of Object.keys(Categories)) {
    if (counts.get(key) !== 2) {
      console.warn(
        `Warning: category "${key}" has ${counts.get(key) ?? 0} seed entries, expected 2. ` +
          'Categories in theme.ts may have changed since this script was written.',
      );
    }
  }
  for (const key of counts.keys()) {
    if (!(key in Categories)) {
      console.warn(`Warning: seed entry uses category "${key}", which no longer exists in Categories.`);
    }
  }
}

async function seed() {
  warnIfCategoriesDrifted();

  console.log(`Seeding ${SEED_PLACES.length} test places...`);
  for (const place of SEED_PLACES) {
    const docRef = await addDoc(collection(db, 'places'), {
      name: place.name,
      category: place.category,
      description: place.description,
      rating: place.rating,
      submittedBy: SEED_UID,
      submittedByName: SEED_NAME,
      createdAt: serverTimestamp(),
      status: 'approved',
      photoURLs: [],
      lat: place.lat,
      lng: place.lng,
      reviewedAt: serverTimestamp(),
      notified: true,
    });
    console.log(`  + [${place.category}] ${place.name} (${docRef.id})`);
  }
  console.log('Done.');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
