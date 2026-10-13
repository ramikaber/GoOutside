import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  TextInput,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Gallery, fitContainer, useImageResolution } from 'react-native-zoom-toolkit';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Timestamp,
} from 'firebase/firestore';
import { deleteObject, ref } from 'firebase/storage';

import { Colors, Fonts, Categories, markColorOn } from '@/constants/theme';
import { auth, db, storage } from '@/lib/firebase';
import { CompassEmblem } from '@/components/compass-emblem';
import { useIsAdmin } from '@/hooks/use-is-admin';

type StatusTab = 'pending' | 'approved' | 'rejected';

const TABS: { key: StatusTab; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

interface AdminPlace {
  id: string;
  name: string;
  category: string;
  description: string;
  rating: number | null;
  photoURLs: string[];
  lat: number;
  lng: number;
  submittedBy: string;
  submittedByName: string | null;
  createdAt: Timestamp | null;
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

function formatDate(ts: Timestamp | null): string {
  if (!ts) return 'Just now';
  return ts.toDate().toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface AdminTask {
  id: string;
  description: string;
}

function AdminPlaceTasks({ placeId }: { placeId: string }) {
  const [tasks, setTasks] = useState<AdminTask[]>([]);
  const [newTaskText, setNewTaskText] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('placeId', '==', placeId),
      orderBy('createdAt', 'desc'),
    );

    return onSnapshot(tasksQuery, (snapshot) => {
      setTasks(
        snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          description: docSnapshot.data().description as string,
        })),
      );
    });
  }, [placeId]);

  const handleAddTask = async () => {
    const trimmed = newTaskText.trim();
    if (!trimmed || !auth.currentUser) return;

    setAdding(true);
    try {
      await addDoc(collection(db, 'tasks'), {
        placeId,
        description: trimmed,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser.uid,
      });
      setNewTaskText('');
    } catch {
      Alert.alert('Something went wrong', 'Please try again.');
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    setDeletingId(taskId);
    try {
      await deleteDoc(doc(db, 'tasks', taskId));
    } catch {
      Alert.alert('Something went wrong', 'Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <View style={styles.tasksSection}>
      <Text style={styles.tasksSectionTitle}>Tasks</Text>

      {tasks.length === 0 ? (
        <Text style={styles.noTasksText}>No tasks yet.</Text>
      ) : (
        tasks.map((task) => (
          <View key={task.id} style={styles.taskRow}>
            <Text style={styles.taskDescriptionText}>{task.description}</Text>
            <Pressable
              onPress={() => handleDeleteTask(task.id)}
              disabled={deletingId === task.id}
              hitSlop={8}>
              {deletingId === task.id ? (
                <ActivityIndicator color={Colors.brown} size="small" />
              ) : (
                <Ionicons name="trash-outline" size={16} color={Colors.brown} />
              )}
            </Pressable>
          </View>
        ))
      )}

      <View style={styles.addTaskRow}>
        <TextInput
          style={styles.taskInput}
          value={newTaskText}
          onChangeText={setNewTaskText}
          placeholder="Add a task..."
          placeholderTextColor={Colors.tan}
        />
        <Pressable
          style={[
            styles.addTaskButton,
            (!newTaskText.trim() || adding) && styles.addTaskButtonDisabled,
          ]}
          onPress={handleAddTask}
          disabled={!newTaskText.trim() || adding}>
          {adding ? (
            <ActivityIndicator color={Colors.parchment} size="small" />
          ) : (
            <Text style={styles.addTaskButtonText}>Add task</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

export default function AdminScreen() {
  const [activeTab, setActiveTab] = useState<StatusTab>('pending');
  const [places, setPlaces] = useState<AdminPlace[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [viewerPhotos, setViewerPhotos] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerPlaceholderColor, setViewerPlaceholderColor] = useState(Colors.ink);

  const isAdmin = useIsAdmin();

  useEffect(() => {
    if (!isAdmin) return;

    setLoadingQueue(true);
    setQueueError(null);

    const statusQuery = query(
      collection(db, 'places'),
      where('status', '==', activeTab),
      orderBy('createdAt', 'desc'),
    );

    const unsubscribe = onSnapshot(
      statusQuery,
      (snapshot) => {
        setPlaces(
          snapshot.docs.map((docSnapshot) => {
            const data = docSnapshot.data();
            return {
              id: docSnapshot.id,
              name: (data.name as string | undefined) ?? 'Untitled discovery',
              category: data.category as string,
              description: (data.description as string | undefined) ?? '',
              rating: (data.rating as number | null | undefined) ?? null,
              photoURLs: (data.photoURLs as string[] | undefined) ?? [],
              lat: data.lat as number,
              lng: data.lng as number,
              submittedBy: data.submittedBy as string,
              submittedByName: (data.submittedByName as string | undefined) ?? null,
              createdAt: (data.createdAt as Timestamp | undefined) ?? null,
            };
          }),
        );
        setLoadingQueue(false);
      },
      (err) => {
        setQueueError(err.message);
        setLoadingQueue(false);
      },
    );

    return unsubscribe;
  }, [isAdmin, activeTab]);

  const openViewer = (photos: string[], index: number, placeholderColor: string) => {
    setViewerPhotos(photos);
    setViewerIndex(index);
    setViewerPlaceholderColor(placeholderColor);
    setViewerVisible(true);
  };

  const handleUpdateStatus = async (id: string, status: StatusTab) => {
    setProcessingId(id);
    try {
      const updates: Record<string, unknown> = { status };
      if (status === 'approved' || status === 'rejected') {
        updates.reviewedAt = serverTimestamp();
        updates.notified = false;
      }
      await updateDoc(doc(db, 'places', id), updates);
    } catch {
      Alert.alert('Something went wrong', 'Please try again.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = (place: AdminPlace) => {
    Alert.alert("Delete this place?", "This can't be undone.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setProcessingId(place.id);
          try {
            await Promise.all(
              place.photoURLs.map((url) => deleteObject(ref(storage, url)).catch(() => {})),
            );
            await deleteDoc(doc(db, 'places', place.id));
          } catch {
            Alert.alert('Something went wrong', 'Please try again.');
          } finally {
            setProcessingId(null);
          }
        },
      },
    ]);
  };

  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={32} color={Colors.tan} />
          <Text style={styles.notAuthorizedText}>Not authorized</Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={18} color={Colors.ink} />
          </Pressable>
          <Text style={styles.title}>Admin queue</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Status tabs */}
        <View style={styles.tabRow}>
          {TABS.map((tab) => (
            <Pressable
              key={tab.key}
              style={[styles.tabChip, activeTab === tab.key && styles.tabChipActive]}
              onPress={() => setActiveTab(tab.key)}>
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.countText}>
          {places.length} {activeTab}
        </Text>

        {loadingQueue ? (
          <ActivityIndicator color={Colors.ink} style={styles.loadingIndicator} />
        ) : queueError ? (
          <Text style={styles.errorText}>{queueError}</Text>
        ) : places.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle-outline" size={28} color={Colors.pine} />
            <Text style={styles.emptyText}>Nothing here right now.</Text>
          </View>
        ) : (
          places.map((place) => {
            const categoryMeta = Categories[place.category as keyof typeof Categories];
            const isProcessing = processingId === place.id;
            return (
              <View key={place.id} style={styles.card}>
                <View style={styles.cardTopRow}>
                  <View
                    style={[
                      styles.categoryBadge,
                      { backgroundColor: categoryMeta?.color ?? Colors.ink },
                    ]}>
                    <Text style={styles.categoryBadgeText}>
                      {categoryMeta?.label ?? place.category}
                    </Text>
                  </View>
                  <Text style={styles.dateText}>{formatDate(place.createdAt)}</Text>
                </View>

                <Text style={styles.placeName}>{place.name}</Text>

                {place.photoURLs.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.photoRow}>
                    {place.photoURLs.map((uri, index) => (
                      <Pressable
                        key={uri + index}
                        onPress={() =>
                          openViewer(place.photoURLs, index, categoryMeta?.color ?? Colors.ink)
                        }>
                        <Image source={{ uri }} style={styles.photoThumb} />
                      </Pressable>
                    ))}
                  </ScrollView>
                )}

                {place.rating !== null ? (
                  <View style={styles.ratingRow}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Ionicons
                        key={star}
                        name={star <= place.rating! ? 'star' : 'star-outline'}
                        size={15}
                        color={Colors.gold}
                      />
                    ))}
                  </View>
                ) : (
                  <Text style={styles.noRatingText}>No rating given</Text>
                )}

                <Text style={styles.descriptionText}>
                  {place.description || 'No description'}
                </Text>

                <Text style={styles.coordsText}>
                  {place.lat.toFixed(5)}, {place.lng.toFixed(5)}
                </Text>
                <Text style={styles.submittedByText}>
                  Submitted by {place.submittedByName ?? place.submittedBy}
                </Text>

                <View style={styles.divider} />

                <View style={styles.actionsRow}>
                  {activeTab === 'pending' && (
                    <>
                      <Pressable
                        style={[styles.actionButton, styles.rejectButton]}
                        onPress={() => handleUpdateStatus(place.id, 'rejected')}
                        disabled={isProcessing}>
                        <Text style={styles.rejectButtonText}>Reject</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.actionButton, styles.approveButton]}
                        onPress={() => handleUpdateStatus(place.id, 'approved')}
                        disabled={isProcessing}>
                        {isProcessing ? (
                          <ActivityIndicator color={Colors.parchment} size="small" />
                        ) : (
                          <Text style={styles.approveButtonText}>Approve</Text>
                        )}
                      </Pressable>
                    </>
                  )}

                  {activeTab === 'approved' && (
                    <>
                      <Pressable
                        style={[styles.actionButton, styles.deleteButton]}
                        onPress={() => handleDelete(place)}
                        disabled={isProcessing}>
                        {isProcessing ? (
                          <ActivityIndicator color={Colors.parchment} size="small" />
                        ) : (
                          <Text style={styles.deleteButtonText}>Delete</Text>
                        )}
                      </Pressable>
                      <Pressable
                        style={[styles.actionButton, styles.secondaryButton]}
                        onPress={() => handleUpdateStatus(place.id, 'pending')}
                        disabled={isProcessing}>
                        {isProcessing ? (
                          <ActivityIndicator color={Colors.ink} size="small" />
                        ) : (
                          <Text style={styles.secondaryButtonText}>Move to pending</Text>
                        )}
                      </Pressable>
                    </>
                  )}

                  {activeTab === 'rejected' && (
                    <>
                      <Pressable
                        style={[styles.actionButton, styles.deleteButton]}
                        onPress={() => handleDelete(place)}
                        disabled={isProcessing}>
                        {isProcessing ? (
                          <ActivityIndicator color={Colors.parchment} size="small" />
                        ) : (
                          <Text style={styles.deleteButtonText}>Delete</Text>
                        )}
                      </Pressable>
                      <Pressable
                        style={[styles.actionButton, styles.secondaryButton]}
                        onPress={() => handleUpdateStatus(place.id, 'pending')}
                        disabled={isProcessing}>
                        {isProcessing ? (
                          <ActivityIndicator color={Colors.ink} size="small" />
                        ) : (
                          <Text style={styles.secondaryButtonText}>Restore to pending</Text>
                        )}
                      </Pressable>
                    </>
                  )}
                </View>

                {activeTab === 'approved' && <AdminPlaceTasks placeId={place.id} />}
              </View>
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
  screen: { flex: 1, backgroundColor: Colors.parchment },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  notAuthorizedText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.tan },
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
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
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: Colors.parchment2,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: 4,
    marginBottom: 16,
  },
  tabChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 16,
    alignItems: 'center',
  },
  tabChipActive: { backgroundColor: Colors.ink },
  tabText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink },
  tabTextActive: { color: Colors.parchment },
  countText: {
    fontFamily: Fonts.display,
    fontSize: 17,
    color: Colors.ink,
    marginHorizontal: 20,
    marginBottom: 16,
    textTransform: 'capitalize',
  },
  loadingIndicator: { marginTop: 40 },
  errorText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.brown,
    marginHorizontal: 20,
  },
  emptyState: {
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 30,
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
    marginBottom: 20,
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: 18,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  categoryBadge: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  categoryBadgeText: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: Colors.parchment,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  dateText: {
    fontFamily: Fonts.mono,
    fontSize: 10.5,
    color: Colors.tan,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  placeName: {
    fontFamily: Fonts.display,
    fontSize: 19,
    color: Colors.ink,
    marginBottom: 12,
  },
  photoRow: { marginBottom: 12 },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.parchment2,
    marginRight: 8,
  },
  ratingRow: { flexDirection: 'row', gap: 3, marginBottom: 10 },
  noRatingText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.tan,
    marginBottom: 10,
  },
  descriptionText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.ink,
    marginBottom: 12,
  },
  coordsText: {
    fontFamily: Fonts.mono,
    fontSize: 10.5,
    color: Colors.tan,
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  submittedByText: {
    fontFamily: Fonts.mono,
    fontSize: 10.5,
    color: Colors.tan,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.line,
    marginVertical: 14,
  },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionButton: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  rejectButton: {
    backgroundColor: Colors.parchment2,
    borderWidth: 1,
    borderColor: Colors.brown,
  },
  rejectButtonText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.brown },
  approveButton: { backgroundColor: Colors.pine },
  approveButtonText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.parchment },
  deleteButton: { backgroundColor: Colors.brown },
  deleteButtonText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.parchment },
  secondaryButton: {
    backgroundColor: Colors.parchment2,
    borderWidth: 1,
    borderColor: Colors.ink,
  },
  secondaryButtonText: { fontFamily: Fonts.bodySemiBold, fontSize: 13, color: Colors.ink },
  tasksSection: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: Colors.line },
  tasksSectionTitle: {
    fontFamily: Fonts.display,
    fontSize: 15,
    color: Colors.ink,
    marginBottom: 10,
  },
  noTasksText: {
    fontFamily: Fonts.body,
    fontSize: 12.5,
    color: Colors.tan,
    marginBottom: 10,
  },
  taskRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  taskDescriptionText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.ink,
  },
  addTaskRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  taskInput: {
    flex: 1,
    backgroundColor: Colors.parchment2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.line,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.ink,
  },
  addTaskButton: {
    backgroundColor: Colors.pine,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTaskButtonDisabled: { opacity: 0.5 },
  addTaskButtonText: { fontFamily: Fonts.bodySemiBold, fontSize: 12.5, color: Colors.parchment },
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
