import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  Image,
  ActivityIndicator,
  Dimensions,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import MapView, { Callout, Marker } from 'react-native-maps';
import { Gallery, fitContainer, useImageResolution } from 'react-native-zoom-toolkit';

import { Colors, Fonts, Categories, markColorOn } from '@/constants/theme';
import { db } from '@/lib/firebase';
import { CompassEmblem } from '@/components/compass-emblem';
import { CornerBrackets, DiagonalTexture } from '@/components/map-frame-accents';
import { PlaceTasks } from '@/components/place-tasks';

// Curated attractions currently span southern/eastern Ontario (Toronto to
// Ottawa to Algonquin Park) — wide enough that the GTA-focused region used
// on the main Map screen would clip half the pins.
const CANADA_EXPLORE_REGION = {
  latitude: 44.5,
  longitude: -78.5,
  latitudeDelta: 5,
  longitudeDelta: 6,
};

const CAROUSEL_HEIGHT = 200;

// Shared between the detail popup's styles and the carousel's initial width
// estimate, so a change to one can't silently desync the other.
const DETAIL_OVERLAY_PADDING = 24;
const DETAIL_CARD_MAX_WIDTH = 420;

type CategoryFilter = keyof typeof Categories | 'all';

const CATEGORY_FILTERS: { key: CategoryFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...(Object.entries(Categories) as [keyof typeof Categories, { label: string }][]).map(
    ([key, meta]) => ({ key, label: meta.label }),
  ),
];

// Shared phrasing for the filter-count line and the map badge — only
// mentions "spot(s)" as a noun when a category adjective needs one to
// attach to (e.g. "nature spots"); a city-only filter reads as "12 in
// Toronto" rather than the redundant "12 spots in Toronto".
function buildCountLabel(count: number, categoryLabel: string | null, city: string | null): string {
  const parts: string[] = [String(count)];
  if (categoryLabel) {
    parts.push(`${categoryLabel.toLowerCase()} spot${count === 1 ? '' : 's'}`);
  } else if (!city) {
    parts.push(`curated spot${count === 1 ? '' : 's'}`);
  }
  if (city) {
    parts.push(`in ${city}`);
  }
  return parts.join(' ');
}

interface CuratedAttraction {
  id: string;
  name: string;
  city: string;
  province: string;
  category: string;
  description: string;
  lat: number;
  lng: number;
  photoURLs: string[];
}

type PhotoStatus = 'loading' | 'loaded' | 'error';

