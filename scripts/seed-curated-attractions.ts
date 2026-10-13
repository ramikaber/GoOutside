/**
 * scripts/seed-curated-attractions.ts
 *
 * ONE-OFF SEED SCRIPT. This is a standalone, manually-run utility — it is
 * NOT part of the app and is never imported from anywhere under src/. Its
 * only job is to populate Firestore's "curatedAttractions" collection with
 * an initial batch of admin-curated Ontario attractions for the "Explore
 * Canada" feature.
 *
 * RUN MANUALLY with:
 *   ADMIN_EMAIL=<the admin account's email> ADMIN_PASSWORD=<the admin account's password> npx tsx scripts/seed-curated-attractions.ts
 *
 * (tsx isn't a project dependency; npx will fetch it on the fly the first
 * time you run this. No changes to package.json are needed.)
 *
 * SECURITY RULES: this uses the app's normal client-side `db`/`auth` exports
 * from src/lib/firebase.ts — the same connection the app itself uses, not
 * an admin/service-account connection. firestore.rules restricts writes to
 * "curatedAttractions" to the admin account (isAdmin(), role 'admin' on its
 * users/{uid} doc), so this script signs in as ADMIN_EMAIL with
 * signInWithEmailAndPassword before writing anything. For that to work:
 *   - The ADMIN_EMAIL account must already exist in Firebase Auth with
 *     email/password sign-in enabled (Authentication > Sign-in method in
 *     the Firebase console) — if it currently only exists via another
 *     provider (e.g. Google), add an email/password credential for it first.
 *   - The password is read from the ADMIN_PASSWORD env var, never hardcoded
 *     here, since this file is committed to source control.
 * If you'd rather not use the admin account's real password for this,
 * the alternative is swapping this script to the Firebase Admin SDK with a
 * service account key, which bypasses Security Rules entirely — the more
 * typical approach for seed scripts, but it's a separate setup step
 * (service account JSON, `firebase-admin` package) this script doesn't do
 * for you.
 */

import { signInWithEmailAndPassword } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

import { Categories } from '../src/constants/theme';
import { auth, db } from '../src/lib/firebase';

// The admin account's email comes from the ADMIN_EMAIL env var, like the
// password, so no personal address is stored in the repo.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? '';

interface SeedAttraction {
  name: string;
  city: string;
  province: string;
  category: keyof typeof Categories | '';
  lat: number;
  lng: number;
  description: string;
}

