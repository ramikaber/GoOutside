import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { router } from 'expo-router';

import { auth, db } from '@/lib/firebase';

export interface PlaceTask {
  id: string;
  description: string;
  createdAt: Timestamp | null;
}

export function usePlaceTasks(placeId: string) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [tasks, setTasks] = useState<PlaceTask[]>([]);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<string>>(new Set());

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('placeId', '==', placeId),
      orderBy('createdAt', 'desc'),
    );

    return onSnapshot(tasksQuery, (snapshot) => {
      setTasks(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            description: data.description as string,
            createdAt: (data.createdAt as Timestamp | undefined) ?? null,
          };
        }),
      );
    });
  }, [placeId]);

  // Scoped to the signed-in user's own completions (uid ==), not this
  // place's tasks specifically — a single-field query needs no composite
  // index. Narrowing to this place's tasks happens locally below.
  useEffect(() => {
    if (!user) {
      setCompletedTaskIds(new Set());
      return;
    }

    const completionsQuery = query(collection(db, 'taskCompletions'), where('uid', '==', user.uid));

    return onSnapshot(completionsQuery, (snapshot) => {
      setCompletedTaskIds(new Set(snapshot.docs.map((docSnapshot) => docSnapshot.data().taskId as string)));
    });
  }, [user]);

  const completedCount = tasks.filter((task) => completedTaskIds.has(task.id)).length;

  const toggleTask = async (taskId: string) => {
    if (!user) {
      router.push('/login');
      return;
    }

    const completionRef = doc(db, 'taskCompletions', `${user.uid}_${taskId}`);

    if (completedTaskIds.has(taskId)) {
      await deleteDoc(completionRef);
    } else {
      await setDoc(completionRef, {
        taskId,
        uid: user.uid,
        completedAt: serverTimestamp(),
      });
    }
  };

  return { tasks, completedTaskIds, completedCount, toggleTask };
}