function PhotoCarousel({
  photoURLs,
  placeholderColor,
  onPhotoPress,
}: {
  photoURLs: string[];
  placeholderColor: string;
  onPhotoPress?: (index: number) => void;
}) {
  // Starting at 0 laid every photo out zero-wide on the first render, so the
  // pages had no width to snap between. Seed it with the width the card will
  // actually get, then let onLayout correct it.
  const [width, setWidth] = useState(() =>
    Math.min(
      Dimensions.get('window').width - DETAIL_OVERLAY_PADDING * 2,
      DETAIL_CARD_MAX_WIDTH,
    ),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [photoStatus, setPhotoStatus] = useState<Record<number, PhotoStatus>>({});

  if (photoURLs.length === 0) {
    return (
      <View style={[styles.carouselPlaceholder, { backgroundColor: placeholderColor }]}>
        <CompassEmblem size={28} strokeColor={markColorOn(placeholderColor)} />
      </View>
    );
  }

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(event) => {
          if (width <= 0) return;
          const index = Math.round(event.nativeEvent.contentOffset.x / width);
          setActiveIndex(Math.max(0, Math.min(index, photoURLs.length - 1)));
        }}>
        {photoURLs.map((uri, index) => {
          const status = photoStatus[index] ?? 'loading';

          if (status === 'error') {
            return (
              <View
                key={uri + index}
                style={[
                  styles.carouselPlaceholder,
                  { width, height: CAROUSEL_HEIGHT, backgroundColor: placeholderColor },
                ]}>
                <CompassEmblem size={28} strokeColor={markColorOn(placeholderColor)} />
              </View>
            );
          }

          return (
            <Pressable
              key={uri + index}
              disabled={status !== 'loaded'}
              onPress={() => onPhotoPress?.(index)}
              style={{ width, height: CAROUSEL_HEIGHT }}>
              <Image
                source={{ uri }}
                style={{ width, height: CAROUSEL_HEIGHT }}
                resizeMode="cover"
                onLoad={() => setPhotoStatus((prev) => ({ ...prev, [index]: 'loaded' }))}
                onError={() => setPhotoStatus((prev) => ({ ...prev, [index]: 'error' }))}
              />
              {status === 'loading' && (
                <View style={[StyleSheet.absoluteFill, styles.carouselLoadingOverlay]}>
                  <ActivityIndicator color={Colors.parchment} />
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      {photoURLs.length > 1 && (
        // pointerEvents="none" so this full-width strip doesn't eat swipes
        // that start low in the photo (same idiom as map-frame-accents.tsx).
        <View pointerEvents="none" style={styles.carouselDots}>
          {photoURLs.map((_, index) => (
            <View
              key={index}
              style={[styles.carouselDot, index === activeIndex && styles.carouselDotActive]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

// Renders a single Gallery slide: fetches the image's natural resolution so
// fitContainer can size it without distortion, since Gallery measures
// whatever we return here to drive its pinch-zoom bounds.
//
// Sized against useWindowDimensions rather than a local onLayout: the View
// Gallery mounts renderItem's output into only sets a transform (no
// width/height/flex — see GalleryItem's childStyle), so it has no definite
// size of its own. A width:'100%'/height:'100%' child here has nothing to
// resolve against and collapses to its own content's intrinsic size instead
// of the actual screen, which is what made photos render tiny.
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

export default function ExploreCanadaScreen() {
  const [attractions, setAttractions] = useState<CuratedAttraction[]>([]);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [activeCity, setActiveCity] = useState<string>('all');
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>('all');
  const [selectedAttraction, setSelectedAttraction] = useState<CuratedAttraction | null>(null);
  const [viewerPhotos, setViewerPhotos] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerPlaceholderColor, setViewerPlaceholderColor] = useState(Colors.ink);

  const openViewer = (photos: string[], index: number, placeholderColor: string) => {
    setViewerPhotos(photos);
    setViewerIndex(index);
    setViewerPlaceholderColor(placeholderColor);
    setViewerVisible(true);
  };

  useEffect(() => {
    const attractionsQuery = query(collection(db, 'curatedAttractions'), orderBy('name'));

    return onSnapshot(attractionsQuery, (snapshot) => {
      setAttractions(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            name: data.name as string,
            city: data.city as string,
            province: data.province as string,
            category: (data.category as string | undefined) ?? '',
            description: (data.description as string | undefined) ?? '',
            lat: data.lat as number,
            lng: data.lng as number,
            photoURLs: (data.photoURLs as string[] | undefined) ?? [],
          };
        }),
      );
    });
  }, []);

  const cityFilters = useMemo(() => {
    const uniqueCities = Array.from(new Set(attractions.map((attraction) => attraction.city))).sort(
      (a, b) => a.localeCompare(b),
    );
    return ['all', ...uniqueCities];
  }, [attractions]);

  const filteredAttractions = attractions.filter((attraction) => {
    const matchesCity = activeCity === 'all' || attraction.city === activeCity;
    const matchesCategory = activeCategory === 'all' || attraction.category === activeCategory;
    return matchesCity && matchesCategory;
  });

  const activeCategoryLabel = activeCategory === 'all' ? null : Categories[activeCategory].label;
  const activeCityLabel = activeCity === 'all' ? null : activeCity;
  const countLabel = buildCountLabel(filteredAttractions.length, activeCategoryLabel, activeCityLabel);

  const renderMarkers = () =>
    filteredAttractions.map((attraction) => {
      const categoryMeta = Categories[attraction.category as keyof typeof Categories];
      return (
        <Marker
          key={attraction.id}
          coordinate={{ latitude: attraction.lat, longitude: attraction.lng }}
          pinColor={categoryMeta?.color ?? Colors.ink}>
          <Callout>
            <View style={styles.calloutBox}>
              <Text style={styles.calloutTitle}>{attraction.name}</Text>
              <Text style={styles.calloutMeta}>
                {attraction.city}, {attraction.province}
              </Text>
              {categoryMeta && <Text style={styles.calloutCategory}>{categoryMeta.label}</Text>}
            </View>
          </Callout>
        </Marker>
      );
    });

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={18} color={Colors.parchment} />
          </Pressable>
          <View style={styles.titleRow}>
            <CompassEmblem size={26} strokeColor={Colors.parchment} fillColor={Colors.gold} />
            <Text style={styles.title}>Explore Canada</Text>
          </View>
          <View style={styles.headerSpacer} />
        </View>
        <Text style={styles.subtitle}>Admin-curated stops worth the trip</Text>

        {/* City filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {cityFilters.map((city) => {
            const active = city === activeCity;
            return (
              <Pressable
                key={city}
                onPress={() => setActiveCity(city)}
                style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {city === 'all' ? 'All' : city}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Category filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          {CATEGORY_FILTERS.map((filter) => {
            const active = filter.key === activeCategory;
            return (
              <Pressable
                key={filter.key}
                onPress={() => setActiveCategory(filter.key)}
                style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {(activeCity !== 'all' || activeCategory !== 'all') && filteredAttractions.length > 0 && (
          <Text style={styles.filterCountText}>{countLabel}</Text>
        )}

        {/* Map */}
        <Pressable style={styles.mapCard} onPress={() => setMapFullscreen(true)}>
          <MapView style={styles.map} initialRegion={CANADA_EXPLORE_REGION}>
            {renderMarkers()}
          </MapView>
          <DiagonalTexture />
          <CornerBrackets />
          <View style={styles.mapBadge}>
            <Text style={styles.mapBadgeText}>{countLabel}</Text>
          </View>
        </Pressable>

        {/* Attraction list */}
        <Text style={styles.sectionTitle}>Curated attractions</Text>
        {filteredAttractions.length === 0 ? (
          <Text style={styles.emptyText}>No curated attractions here yet.</Text>
        ) : (
          filteredAttractions.map((attraction) => {
            const categoryMeta = Categories[attraction.category as keyof typeof Categories];
            return (
              <Pressable
                key={attraction.id}
                style={styles.card}
                onPress={() => setSelectedAttraction(attraction)}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.attractionName}>{attraction.name}</Text>
                  {categoryMeta && (
                    <View style={[styles.categoryBadge, { backgroundColor: categoryMeta.color }]}>
                      <Text style={styles.categoryBadgeText}>{categoryMeta.label}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.locationText}>
                  {attraction.city}, {attraction.province}
                </Text>
                {attraction.description ? (
                  <Text style={styles.descriptionText} numberOfLines={3}>
                    {attraction.description}
                  </Text>
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <Modal
        visible={mapFullscreen}
        animationType="slide"
        onRequestClose={() => setMapFullscreen(false)}>
        <View style={styles.fullscreenMapContainer}>
          <MapView style={styles.fullscreenMap} initialRegion={CANADA_EXPLORE_REGION}>
            {renderMarkers()}
          </MapView>
          <Pressable style={styles.closeButton} onPress={() => setMapFullscreen(false)}>
            <Ionicons name="close" size={22} color={Colors.parchment} />
          </Pressable>
        </View>
      </Modal>

      {/* Attraction detail popup */}
      <Modal
        // !viewerVisible: two RN Modals open at once fails silently on iOS,
        // so this must close while the fullscreen photo viewer is open.
        visible={selectedAttraction !== null && !viewerVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setSelectedAttraction(null)}>
        {/* The dismiss-on-tap layer is a sibling BEHIND the card, not a
            wrapper around it. Wrapping the card in a Pressable made that
            Pressable win the touch responder on every gesture, so the
            horizontal carousel inside it could never claim a swipe. */}
        <View style={styles.detailOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setSelectedAttraction(null)}
          />
          <View style={styles.detailCard}>
            <Pressable
              style={styles.detailCloseButton}
              onPress={() => setSelectedAttraction(null)}>
              <Ionicons name="close" size={18} color={Colors.parchment} />
            </Pressable>

            {selectedAttraction && (
              <ScrollView key={selectedAttraction.id} showsVerticalScrollIndicator={false}>
                <PhotoCarousel
                  photoURLs={selectedAttraction.photoURLs}
                  placeholderColor={
                    Categories[selectedAttraction.category as keyof typeof Categories]?.color ??
                    Colors.ink
                  }
                  onPhotoPress={(index) =>
                    openViewer(
                      selectedAttraction.photoURLs,
                      index,
                      Categories[selectedAttraction.category as keyof typeof Categories]?.color ??
                        Colors.ink,
                    )
                  }
                />

                <View style={styles.detailBody}>
                  <View style={styles.detailTopRow}>
                    <Text style={styles.detailName}>{selectedAttraction.name}</Text>
                    {Categories[selectedAttraction.category as keyof typeof Categories] && (
                      <View
                        style={[
                          styles.categoryBadge,
                          {
                            backgroundColor:
                              Categories[selectedAttraction.category as keyof typeof Categories]
                                .color,
                          },
                        ]}>
                        <Text style={styles.categoryBadgeText}>
                          {Categories[selectedAttraction.category as keyof typeof Categories].label}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.detailLocation}>
                    {selectedAttraction.city}, {selectedAttraction.province}
                  </Text>
                  {selectedAttraction.description ? (
                    <Text style={styles.detailDescription}>{selectedAttraction.description}</Text>
                  ) : null}

                  <PlaceTasks placeId={selectedAttraction.id} />

                  {/* Reserved for future user-submitted places tied to this location. */}
                  <View style={styles.communitySection}>
                    <Text style={styles.communityTitle}>From the community</Text>
                    <View style={styles.communityPlaceholder}>
                      <Ionicons name="people-outline" size={22} color={Colors.tan} />
                      <Text style={styles.communityPlaceholderText}>
                        Coming soon — visitor photos and notes for this spot will show up here.
                      </Text>
                    </View>
                  </View>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

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
    backgroundColor: Colors.pine,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(239,230,208,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(239,230,208,0.35)',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: {
    fontFamily: Fonts.display,
    fontSize: 19,
    color: Colors.parchment,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  headerSpacer: { width: 34 },
  subtitle: {
    fontFamily: Fonts.secondaryItalic,
    fontSize: 14,
    color: Colors.parchment,
    backgroundColor: Colors.pine,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  chipRow: { paddingLeft: 20, paddingTop: 14, marginBottom: 14 },
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
    marginTop: 2,
    height: 200,
    borderRadius: 20,
    backgroundColor: Colors.parchment2,
    overflow: 'hidden',
  },
  map: { width: '100%', height: '100%' },
  calloutBox: { minWidth: 130, padding: 2 },
  calloutTitle: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  calloutMeta: { fontFamily: Fonts.body, fontSize: 11, color: Colors.ink, marginTop: 2 },
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
  sectionTitle: {
    fontFamily: Fonts.display,
    fontSize: 17,
    color: Colors.ink,
    marginHorizontal: 20,
    marginTop: 22,
    marginBottom: 12,
  },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.tan,
    marginHorizontal: 20,
  },
  card: {
    marginHorizontal: 20,
    marginBottom: 14,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: 16,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  attractionName: { fontFamily: Fonts.display, fontSize: 16, color: Colors.ink, flexShrink: 1 },
  categoryBadge: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 20 },
  categoryBadgeText: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: Colors.parchment,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  locationText: {
    fontFamily: Fonts.mono,
    fontSize: 10.5,
    color: Colors.tan,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  descriptionText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.ink,
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
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(46,40,18,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: DETAIL_OVERLAY_PADDING,
  },
  detailCard: {
    width: '100%',
    maxWidth: DETAIL_CARD_MAX_WIDTH,
    maxHeight: '85%',
    backgroundColor: '#fff',
    borderRadius: 22,
    overflow: 'hidden',
  },
  detailCloseButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 2,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(46,40,18,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  carouselPlaceholder: {
    height: CAROUSEL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carouselLoadingOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(46,40,18,0.25)',
  },
  carouselDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
  },
  carouselDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  carouselDotActive: { backgroundColor: '#fff', width: 8, height: 8, borderRadius: 4 },
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
  detailBody: { padding: 18 },
  detailTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  detailName: { fontFamily: Fonts.display, fontSize: 19, color: Colors.ink, flexShrink: 1 },
  detailLocation: {
    fontFamily: Fonts.mono,
    fontSize: 10.5,
    color: Colors.tan,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  detailDescription: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: Colors.ink,
  },
  communitySection: { marginTop: 22 },
  communityTitle: { fontFamily: Fonts.display, fontSize: 15, color: Colors.ink, marginBottom: 10 },
  communityPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.parchment2,
    borderRadius: 16,
    borderWidth: 1.3,
    borderColor: Colors.tan,
    borderStyle: 'dashed',
    padding: 14,
  },
  communityPlaceholderText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.tan,
    lineHeight: 17,
  },
});