const SEED_ATTRACTIONS: SeedAttraction[] = [
  { name: 'CN Tower', city: 'Toronto', province: 'Ontario', category: 'adventure', lat: 43.6426, lng: -79.3871, description: "Toronto's iconic skyline landmark with an observation deck, glass floor, and panoramic city and lake views." },
  { name: "Ripley's Aquarium of Canada", city: 'Toronto', province: 'Ontario', category: 'adventure', lat: 43.6424, lng: -79.386, description: 'Large downtown aquarium with a moving walkway through a shark tank, popular with families.' },
  { name: 'Distillery District', city: 'Toronto', province: 'Ontario', category: 'art', lat: 43.6503, lng: -79.3596, description: 'Pedestrian-only Victorian-era industrial village of restored brick warehouses filled with galleries, boutiques, and restaurants.' },
  { name: 'Toronto Islands', city: 'Toronto', province: 'Ontario', category: 'nature', lat: 43.6205, lng: -79.3789, description: 'Car-free islands reachable by ferry, with beaches, an amusement park, bike paths, and skyline views.' },
  { name: 'Art Gallery of Ontario', city: 'Toronto', province: 'Ontario', category: 'art', lat: 43.6536, lng: -79.3925, description: "One of North America's largest art museums, in a major Frank Gehry-designed building." },
  { name: 'Kensington Market', city: 'Toronto', province: 'Ontario', category: 'food', lat: 43.6547, lng: -79.4005, description: 'Bohemian, multicultural neighbourhood of vintage shops, street art, and independent food stalls.' },
  { name: 'St. Lawrence Market', city: 'Toronto', province: 'Ontario', category: 'food', lat: 43.6487, lng: -79.3716, description: "Historic indoor food market often ranked among the world's best, known for peameal bacon sandwiches." },
  { name: 'Casa Loma', city: 'Toronto', province: 'Ontario', category: 'historic', lat: 43.678, lng: -79.4094, description: 'A genuine early-1900s Gothic Revival castle open for self-guided tours through towers and gardens.' },
  { name: 'Royal Ontario Museum', city: 'Toronto', province: 'Ontario', category: 'art', lat: 43.6677, lng: -79.3948, description: "Canada's largest museum of world cultures and natural history, with a striking crystal-shaped addition." },
  { name: 'Chester Hill Lookout', city: 'Toronto', province: 'Ontario', category: 'hiddenGem', lat: 43.6784, lng: -79.3521, description: 'A free, little-known lookout over the Don Valley with a painted astrology-wheel mural underfoot.' },
  { name: 'Guild Park & Gardens', city: 'Toronto', province: 'Ontario', category: 'hiddenGem', lat: 43.7448, lng: -79.1966, description: "A former artists' colony turned public park, scattered with rescued architectural fragments overlooking Lake Ontario." },
  { name: 'Scarborough Bluffs', city: 'Toronto', province: 'Ontario', category: 'nature', lat: 43.7064, lng: -79.2333, description: 'Dramatic lakeside cliff formations along Lake Ontario, popular for photography and quiet walks.' },
  { name: 'Gibraltar Point Lighthouse', city: 'Toronto', province: 'Ontario', category: 'historic', lat: 43.6122, lng: -79.3928, description: 'One of the oldest lighthouses on the Great Lakes (1808), with local ghost-story lore.' },
  { name: 'Rouge National Urban Park', city: 'Toronto', province: 'Ontario', category: 'nature', lat: 43.8095, lng: -79.1633, description: 'A 79-square-kilometre national park within city limits — forests, wetlands, and hiking trails.' },
  { name: 'R.C. Harris Water Treatment Plant', city: 'Toronto', province: 'Ontario', category: 'hiddenGem', lat: 43.6746, lng: -79.2977, description: "A stunning Art Deco 'Palace of Purification' on the Beaches waterfront, a favourite quiet photography spot." },
  { name: 'Redway Road Staircase', city: 'Toronto', province: 'Ontario', category: 'hiddenGem', lat: 43.7089, lng: -79.3661, description: 'A hidden, tree-concealed 200-step wooden staircase in Leaside known mostly to locals.' },
  { name: 'Mackenzie House', city: 'Toronto', province: 'Ontario', category: 'historic', lat: 43.6572, lng: -79.3789, description: "The preserved 1858 home of Toronto's first mayor, with a reputation as one of the city's most haunted sites." },
  { name: 'Parliament Hill', city: 'Ottawa', province: 'Ontario', category: 'historic', lat: 45.4236, lng: -75.7009, description: "Seat of Canada's federal government, with free tours and the summer Changing of the Guard ceremony." },
  { name: 'Rideau Canal', city: 'Ottawa', province: 'Ontario', category: 'seasonal', lat: 45.4215, lng: -75.6919, description: "UNESCO World Heritage Site — the world's largest naturally frozen skating rink in winter." },
  { name: 'Canadian War Museum', city: 'Ottawa', province: 'Ontario', category: 'historic', lat: 45.4128, lng: -75.7217, description: "An internationally recognized museum with striking architecture covering Canada's military history." },
  { name: 'ByWard Market', city: 'Ottawa', province: 'Ontario', category: 'food', lat: 45.4285, lng: -75.6919, description: "Ottawa's historic market district — food stalls, restaurants, and the famous BeaverTails pastry stand." },
  { name: 'Mer Bleue Bog', city: 'Ottawa', province: 'Ontario', category: 'nature', lat: 45.4084, lng: -75.5183, description: 'A rare northern peat bog with a raised boardwalk through a boreal ecosystem, 15 minutes from downtown.' },
  { name: 'Mackenzie King Estate', city: 'Ottawa', province: 'Ontario', category: 'historic', lat: 45.4744, lng: -75.8285, description: "The former summer residence of Canada's 10th Prime Minister, with landscaped grounds in Gatineau Park." },
  { name: "Watson's Mill", city: 'Ottawa', province: 'Ontario', category: 'historic', lat: 45.228, lng: -75.6847, description: 'A working historic gristmill in Manotick offering guided tours along the Rideau River.' },
  { name: 'Findlay Creek Boardwalk', city: 'Ottawa', province: 'Ontario', category: 'hiddenGem', lat: 45.3283, lng: -75.6047, description: 'A quiet 900-metre floating boardwalk through a protected wetland, known mostly by word of mouth.' },
  { name: 'Dominion Arboretum', city: 'Ottawa', province: 'Ontario', category: 'nature', lat: 45.3903, lng: -75.7058, description: "Canada's oldest arboretum, an easy 4.5km loop through over 4,000 tree and shrub species." },
  { name: 'Diefenbunker', city: 'Ottawa', province: 'Ontario', category: 'historic', lat: 45.3333, lng: -76.05, description: 'A massive underground Cold War-era bunker built to shelter the government, now an undervisited museum.' },
  { name: 'Dominion Observatory Ruins', city: 'Ottawa', province: 'Ontario', category: 'hiddenGem', lat: 45.3897, lng: -75.7092, description: 'The remains of Canada\'s early-1900s space research centre, now a quiet stargazing spot.' },
  { name: 'Horseshoe Falls', city: 'Niagara Falls', province: 'Ontario', category: 'nature', lat: 43.0799, lng: -79.0747, description: "The main, most powerful section of Niagara Falls — Ontario's definitive natural landmark." },
  { name: 'Journey Behind the Falls', city: 'Niagara Falls', province: 'Ontario', category: 'adventure', lat: 43.0806, lng: -79.0754, description: 'Tunnels carved into the rock behind Horseshoe Falls leading to an observation deck at water level.' },
  { name: 'Skylon Tower', city: 'Niagara Falls', province: 'Ontario', category: 'adventure', lat: 43.0821, lng: -79.0779, description: 'An observation tower with a revolving restaurant overlooking the falls.' },
  { name: 'Clifton Hill', city: 'Niagara Falls', province: 'Ontario', category: 'nightlife', lat: 43.0896, lng: -79.0774, description: 'A dense strip of family entertainment, arcades, and attractions just up the hill from the falls.' },
  { name: 'Niagara-on-the-Lake', city: 'Niagara-on-the-Lake', province: 'Ontario', category: 'roadTrip', lat: 43.2557, lng: -79.0715, description: 'A well-preserved historic town known for its wineries, icewine, and the Shaw Festival theatre.' },
  { name: 'Whirlpool Rapids Boardwalk', city: 'Niagara Falls', province: 'Ontario', category: 'nature', lat: 43.105, lng: -79.0614, description: 'A quieter trail along the turbulent rapids downstream from the falls.' },
  { name: 'Fort Henry', city: 'Kingston', province: 'Ontario', category: 'historic', lat: 44.2298, lng: -76.462, description: 'A 19th-century fortification with guard-changing ceremonies and a summer Sunset Ceremony.' },
  { name: 'Kingston Penitentiary Tours', city: 'Kingston', province: 'Ontario', category: 'historic', lat: 44.2359, lng: -76.4931, description: "Guided tours through Canada's oldest and most notorious former maximum-security prison." },
  { name: 'Thousand Islands Cruises', city: 'Kingston', province: 'Ontario', category: 'adventure', lat: 44.2312, lng: -76.481, description: "Boat tours through the Thousand Islands region, past small islands and historic 'castles'." },
  { name: 'Kingston Waterfront Pathway', city: 'Kingston', province: 'Ontario', category: 'nature', lat: 44.2312, lng: -76.486, description: 'A scenic walking/biking path along Lake Ontario through downtown Kingston.' },
  { name: 'Bellevue House', city: 'Kingston', province: 'Ontario', category: 'historic', lat: 44.228, lng: -76.504, description: "The historic home of Sir John A. Macdonald, Canada's first prime minister." },
  { name: 'Lemon Point Conservation Area', city: 'Kingston', province: 'Ontario', category: 'hiddenGem', lat: 44.25, lng: -76.42, description: 'A quiet conservation area with trails through forest and meadow, and lake views most visitors miss.' },
  { name: 'Wolfe Island Ferry', city: 'Kingston', province: 'Ontario', category: 'roadTrip', lat: 44.2233, lng: -76.4667, description: 'A free ferry connecting Kingston to Wolfe Island — a low-key way to see the city from the water.' },
  { name: 'PumpHouse Steam Museum', city: 'Kingston', province: 'Ontario', category: 'hiddenGem', lat: 44.2333, lng: -76.4833, description: 'A former steam-powered water pumping station converted into a quirky industrial-history museum.' },
  { name: 'Kingston Public Market', city: 'Kingston', province: 'Ontario', category: 'food', lat: 44.2308, lng: -76.481, description: "Ontario's oldest farmers' market, selling local produce, antiques, and artisan crafts." },
  { name: 'Algonquin Provincial Park', city: 'Algonquin Park', province: 'Ontario', category: 'nature', lat: 45.5764, lng: -78.573, description: "Ontario's oldest provincial park — maple hills, rocky ridges, and thousands of lakes for canoeing and hiking." },
  { name: 'Algonquin Park Visitor Centre', city: 'Algonquin Park', province: 'Ontario', category: 'nature', lat: 45.5764, lng: -78.4894, description: "Interactive displays and wildlife dioramas explaining the park's natural and human history." },
  { name: 'Muskoka Lakes', city: 'Muskoka', province: 'Ontario', category: 'roadTrip', lat: 45.0378, lng: -79.3092, description: "Ontario's classic cottage country — interconnected lakes, resorts, and the historic steamship R.M.S. Segwun." },
  { name: 'Screaming Heads', city: "Burk's Falls", province: 'Ontario', category: 'hiddenGem', lat: 45.6, lng: -79.4, description: 'A strange, striking outdoor sculpture park of giant carved wooden heads — an offbeat roadside attraction.' },
  { name: 'Georgian Bay 30,000 Islands', city: 'Parry Sound', province: 'Ontario', category: 'nature', lat: 45.3444, lng: -80.0333, description: 'A UNESCO-designated Biosphere Reserve — rugged granite shoreline and thousands of small islands.' },
  { name: 'Elora Gorge', city: 'Elora', province: 'Ontario', category: 'adventure', lat: 43.68, lng: -80.43, description: 'A dramatic limestone river gorge with cliffside trails and summer tubing.' },
  { name: 'Elora Quarry', city: 'Elora', province: 'Ontario', category: 'hiddenGem', lat: 43.6767, lng: -80.4322, description: 'A flooded former limestone quarry turned swimming spot, known for its turquoise water.' },
  { name: "St. Jacobs Market", city: 'St. Jacobs', province: 'Ontario', category: 'food', lat: 43.5372, lng: -80.5511, description: "A large farmers'/artisan market in Mennonite country, known for baked goods and local crafts." },
];

