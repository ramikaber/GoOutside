import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

import { Colors } from '@/constants/theme';

const BRACKET_SIZE = 18;
const BRACKET_THICKNESS = 2;

// Subtle repeating 45-degree line wash — the "tapisserie" texture from the
// Precision & Parchment reference. Sits above the MapView (and below the
// badge/brackets) at very low opacity so it reads as paper grain, not noise.
export function DiagonalTexture() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <Pattern
          id="tapisserie"
          width={8}
          height={8}
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)">
          <Line x1={0} y1={0} x2={0} y2={8} stroke={Colors.ink} strokeWidth={1} />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" fill="url(#tapisserie)" opacity={0.04} />
    </Svg>
  );
}

export function CornerBrackets({ color = Colors.brown }: { color?: string }) {
  return (
    <>
      <View pointerEvents="none" style={[styles.bracket, styles.topLeft, { borderColor: color }]} />
      <View pointerEvents="none" style={[styles.bracket, styles.topRight, { borderColor: color }]} />
      <View
        pointerEvents="none"
        style={[styles.bracket, styles.bottomLeft, { borderColor: color }]}
      />
      <View
        pointerEvents="none"
        style={[styles.bracket, styles.bottomRight, { borderColor: color }]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bracket: {
    position: 'absolute',
    width: BRACKET_SIZE,
    height: BRACKET_SIZE,
  },
  topLeft: { top: 8, left: 8, borderTopWidth: BRACKET_THICKNESS, borderLeftWidth: BRACKET_THICKNESS },
  topRight: {
    top: 8,
    right: 8,
    borderTopWidth: BRACKET_THICKNESS,
    borderRightWidth: BRACKET_THICKNESS,
  },
  bottomLeft: {
    bottom: 8,
    left: 8,
    borderBottomWidth: BRACKET_THICKNESS,
    borderLeftWidth: BRACKET_THICKNESS,
  },
  bottomRight: {
    bottom: 8,
    right: 8,
    borderBottomWidth: BRACKET_THICKNESS,
    borderRightWidth: BRACKET_THICKNESS,
  },
});
