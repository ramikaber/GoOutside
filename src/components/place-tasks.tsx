import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Fonts } from '@/constants/theme';
import { usePlaceTasks } from '@/hooks/use-place-tasks';

export function PlaceTasks({ placeId }: { placeId: string }) {
  const { tasks, completedTaskIds, completedCount, toggleTask } = usePlaceTasks(placeId);

  if (tasks.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Tasks</Text>
        <Text style={styles.countText}>
          {completedCount} of {tasks.length} completed
        </Text>
      </View>

      {tasks.map((task) => {
        const completed = completedTaskIds.has(task.id);
        return (
          <Pressable
            key={task.id}
            style={({ pressed }) => [
              styles.taskRow,
              completed && pressed && styles.taskRowCompletedPressed,
            ]}
            onPress={() => toggleTask(task.id)}>
            <Ionicons
              name={completed ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={completed ? Colors.pine : Colors.tan}
            />
            <Text style={[styles.taskText, completed && styles.taskTextCompleted]}>
              {task.description}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 20 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: { fontFamily: Fonts.display, fontSize: 15, color: Colors.ink },
  countText: {
    fontFamily: Fonts.mono,
    fontSize: 10.5,
    color: Colors.tan,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
  },
  taskRowCompletedPressed: {
    opacity: 0.5,
  },
  taskText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.ink,
  },
  taskTextCompleted: {
    color: Colors.tan,
    textDecorationLine: 'line-through',
  },
});
