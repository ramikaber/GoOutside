import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Image,
  TextInput,
  Modal,
  Keyboard,
  Platform,
  type KeyboardEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import MapView, { Marker, type LatLng, type MapPressEvent, type MarkerDragStartEndEvent } from 'react-native-maps';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { FirebaseError } from 'firebase/app';
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { Colors, Fonts, Categories } from '@/constants/theme';
import { auth, db, storage } from '@/lib/firebase';
import { CornerBrackets, DiagonalTexture } from '@/components/map-frame-accents';
import { ScalePressable } from '@/components/scale-pressable';

const CATEGORY_KEYS = ['hiddenGem', 'nature', 'food', 'art'] as const;

// Fallback center (Toronto) used when location permission is denied or unavailable.
const DEFAULT_MAP_COORDS: LatLng = { latitude: 43.6532, longitude: -79.3832 };

const MAX_PHOTOS = 10;

// The wizard content rises this far (and fades in) as the modal opens. The
// native sheet already slides up, so this is a short lift layered on top of
// it rather than a second full-height slide.
const ENTRANCE_OFFSET = 60;

// Settles in roughly 350ms with no visible bounce.
const ENTRANCE_SPRING = { stiffness: 260, damping: 26, mass: 1 };

// Space left between a focused input and the top of the keyboard on Android.
const KEYBOARD_INPUT_GAP = 16;

const STEP_TITLES = ['Photos', 'Name & location', 'Description & rating'] as const;
const STEP_SHORT_LABELS = ['Photos', 'Place', 'Details'] as const;
const LAST_STEP = STEP_TITLES.length - 1;

function formatCoord(value: number, positiveLabel: string, negativeLabel: string): string {
  return `${Math.abs(value).toFixed(5)}° ${value >= 0 ? positiveLabel : negativeLabel}`;
}

const ERROR_MESSAGES: Record<string, string> = {
  'permission-denied': 'You don’t have permission to submit right now.',
  unavailable: 'Can’t reach the server. Check your connection and try again.',
  'storage/unauthorized': 'You don’t have permission to upload photos.',
  'storage/canceled': 'Photo upload was canceled.',
};

