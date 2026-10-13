import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';

import { auth, db } from '@/lib/firebase';

export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let unsubscribeSnapshot: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeSnapshot?.();

      if (!user) {
        setIsAdmin(false);
        return;
      }

      unsubscribeSnapshot = onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
        setIsAdmin(snapshot.data()?.role === 'admin');
      });
    });

    return () => {
      unsubscribeSnapshot?.();
      unsubscribeAuth();
    };
  }, []);

  return isAdmin;
}
