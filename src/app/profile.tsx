import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { router } from 'expo-router';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { collection, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';

import { Colors, Fonts, Categories, contrastRatio, markColorOn } from '@/constants/theme';
import { auth, db } from '@/lib/firebase';
import { CompassEmblem } from '@/components/compass-emblem';

const STATUS_COLORS: Record<string, string> = {
  pending: Colors.gold,
  approved: Colors.pine,
  rejected: Colors.brown,
};

interface UserPlace {
  id: string;
  name: string;
  category: string;
  status: string;
  createdAt: Timestamp | null;
}

function formatDate(ts: Timestamp | null): string {
  if (!ts) return '—';
  return ts.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatJoinDate(creationTime: string | undefined): string | null {
  if (!creationTime) return null;
  const date = new Date(creationTime);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function ProfileScreen() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [places, setPlaces] = useState<UserPlace[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(true);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) {
      setPlaces([]);
      return;
    }

    setLoadingPlaces(true);
    // No orderBy here on purpose — submittedBy + createdAt would need a composite
    // index, and a single user's own submissions are few enough to sort client-side.
    const ownPlacesQuery = query(collection(db, 'places'), where('submittedBy', '==', user.uid));

    return onSnapshot(ownPlacesQuery, (snapshot) => {
      setPlaces(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            name: (data.name as string | undefined) ?? 'Untitled discovery',
            category: data.category as string,
            status: (data.status as string | undefined) ?? 'pending',
            createdAt: (data.createdAt as Timestamp | undefined) ?? null,
          };
        }),
      );
      setLoadingPlaces(false);
    });
  }, [user]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.replace('/');
    } catch {
      Alert.alert('Something went wrong', 'Please try again.');
    }
  };

  if (!user) {
    return (
      <View style={styles.screen}>
        <View style={styles.loggedOutBox}>
          <CompassEmblem size={44} />
          <Text style={styles.loggedOutText}>Log in to see your passport</Text>
          <Pressable style={styles.loginButton} onPress={() => router.push('/login')}>
            <Text style={styles.loginButtonText}>Log in</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const sortedPlaces = [...places].sort(
    (a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0),
  );
  const approvedPlaces = places.filter((place) => place.status === 'approved');
  const categoryCounts = approvedPlaces.reduce<Record<string, number>>((acc, place) => {
    acc[place.category] = (acc[place.category] ?? 0) + 1;
    return acc;
  }, {});
  const joinDate = formatJoinDate(user.metadata.creationTime);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Header */}
      <View style={styles.header}>
        <CompassEmblem size={44} />
        <Text style={styles.displayName}>{user.displayName || user.email}</Text>
        {joinDate && <Text style={styles.joinDate}>Joined {joinDate}</Text>}
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{places.length}</Text>
          <Text style={styles.statLabel}>Places submitted</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{approvedPlaces.length}</Text>
          <Text style={styles.statLabel}>Places visited</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{approvedPlaces.length}</Text>
          <Text style={styles.statLabel}>Raffle entries</Text>
        </View>
      </View>

      {/* Category badges */}
      {Object.keys(categoryCounts).length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Badges</Text>
          <View style={styles.badgeRow}>
            {Object.entries(categoryCounts).map(([categoryKey, count]) => {
              const categoryMeta = Categories[categoryKey as keyof typeof Categories];
              const badgeColor = categoryMeta?.color ?? Colors.ink;
              return (
                <View key={categoryKey} style={styles.badge}>
                  <View style={[styles.badgeCircle, { borderColor: badgeColor }]}>
                    <CompassEmblem
                      size={22}
                      strokeColor={
                        contrastRatio(badgeColor, Colors.parchment2) >= 3
                          ? badgeColor
                          : markColorOn(Colors.parchment2)
                      }
                    />
                  </View>
                  <Text style={styles.badgeLabel}>
                    {(categoryMeta?.label ?? categoryKey).toUpperCase()} ×{count}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      )}

      {/* Submissions list */}
      <Text style={styles.sectionTitle}>Your submissions</Text>
      {loadingPlaces ? (
        <ActivityIndicator color={Colors.ink} style={styles.loadingIndicator} />
      ) : sortedPlaces.length === 0 ? (
        <Text style={styles.emptyText}>You haven't submitted a place yet.</Text>
      ) : (
        sortedPlaces.map((place) => {
          const categoryMeta = Categories[place.category as keyof typeof Categories];
          return (
            <View key={place.id} style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowName}>{place.name}</Text>
                <Text style={styles.rowMeta}>
                  {categoryMeta?.label ?? place.category} · {formatDate(place.createdAt)}
                </Text>
              </View>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: STATUS_COLORS[place.status] ?? Colors.tan },
                ]}>
                <Text style={styles.statusBadgeText}>{place.status}</Text>
              </View>
            </View>
          );
        })
      )}

      {/* Log out */}
      <Pressable style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutButtonText}>Log out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.parchment },
  container: { flex: 1, backgroundColor: Colors.parchment },
  loggedOutBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 40,
  },
  loggedOutText: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    color: Colors.ink,
    textAlign: 'center',
  },
  loginButton: {
    backgroundColor: Colors.ink,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  loginButtonText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.parchment },
  header: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    gap: 4,
  },
  displayName: {
    fontFamily: Fonts.display,
    fontSize: 20,
    color: Colors.ink,
    marginTop: 10,
  },
  joinDate: {
    fontFamily: Fonts.secondaryItalic,
    fontSize: 14,
    color: Colors.tan,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.parchment2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.line,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statValue: { fontFamily: Fonts.mono, fontSize: 22, color: Colors.ink },
  statLabel: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: Colors.tan,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginTop: 4,
  },
  sectionTitle: {
    fontFamily: Fonts.display,
    fontSize: 17,
    color: Colors.ink,
    marginHorizontal: 20,
    marginTop: 6,
    marginBottom: 12,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: 20,
    marginBottom: 6,
  },
  badge: { alignItems: 'center', width: 82, marginBottom: 14 },
  badgeCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.parchment2,
    marginBottom: 6,
  },
  badgeLabel: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: Colors.ink,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  loadingIndicator: { marginTop: 20 },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.tan,
    marginHorizontal: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.line,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginHorizontal: 20,
    marginBottom: 8,
  },
  rowInfo: { flex: 1 },
  rowName: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  rowMeta: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.tan,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10 },
  statusBadgeText: {
    fontFamily: Fonts.mono,
    fontSize: 9,
    color: Colors.parchment,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  logoutButton: {
    marginHorizontal: 20,
    marginTop: 24,
    backgroundColor: Colors.brown,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  logoutButtonText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.parchment },
});