function warnIfCategoryUnknown() {
  for (const attraction of SEED_ATTRACTIONS) {
    if (attraction.category && !(attraction.category in Categories)) {
      console.warn(
        `Warning: "${attraction.name}" uses category "${attraction.category}", which doesn't exist in Categories.`,
      );
    }
  }
}

async function seed() {
  warnIfCategoryUnknown();

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!ADMIN_EMAIL || !adminPassword) {
    throw new Error(
      'ADMIN_EMAIL and ADMIN_PASSWORD env vars must both be set. Run this as:\n' +
        '  ADMIN_EMAIL=<the admin account\'s email> ADMIN_PASSWORD=<the admin account\'s password> npx tsx scripts/seed-curated-attractions.ts',
    );
  }

  console.log(`Signing in as ${ADMIN_EMAIL}...`);
  await signInWithEmailAndPassword(auth, ADMIN_EMAIL, adminPassword);

  console.log(`Seeding ${SEED_ATTRACTIONS.length} curated attractions...`);
  for (const attraction of SEED_ATTRACTIONS) {
    const docRef = await addDoc(collection(db, 'curatedAttractions'), {
      name: attraction.name,
      city: attraction.city,
      province: attraction.province,
      description: attraction.description,
      category: attraction.category,
      lat: attraction.lat,
      lng: attraction.lng,
      createdAt: serverTimestamp(),
    });
    console.log(`  + [${attraction.city}] ${attraction.name} (${docRef.id})`);
  }
  console.log('Done.');
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