function getErrorMessage(err: unknown): string {
  if (err instanceof FirebaseError) {
    return ERROR_MESSAGES[err.code] ?? 'Something went wrong. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

export default function PostPlaceScreen() {
  const [selected, setSelected] = useState<(typeof CATEGORY_KEYS)[number]>('hiddenGem');
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [placeName, setPlaceName] = useState('');
  const [markerCoords, setMarkerCoords] = useState<LatLng>(DEFAULT_MAP_COORDS);
  const [locationReady, setLocationReady] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [modalVisible, setModalVisible] = useState(false);
  const markerMovedRef = useRef(false);
  const mapRef = useRef<MapView>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const keyboardTopRef = useRef<number | null>(null);
  const [androidKeyboardPad, setAndroidKeyboardPad] = useState(0);
  const entrance = useSharedValue(0);

  // Runs on every open, not just mount, since the modal is re-shown each time
  // the route regains focus. Reset to 0 on close so the next open starts low.
  useEffect(() => {
    entrance.value = modalVisible ? withSpring(1, ENTRANCE_SPRING) : 0;
  }, [modalVisible, entrance]);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const position = await Location.getCurrentPositionAsync({});
          if (!markerMovedRef.current) {
            setMarkerCoords({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          }
        }
      } catch {
        // Keep the Toronto fallback already set.
      } finally {
        setLocationReady(true);
      }
    })();
  }, []);

  // iOS handles the focused input natively via automaticallyAdjustKeyboardInsets on
  // the step ScrollView. Android has no equivalent here: inside the full-screen
  // modal the window doesn't resize for the keyboard, so the scroll view never
  // learns it is covered. Pad the scroll content by however much the keyboard
  // overlaps it, then scroll the focused input up above the keyboard.
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const showSub = Keyboard.addListener('keyboardDidShow', (event: KeyboardEvent) => {
      const keyboardTop = event.endCoordinates.screenY;
      keyboardTopRef.current = keyboardTop;
      scrollRef.current?.getNativeScrollRef()?.measureInWindow((_x, y, _width, height) => {
        setAndroidKeyboardPad(Math.max(y + height - keyboardTop, 0));
        // Give the extra padding a moment to lay out so there's room to scroll into.
        setTimeout(scrollFocusedInputIntoView, 50);
      });
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTopRef.current = null;
      setAndroidKeyboardPad(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const scrollFocusedInputIntoView = () => {
    const keyboardTop = keyboardTopRef.current;
    const input = TextInput.State.currentlyFocusedInput();
    if (keyboardTop === null || !input) return;

    input.measureInWindow((_x, y, _width, height) => {
      const overlap = y + height + KEYBOARD_INPUT_GAP - keyboardTop;
      if (overlap > 0) {
        scrollRef.current?.scrollTo({ y: scrollYRef.current + overlap, animated: true });
      }
    });
  };

  // Switching fields while the keyboard is already open doesn't fire keyboardDidShow again.
  const handleInputFocus = () => {
    if (Platform.OS === 'android') setTimeout(scrollFocusedInputIntoView, 50);
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
  };

  // The screen stays mounted in memory when the user backs out (React Navigation
  // keeps it alive), so a mount-only reset isn't enough — reset every time the
  // route regains focus (e.g. tapping "+" again) so the form always starts blank.
  useFocusEffect(
    useCallback(() => {
      setSelected('hiddenGem');
      setPhotoUris([]);
      setPhotoNote(null);
      setDescription('');
      setRating(null);
      setPlaceName('');
      setMarkerCoords(DEFAULT_MAP_COORDS);
      setSearchText('');
      setSearchNote(null);
      setError(null);
      setStep(0);
      markerMovedRef.current = false;
      // Tab screens stay mounted after navigating away, so the modal has to be
      // tied to focus — otherwise it would stay presented over the next screen.
      setModalVisible(true);
      return () => setModalVisible(false);
    }, []),
  );

  const handleMapPress = (event: MapPressEvent) => {
    markerMovedRef.current = true;
    setMarkerCoords(event.nativeEvent.coordinate);
  };

  const handleMarkerDragEnd = (event: MarkerDragStartEndEvent) => {
    markerMovedRef.current = true;
    setMarkerCoords(event.nativeEvent.coordinate);
  };

  const handleSearch = async () => {
    const searchQuery = searchText.trim();
    if (!searchQuery) return;

    setSearchNote(null);
    try {
      const results = await Location.geocodeAsync(searchQuery);
      if (results.length === 0) {
        setSearchNote(
          "Couldn't find that — drop a pin on the map instead and give it a name above",
        );
        return;
      }

      const { latitude, longitude } = results[0];
      markerMovedRef.current = true;
      setMarkerCoords({ latitude, longitude });
      mapRef.current?.animateToRegion(
        { latitude, longitude, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        500,
      );
    } catch {
      setSearchNote(
        "Couldn't find that — drop a pin on the map instead and give it a name above",
      );
    }
  };

  const addPhotos = (uris: string[]) => {
    const remaining = MAX_PHOTOS - photoUris.length;
    const toAdd = uris.slice(0, remaining);
    if (toAdd.length < uris.length) {
      setPhotoNote(`Only added ${toAdd.length} — ${MAX_PHOTOS} photo max`);
    }
    if (toAdd.length > 0) {
      setPhotoUris((prev) => [...prev, ...toAdd]);
    }
  };

  const handleTakePhoto = async () => {
    setPhotoNote(null);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setPhotoNote('Photo access is needed to post a place. Enable camera access in your device settings.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.7 });
    if (!result.canceled && result.assets.length > 0) {
      addPhotos(result.assets.map((asset) => asset.uri));
    }
  };

  const handlePickFromLibrary = async () => {
    setPhotoNote(null);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setPhotoNote('Photo library access is needed to add photos. Enable it in your device settings.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      quality: 0.7,
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - photoUris.length,
    });
    if (!result.canceled && result.assets.length > 0) {
      addPhotos(result.assets.map((asset) => asset.uri));
    }
  };

  const handleAddPhoto = () => {
    Alert.alert('Add photo', undefined, [
      { text: 'Take photo', onPress: handleTakePhoto },
      { text: 'Choose from library', onPress: handlePickFromLibrary },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleRemovePhoto = (index: number) => {
    setPhotoUris((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    const user = auth.currentUser;
    if (!user) {
      router.replace('/login');
      return;
    }

    // Steps can be visited in any order, so every required field is checked here.
    const missingPhoto = photoUris.length === 0;
    const missingName = !placeName.trim();
    if (missingPhoto && missingName) {
      setError('Please add at least one photo and enter a place name before submitting');
      return;
    }

    if (missingPhoto) {
      setError('Please add at least one photo before submitting');
      return;
    }

    if (missingName) {
      setError('Please enter a place name before submitting');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const normalizedName = placeName.trim().toLowerCase();
      const ownSubmissionsQuery = query(
        collection(db, 'places'),
        where('submittedBy', '==', user.uid),
      );
      const ownSubmissionsSnapshot = await getDocs(ownSubmissionsQuery);
      const isDuplicate = ownSubmissionsSnapshot.docs.some((docSnapshot) => {
        const existingName = (docSnapshot.data().name as string | undefined) ?? '';
        return existingName.trim().toLowerCase() === normalizedName;
      });
      if (isDuplicate) {
        setError("You've already submitted this place");
        return;
      }

      const [photoURLs, userDocSnapshot] = await Promise.all([
        Promise.all(
          photoUris.map(async (uri, index) => {
            const response = await fetch(uri);
            const blob = await response.blob();
            const photoRef = ref(storage, `places/${user.uid}/${Date.now()}-${index}.jpg`);
            await uploadBytes(photoRef, blob, { contentType: 'image/jpeg' });
            return getDownloadURL(photoRef);
          }),
        ),
        getDoc(doc(db, 'users', user.uid)),
      ]);
      const submittedByName =
        (userDocSnapshot.data()?.displayName as string | undefined) ||
        user.displayName ||
        user.email;

      await addDoc(collection(db, 'places'), {
        name: placeName.trim(),
        category: selected,
        description,
        rating,
        submittedBy: user.uid,
        submittedByName,
        createdAt: serverTimestamp(),
        status: 'pending',
        photoURLs,
        lat: markerCoords.latitude,
        lng: markerCoords.longitude,
      });

      router.replace('/');
      Alert.alert('Submitted for approval', 'Your discovery has been sent for review.');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    router.back();
  };

  const goToStep = (target: number) => {
    setError(null);
    setStep(Math.min(Math.max(target, 0), LAST_STEP));
  };

  const handleNext = () => goToStep(step + 1);

  const handleBack = () => goToStep(step - 1);

  const renderPhotosStep = () => (
    <>
      <Text style={styles.stepHint}>Add up to {MAX_PHOTOS} photos of the place.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
        {photoUris.map((uri, index) => (
          <View key={uri + index} style={styles.thumbnailWrapper}>
            <Image source={{ uri }} style={styles.thumbnail} />
            <Pressable style={styles.removeButton} onPress={() => handleRemovePhoto(index)}>
              <Ionicons name="close" size={12} color={Colors.parchment} />
            </Pressable>
          </View>
        ))}
        {photoUris.length < MAX_PHOTOS && (
          <Pressable style={styles.addPhotoTile} onPress={handleAddPhoto}>
            <Ionicons name="camera-outline" size={22} color={Colors.gold} />
            <Text style={styles.addPhotoText}>Add photo</Text>
          </Pressable>
        )}
      </ScrollView>

      {photoNote && <Text style={styles.photoNoteText}>{photoNote}</Text>}
    </>
  );

  const renderNameLocationStep = () => (
    <>
      {/* Place name */}
      <Text style={styles.sectionTitle}>Place name</Text>
      <TextInput
        style={styles.input}
        value={placeName}
        onChangeText={setPlaceName}
        onFocus={handleInputFocus}
        placeholder="What do you call this place?"
        placeholderTextColor={Colors.tan}
      />

      {/* Location */}
      <Text style={styles.sectionTitle}>Location</Text>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={searchText}
          onChangeText={setSearchText}
          onFocus={handleInputFocus}
          placeholder="Search a location (e.g. Elora Gorge)"
          placeholderTextColor={Colors.tan}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        <Pressable style={styles.searchButton} onPress={handleSearch}>
          <Ionicons name="search" size={18} color={Colors.parchment} />
        </Pressable>
      </View>
      {searchNote && <Text style={styles.searchNoteText}>{searchNote}</Text>}
      {/* Claim touches here so tapping the map moves the pin without dismissing the keyboard. */}
      <View style={styles.mapWrapper} onStartShouldSetResponder={() => true}>
        {locationReady ? (
          <MapView
            ref={mapRef}
            style={styles.map}
            // The map remounts each time this step is shown, so centering on the
            // current marker keeps the user's pin in view when they come back.
            initialRegion={{
              latitude: markerCoords.latitude,
              longitude: markerCoords.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
            onPress={handleMapPress}>
            <Marker coordinate={markerCoords} draggable onDragEnd={handleMarkerDragEnd} />
          </MapView>
        ) : (
          <View style={styles.mapLoading}>
            <ActivityIndicator color={Colors.ink} />
          </View>
        )}
        <DiagonalTexture />
        <CornerBrackets />
      </View>
      <Text style={styles.coordsText}>
        {formatCoord(markerCoords.latitude, 'N', 'S')}, {formatCoord(markerCoords.longitude, 'E', 'W')}
      </Text>
    </>
  );

  const renderDescriptionRatingStep = () => (
    <>
      {/* Category picker */}
      <Text style={styles.sectionTitle}>Category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
        {CATEGORY_KEYS.map((key) => {
          const active = key === selected;
          return (
            <Pressable
              key={key}
              onPress={() => setSelected(key)}
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {Categories[key].label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Description */}
      <Text style={styles.sectionTitle}>Description</Text>
      <TextInput
        style={[styles.input, styles.descriptionInput]}
        value={description}
        onChangeText={setDescription}
        onFocus={handleInputFocus}
        placeholder="How was it? Share tips for other visitors..."
        placeholderTextColor={Colors.tan}
        multiline
        textAlignVertical="top"
      />

      {/* Rating */}
      <Text style={styles.label}>Rate your experience</Text>
      <View style={styles.starRow}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Pressable key={star} onPress={() => setRating(star)} hitSlop={6}>
            <Ionicons
              name={rating !== null && star <= rating ? 'star' : 'star-outline'}
              size={26}
              color={Colors.gold}
            />
          </Pressable>
        ))}
      </View>
    </>
  );

  const isLastStep = step === LAST_STEP;

  const entranceStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ translateY: (1 - entrance.value) * ENTRANCE_OFFSET }],
  }));

  return (
    <View style={styles.backdrop}>
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        allowSwipeDismissal
        onRequestClose={handleClose}>
        <Animated.View style={[styles.container, entranceStyle]}>
          {/* Header */}
          <View style={styles.header}>
            <Pressable style={styles.backButton} onPress={handleClose}>
              <Ionicons name="close" size={18} color={Colors.ink} />
            </Pressable>
            <Text style={styles.title}>New discovery</Text>
            <View style={styles.headerSpacer} />
          </View>

          {/* Step progress */}
          <View style={styles.progress}>
            <Text style={styles.progressLabel}>
              Step {step + 1} of {STEP_TITLES.length}
            </Text>
            <View style={styles.progressSteps}>
              {STEP_SHORT_LABELS.map((label, index) => (
                <Pressable
                  key={label}
                  style={styles.progressStep}
                  onPress={() => goToStep(index)}
                  disabled={loading}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to step ${index + 1}: ${STEP_TITLES[index]}`}
                  accessibilityState={{ selected: index === step }}>
                  <View style={[styles.progressDot, index <= step && styles.progressDotActive]} />
                  <Text
                    style={[styles.progressStepText, index === step && styles.progressStepTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.stepTitle}>{STEP_TITLES[step]}</Text>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.body}
            contentContainerStyle={[
              styles.bodyContent,
              androidKeyboardPad > 0 && { paddingBottom: 24 + androidKeyboardPad },
            ]}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            onScroll={handleScroll}
            scrollEventThrottle={16}>
            {/* Inputs, buttons and the map handle their own taps first, so this only
                fires for taps on empty space and closes the keyboard. */}
            <Pressable style={styles.dismissArea} onPress={Keyboard.dismiss} accessible={false}>
              {step === 0 && renderPhotosStep()}
              {step === 1 && renderNameLocationStep()}
              {step === 2 && renderDescriptionRatingStep()}
            </Pressable>
          </ScrollView>

          {/* Kept outside the scroll view so it stays visible right above the buttons. */}
          {error && <Text style={styles.errorText}>{error}</Text>}

          {/* Footer navigation */}
          <View style={styles.footer}>
            {step > 0 && (
              <ScalePressable
                style={[styles.navButton, styles.backNavButton]}
                onPress={handleBack}
                disabled={loading}>
                <Text style={styles.backNavButtonText}>Back</Text>
              </ScalePressable>
            )}
            {isLastStep ? (
              <ScalePressable
                style={[styles.navButton, styles.submitButton, loading && styles.submitButtonDisabled]}
                onPress={handleSubmit}
                disabled={loading}>
                {loading ? (
                  <ActivityIndicator color={Colors.gold} />
                ) : (
                  <Text style={styles.submitButtonText}>Submit for approval</Text>
                )}
              </ScalePressable>
            ) : (
              <ScalePressable style={[styles.navButton, styles.submitButton]} onPress={handleNext}>
                <Text style={styles.submitButtonText}>Next</Text>
              </ScalePressable>
            )}
          </View>
        </Animated.View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: Colors.parchment },
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 20 : 40,
    paddingBottom: 14,
  },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.parchment2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.line,
  },
  title: { fontFamily: Fonts.display, fontSize: 20, color: Colors.ink },
  headerSpacer: { width: 34 },
  progress: {
    marginHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  progressLabel: {
    fontFamily: Fonts.mono,
    fontSize: 11.5,
    color: Colors.tan,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  progressSteps: { flexDirection: 'row', gap: 6, marginTop: 8 },
  progressStep: { flex: 1, gap: 6 },
  progressStepText: { fontFamily: Fonts.bodyMedium, fontSize: 11, color: Colors.tan },
  progressStepTextActive: { color: Colors.ink },
  progressDot: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.parchment2,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  progressDotActive: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  stepTitle: { fontFamily: Fonts.display, fontSize: 17, color: Colors.ink, marginTop: 12 },
  body: { flex: 1 },
  bodyContent: { flexGrow: 1, paddingBottom: 24 },
  dismissArea: { flexGrow: 1 },
  stepHint: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.tan,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 12,
  },
  // Horizontal ScrollViews default to flexGrow: 1. The step content fills the sheet
  // (so tapping blank space dismisses the keyboard), so without this the row would
  // soak up the spare height and stretch its children vertically.
  photoRow: { flexGrow: 0, paddingLeft: 20, marginBottom: 4 },
  thumbnailWrapper: {
    width: 96,
    height: 96,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: '#fff',
    marginRight: 10,
  },
  thumbnail: { width: '100%', height: '100%' },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(46,40,18,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPhotoTile: {
    width: 96,
    height: 96,
    borderRadius: 16,
    backgroundColor: Colors.ink,
    borderWidth: 1.5,
    borderColor: Colors.gold,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  addPhotoText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 10,
    color: Colors.parchment,
    textAlign: 'center',
  },
  photoNoteText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.brown,
    marginHorizontal: 20,
    marginTop: 10,
  },
  sectionTitle: {
    fontFamily: Fonts.display,
    fontSize: 17,
    color: Colors.ink,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 10,
  },
  chipRow: { flexGrow: 0, paddingLeft: 20, marginBottom: 4 },
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
  input: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
    marginHorizontal: 20,
  },
  descriptionInput: { height: 100 },
  label: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12.5,
    color: Colors.ink,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 10,
  },
  starRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 20,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.line,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.ink,
  },
  searchButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchNoteText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.brown,
    marginHorizontal: 20,
    marginTop: -4,
    marginBottom: 10,
  },
  mapWrapper: {
    marginHorizontal: 20,
    height: 190,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: Colors.parchment2,
  },
  map: { width: '100%', height: '100%' },
  mapLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coordsText: {
    fontFamily: Fonts.mono,
    fontSize: 11.5,
    color: Colors.tan,
    marginHorizontal: 20,
    marginTop: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  errorText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.brown,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 8,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
    backgroundColor: Colors.parchment,
  },
  navButton: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backNavButton: {
    paddingHorizontal: 22,
    backgroundColor: Colors.parchment2,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  backNavButtonText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.ink },
  submitButton: { flex: 1, backgroundColor: Colors.ink },
  submitButtonDisabled: { opacity: 0.7 },
  submitButtonText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.gold },
});
