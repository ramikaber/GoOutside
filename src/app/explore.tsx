import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  Dimensions,
  Modal,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { Gallery, fitContainer, useImageResolution } from 'react-native-zoom-toolkit';

import { Colors, Fonts, Categories, markColorOn } from '@/constants/theme';
import { db } from '@/lib/firebase';
import { CompassEmblem } from '@/components/compass-emblem';

type CategoryFilter = keyof typeof Categories | 'all';

const CATEGORY_FILTERS: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...(Object.entries(Categories) as [keyof typeof Categories, { label: string }][]).map(
    ([key, meta]) => ({ key, label: meta.label }),
  ),
];

interface DiscoverPlace {
  id: string;
  name: string;
  category: string;
  description: string;
  rating: number | null;
  photoURLs: string[];
  submittedByName: string;
}

const CARD_HORIZONTAL_MARGIN = 20;

const CARD_ENTER_DURATION_MS = 280;
const CARD_STAGGER_MS = 60;
// Cards past this index enter together, so a long list never makes the
// user wait for its tail to appear.
const CARD_STAGGER_MAX_INDEX = 5;

// Fade in while rising 16px, one card after another. Entering animations only
// run on mount, so this plays on first load and for cards a filter change
// brings into the list, not on every re-render.
function cardEntering(index: number) {
  return FadeInUp.duration(CARD_ENTER_DURATION_MS)
    .delay(Math.min(index, CARD_STAGGER_MAX_INDEX) * CARD_STAGGER_MS)
    .withInitialValues({ opacity: 0, transform: [{ translateY: 16 }] });
}

// Renders a single Gallery slide: fetches the image's natural resolution so
// fitContainer can size it without distortion, since Gallery measures
// whatever we return here to drive its pinch-zoom bounds.
//
// Sized against useWindowDimensions rather than a local onLayout: the View
// Gallery mounts renderItem's output into only sets a transform (no
// width/height/flex), so it has no definite size of its own to measure.
function ViewerPhoto({ uri, placeholderColor }: { uri: string; placeholderColor: string }) {
  const { resolution, isFetching, error } = useImageResolution({ uri });
  const { width, height } = useWindowDimensions();

  if (error) {
    return (
      <View style={[styles.viewerPlaceholder, { backgroundColor: placeholderColor }]}>
        <CompassEmblem size={32} strokeColor={markColorOn(placeholderColor)} />
      </View>
    );
  }

  return (
    <View style={styles.viewerPhotoContainer}>
      {isFetching || !resolution ? (
        <ActivityIndicator color={Colors.parchment} />
      ) : (
        <Image
          source={{ uri }}
          style={fitContainer(resolution.width / resolution.height, { width, height })}
          resizeMode="contain"
        />
      )}
    </View>
  );
}

