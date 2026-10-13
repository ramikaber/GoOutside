import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

// Matches storageBucket in src/lib/firebase.ts — this project's bucket uses
// the newer *.firebasestorage.app domain, not the legacy *.appspot.com one,
// so it has to be passed explicitly rather than relying on the SDK default.
initializeApp({ storageBucket: 'gooutside-d5f54.firebasestorage.app' });

// Firebase Storage download URLs encode the object path as the segment
// between "/o/" and the query string, URL-encoded
// (e.g. ".../o/places%2Fabc123%2F1700000000000-0.jpg?alt=media&token=...").
function extractStoragePath(url: string): string | null {
  try {
    const { pathname } = new URL(url);
    const marker = '/o/';
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex === -1) return null;
    return decodeURIComponent(pathname.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
}

// Safety net for src/app/admin.tsx's client-side photo cleanup on delete —
// this runs regardless of how the places/{placeId} document was deleted
// (app, console, script, anything), since it's a server-side Firestore
// trigger rather than app code that can be bypassed.
export const cleanupDeletedPlacePhotos = onDocumentDeleted('places/{placeId}', async (event) => {
  const { placeId } = event.params;
  const deletedData = event.data?.data();
  const photoURLs = (deletedData?.photoURLs as string[] | undefined) ?? [];

  if (photoURLs.length === 0) {
    logger.info(`places/${placeId} deleted with no photoURLs — nothing to clean up.`);
    return;
  }

  const bucket = getStorage().bucket();

  await Promise.all(
    photoURLs.map(async (url) => {
      const path = extractStoragePath(url);
      if (!path) {
        logger.warn(`places/${placeId}: couldn't parse a Storage path from "${url}" — skipping.`);
        return;
      }

      try {
        await bucket.file(path).delete();
        logger.info(`places/${placeId}: deleted Storage file "${path}".`);
      } catch (err) {
        const code = (err as { code?: number }).code;
        if (code === 404) {
          logger.info(`places/${placeId}: "${path}" was already gone — nothing to do.`);
          return;
        }
        logger.error(`places/${placeId}: failed to delete "${path}".`, err);
      }
    }),
  );
});
