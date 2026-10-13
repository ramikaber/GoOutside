import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image, Alert, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import MapView, { Callout, Marker } from 'react-native-maps';

import { Colors, Fonts, Categories, markColorOn } from '@/constants/theme';
import { auth, db } from '@/lib/firebase';
import { CompassEmblem } from '@/components/compass-emblem';
import { CornerBrackets, DiagonalTexture } from '@/components/map-frame-accents';
import { useIsAdmin } from '@/hooks/use-is-admin';

type CategoryFilter = keyof typeof Categories | 'all';

const CATEGORY_FILTERS: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...(Object.entries(Categories) as [keyof typeof Categories, { label: string }][]).map(
    ([key, meta]) => ({ key, label: meta.label }),
  ),
];

// Roughly the GTA — a sensible Canada-first default for browsing, not the user's exact location.
const ONTARIO_REGION = {
  latitude: 43.7,
  longitude: -79.4,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

interface ApprovedPlace {
  id: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  photoURLs: string[];
}

function showAlertAsync(title: string, message: string): Promise<void> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [{ text: 'OK', onPress: () => resolve() }]);
  });
}

export default function MapScreen() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [places, setPlaces] = useState<ApprovedPlace[]>([]);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<CategoryFilter>('all');

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  const isAdmin = useIsAdmin();

  useEffect(() => {
    const approvedQuery = query(
      collection(db, 'places'),
      where('status', '==', 'approved'),
      orderBy('createdAt', 'desc'),
    );

    return onSnapshot(approvedQuery, (snapshot) => {
      setPlaces(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            name: data.name as string,
            category: data.category as string,
            lat: data.lat as number,
            lng: data.lng as number,
            photoURLs: (data.photoURLs as string[] | undefined) ?? [],
          };
        }),
      );
    });
  }, []);

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    (async () => {
      // `notified` is only ever set to false when admin.tsx moves a place out of
      // "pending", so filtering on it alone already excludes still-pending places
      // without needing a separate (and index-hungry) status != "pending" clause.
      const unnotifiedQuery = query(
        collection(db, 'places'),
        where('submittedBy', '==', currentUser.uid),
        where('notified', '==', false),
      );

      const snapshot = await getDocs(unnotifiedQuery);
      for (const docSnapshot of snapshot.docs) {
        const data = docSnapshot.data();
        const status = data.status as string;
        if (status !== 'approved' && status !== 'rejected') continue;

        const name = (data.name as string | undefined) ?? 'Your discovery';
        if (status === 'approved') {
          await showAlertAsync(
            'Submission accepted!',
            `${name} was approved and is now live on the map.`,
          );
        } else {
          await showAlertAsync('Submission not accepted', `${name} wasn't approved this time.`);
        }

        await updateDoc(doc(db, 'places', docSnapshot.id), { notified: true });
      }
    })();
  }, []);

  const filteredPlaces =
    activeFilter === 'all' ? places : places.filter((place) => place.category === activeFilter);
  const activeCategoryMeta = activeFilter === 'all' ? null : Categories[activeFilter];

  const renderMarkers = () =>
    filteredPlaces.map((place) => {
      const categoryMeta = Categories[place.category as keyof typeof Categories];
      return (
        <Marker
          key={place.id}
          coordinate={{ latitude: place.lat, longitude: place.lng }}
          pinColor={categoryMeta?.color ?? Colors.ink}>
          <Callout>
            <View style={styles.calloutBox}>
              <Text style={styles.calloutTitle}>{place.name}</Text>
              <Text style={styles.calloutCategory}>
                {categoryMeta?.label ?? place.category}
              </Text>
            </View>
          </Callout>
        </Marker>
      );
    });

  const handlePostPress = () => {
    if (auth.currentUser) {
      router.push('/post');
    } else {
      router.push({ pathname: '/login', params: { redirect: 'post' } });
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.wordmarkRow}>
            <CompassEmblem size={36} />
            <Text style={styles.wordmark}>GoOutside</Text>
          </View>
          {user ? (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(user.email ?? '??').slice(0, 2).toUpperCase()}
              </Text>
            </View>
          ) : (
            <Pressable onPress={() => router.push('/login')}>
              <Text style={styles.loginLink}>Log in</Text>
            </Pressable>
          )}
        </View>

        {isAdmin && (
          <Pressable style={styles.adminLinkRow} onPress={() => router.push('/admin')}>
            <Text style={styles.adminLinkText}>Admin queue</Text>
          </Pressable>
        )}

        {/* Explore Canada banner */}
        <Pressable style={styles.exploreCanadaBanner} onPress={() => router.push('/explore-canada')}>
          <CompassEmblem size={30} strokeColor={Colors.parchment} fillColor={Colors.gold} />
          <View style={styles.exploreCanadaTextGroup}>
            <Text style={styles.exploreCanadaTitle}>Explore Canada</Text>
            <Text style={styles.exploreCanadaSubtitle}>Admin-curated stops worth the trip</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.parchment} />
        </Pressable>

        {/* Category chips */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {CATEGORY_FILTERS.map((filter) => {
            const active = filter.key === activeFilter;
            return (
              <Pressable
                key={filter.key}
                onPress={() => setActiveFilter(filter.key)}
                style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {activeCategoryMeta && filteredPlaces.length > 0 && (
          <Text style={styles.filterCountText}>
            {filteredPlaces.length} {activeCategoryMeta.label.toLowerCase()} spot
            {filteredPlaces.length === 1 ? '' : 's'} found
          </Text>
        )}

        {/* Map */}
        <Pressable style={styles.mapCard} onPress={() => setMapFullscreen(true)}>
          <MapView style={styles.map} initialRegion={ONTARIO_REGION}>
            {renderMarkers()}
          </MapView>
          <DiagonalTexture />
          <CornerBrackets />
          <View style={styles.mapBadge}>
            <Text style={styles.mapBadgeText}>{filteredPlaces.length} spots near you</Text>
          </View>
        </Pressable>

        {/* Raffle strip */}
        <View style={styles.raffle}>
          <View style={styles.raffleIcon} />
          <View style={{ flex: 1 }}>
            <Text style={styles.raffleTitle}>Annual raffle · 3 tickets, anywhere</Text>
            <Text style={styles.raffleSub}>Every visit posted this year is an entry</Text>
          </View>
          <Text style={styles.raffleCount}>×7</Text>
        </View>

        {/* Recently discovered */}
        <Text style={styles.sectionTitle}>Recently discovered</Text>
        {filteredPlaces.length === 0 ? (
          <Text style={styles.emptyDiscoveredText}>
            {places.length === 0
              ? 'No discoveries yet — be the first to post one!'
              : 'Nothing in this category yet.'}
          </Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.cardRow}>
            {filteredPlaces.map((place) => {
              const categoryMeta = Categories[place.category as keyof typeof Categories];
              return (
                <View key={place.id} style={styles.placeCard}>
                  <View>
                    {place.photoURLs[0] ? (
                      <Image source={{ uri: place.photoURLs[0] }} style={styles.placePhoto} />
                    ) : (
                      <View
                        style={[
                          styles.placePhoto,
                          { backgroundColor: categoryMeta?.color ?? Colors.ink },
                        ]}
                      />
                    )}
                    <View style={styles.placePhotoEmblem}>
                      <CompassEmblem
                        size={22}
                        strokeColor={
                          place.photoURLs[0]
                            ? Colors.parchment
                            : markColorOn(categoryMeta?.color ?? Colors.ink)
                        }
                      />
                    </View>
                  </View>
                  <View style={styles.placeBody}>
                    <Text style={styles.placeName}>{place.name}</Text>
                    <Text style={styles.placeMeta}>{categoryMeta?.label ?? place.category}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </ScrollView>

      <Pressable style={styles.fab} onPress={handlePostPress}>
        <Ionicons name="add" size={26} color="#fff" />
      </Pressable>

      <Modal
        visible={mapFullscreen}
        animationType="slide"
        onRequestClose={() => setMapFullscreen(false)}>
        <View style={styles.fullscreenMapContainer}>
          <MapView style={styles.fullscreenMap} initialRegion={ONTARIO_REGION}>
            {renderMarkers()}
          </MapView>
          <Pressable style={styles.closeButton} onPress={() => setMapFullscreen(false)}>
            <Ionicons name="close" size={22} color={Colors.parchment} />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.parchment },
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 14,
  },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmark: {
    fontFamily: Fonts.display,
    fontSize: 19,
    color: Colors.ink,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.parchment2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.line,
  },
  avatarText: { fontFamily: Fonts.mono, fontSize: 11, color: Colors.ink },
  loginLink: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  adminLinkRow: { paddingHorizontal: 20, marginBottom: 10 },
  adminLinkText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 11.5,
    color: Colors.tan,
    textDecorationLine: 'underline',
  },
  exploreCanadaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: Colors.pine,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  exploreCanadaTextGroup: { flex: 1 },
  exploreCanadaTitle: {
    fontFamily: Fonts.display,
    fontSize: 16,
    color: Colors.parchment,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  exploreCanadaSubtitle: {
    fontFamily: Fonts.secondaryItalic,
    fontSize: 13,
    color: 'rgba(239,230,208,0.75)',
    marginTop: 2,
  },
  chipRow: { paddingLeft: 20, marginBottom: 14 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 20,
    borderWidth: 1.3,
    borderColor: Colors.tan,
    borderStyle: 'dashed',
    marginRight: 8,
  },
  chipActive: { backgroundColor: Colors.pine, borderColor: Colors.pine, borderStyle: 'solid' },
  chipText: { fontFamily: Fonts.bodyMedium, fontSize: 12.5, color: Colors.ink },
  chipTextActive: { color: Colors.parchment },
  filterCountText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.tan,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  mapCard: {
    marginHorizontal: 20,
    height: 200,
    borderRadius: 20,
    backgroundColor: Colors.parchment2,
    overflow: 'hidden',
  },
  map: { width: '100%', height: '100%' },
  calloutBox: { minWidth: 120, padding: 2 },
  calloutTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  calloutCategory: {
    fontFamily: Fonts.mono,
    fontSize: 10.5,
    color: Colors.tan,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  mapBadge: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: Colors.ink,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  mapBadgeText: {
    fontFamily: Fonts.mono,
    fontSize: 10.5,
    color: Colors.parchment,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  raffle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: Colors.ink,
    borderRadius: 16,
    padding: 14,
  },
  raffleIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    borderStyle: 'dashed',
  },
  raffleTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 12.5, color: Colors.parchment },
  raffleSub: { fontFamily: Fonts.body, fontSize: 11, color: 'rgba(239,230,208,0.65)', marginTop: 2 },
  raffleCount: {
    fontFamily: Fonts.mono,
    fontSize: 13,
    color: Colors.gold,
    letterSpacing: 1,
  },
  sectionTitle: {
    fontFamily: Fonts.display,
    fontSize: 17,
    color: Colors.ink,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 10,
  },
  emptyDiscoveredText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.tan,
    marginHorizontal: 20,
  },
  cardRow: { paddingLeft: 20 },
  placeCard: {
    width: 150,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.line,
    overflow: 'hidden',
    marginRight: 12,
  },
  placePhoto: { height: 96 },
  placePhotoEmblem: { position: 'absolute', top: 8, left: 8 },
  placeBody: { padding: 11 },
  placeName: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink, marginBottom: 2 },
  placeMeta: {
    fontFamily: Fonts.mono,
    fontSize: 10.5,
    color: Colors.tan,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.brown,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
  fullscreenMapContainer: { flex: 1, backgroundColor: Colors.parchment },
  fullscreenMap: { width: '100%', height: '100%' },
  closeButton: {
    position: 'absolute',
    top: 56,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
});