export default function DiscoverScreen() {
  const [places, setPlaces] = useState<DiscoverPlace[]>([]);
  const [activeFilter, setActiveFilter] = useState<CategoryFilter>('all');
  const [viewerPhotos, setViewerPhotos] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerPlaceholderColor, setViewerPlaceholderColor] = useState(Colors.ink);
  const [cardWidth, setCardWidth] = useState(
    () => Dimensions.get('window').width - CARD_HORIZONTAL_MARGIN * 2,
  );

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
            description: (data.description as string | undefined) ?? '',
            rating: (data.rating as number | null | undefined) ?? null,
            photoURLs: (data.photoURLs as string[] | undefined) ?? [],
            submittedByName: (data.submittedByName as string | undefined) ?? 'Unknown',
          };
        }),
      );
    });
  }, []);

  const filteredPlaces =
    activeFilter === 'all' ? places : places.filter((place) => place.category === activeFilter);
  const activeCategoryMeta = activeFilter === 'all' ? null : Categories[activeFilter];

  const openViewer = (photos: string[], index: number, placeholderColor: string) => {
    setViewerPhotos(photos);
    setViewerIndex(index);
    setViewerPlaceholderColor(placeholderColor);
    setViewerVisible(true);
  };

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <CompassEmblem size={30} />
            <Text style={styles.title}>Discover</Text>
          </View>
          <Text style={styles.subtitle}>Curated stops worth the detour</Text>
        </View>

        {/* Category filter */}
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

        {filteredPlaces.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="compass-outline" size={28} color={Colors.tan} />
            <Text style={styles.emptyText}>
              {places.length === 0
                ? 'No discoveries yet — be the first to post one!'
                : 'Nothing in this category yet.'}
            </Text>
          </View>
        ) : (
          filteredPlaces.map((place, index) => {
            const categoryMeta = Categories[place.category as keyof typeof Categories];
            const photoHeight = cardWidth * 0.75;
            return (
              <Animated.View
                key={place.id}
                entering={cardEntering(index)}
                style={styles.card}
                onLayout={(event) => setCardWidth(event.nativeEvent.layout.width)}>
                {place.photoURLs.length > 0 && (
                  <ScrollView
                    horizontal
                    pagingEnabled
                    scrollEnabled={place.photoURLs.length > 1}
                    showsHorizontalScrollIndicator={false}>
                    {place.photoURLs.map((uri, index) => (
                      <Pressable
                        key={uri + index}
                        onPress={() =>
                          openViewer(place.photoURLs, index, categoryMeta?.color ?? Colors.ink)
                        }>
                        <Image
                          source={{ uri }}
                          style={{ width: cardWidth, height: photoHeight }}
                          resizeMode="cover"
                        />
                      </Pressable>
                    ))}
                  </ScrollView>
                )}

                <View style={styles.cardBody}>
                  <View style={styles.cardTopRow}>
                    <Text style={styles.placeName}>{place.name}</Text>
                    <View style={styles.badgeColumn}>
                      <View
                        style={[
                          styles.categoryBadge,
                          { backgroundColor: categoryMeta?.color ?? Colors.ink },
                        ]}>
                        <Text style={styles.categoryBadgeText}>
                          {categoryMeta?.label ?? place.category}
                        </Text>
                      </View>
                      <Text style={styles.postedByText}>Posted by {place.submittedByName}</Text>
                    </View>
                  </View>

                  {place.rating !== null && (
                    <View style={styles.ratingRow}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Ionicons
                          key={star}
                          name={star <= place.rating! ? 'star' : 'star-outline'}
                          size={13}
                          color={Colors.gold}
                        />
                      ))}
                    </View>
                  )}

                  {place.description ? (
                    <Text style={styles.descriptionText} numberOfLines={3}>
                      {place.description}
                    </Text>
                  ) : null}
                </View>
              </Animated.View>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={viewerVisible}
        animationType="fade"
        onRequestClose={() => setViewerVisible(false)}>
        <View style={styles.viewerScreen}>
          {viewerVisible && (
            <Gallery
              data={viewerPhotos}
              initialIndex={viewerIndex}
              keyExtractor={(uri, index) => uri + index}
              renderItem={(uri) => (
                <ViewerPhoto uri={uri} placeholderColor={viewerPlaceholderColor} />
              )}
              onIndexChange={setViewerIndex}
              onTap={() => setViewerVisible(false)}
            />
          )}
          <Pressable style={styles.viewerCloseButton} onPress={() => setViewerVisible(false)}>
            <Ionicons name="close" size={22} color={Colors.parchment} />
          </Pressable>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 14,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: Fonts.display, fontSize: 22, color: Colors.ink },
  subtitle: {
    fontFamily: Fonts.secondaryItalic,
    fontSize: 15,
    color: Colors.tan,
    marginTop: 4,
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
    marginBottom: 14,
  },
  emptyState: {
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 20,
    padding: 24,
    backgroundColor: Colors.parchment2,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.tan,
    textAlign: 'center',
  },
  card: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.line,
    overflow: 'hidden',
  },
  cardBody: { padding: 14 },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  placeName: { fontFamily: Fonts.display, fontSize: 17, color: Colors.ink, flexShrink: 1 },
  badgeColumn: { alignItems: 'flex-end', gap: 5 },
  categoryBadge: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 20 },
  categoryBadgeText: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.parchment,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  postedByText: {
    fontFamily: Fonts.mono,
    fontSize: 9.5,
    color: Colors.tan,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  ratingRow: { flexDirection: 'row', gap: 3, marginBottom: 6 },
  descriptionText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.ink,
  },
  viewerScreen: { flex: 1, backgroundColor: Colors.ink },
  viewerCloseButton: {
    position: 'absolute',
    top: 56,
    right: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(239,230,208,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239,230,208,0.35)',
    zIndex: 2,
  },
  viewerPhotoContainer: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
