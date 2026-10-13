import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PRESSED_SCALE = 0.96;

// Stiff and well damped so the press reads as a quick squeeze, not a wobble.
const PRESS_SPRING = { stiffness: 500, damping: 30, mass: 1 };

type ScalePressableProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
};

// A Pressable that scales down slightly while held and springs back on
// release. Disabled presses don't animate, since Pressable skips onPressIn.
export function ScalePressable({ style, onPressIn, onPressOut, ...props }: ScalePressableProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...props}
      style={[style, animatedStyle]}
      onPressIn={(event) => {
        scale.value = withSpring(PRESSED_SCALE, PRESS_SPRING);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withSpring(1, PRESS_SPRING);
        onPressOut?.(event);
      }}
    />
  );
}
