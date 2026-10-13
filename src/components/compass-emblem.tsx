import Svg, { Circle, G, Line, Path } from 'react-native-svg';

import { Colors } from '@/constants/theme';
import { LEAF_PATH, LETTERS_PATH, SOLID_STAR_PATH, STAR_PATH, TICKS } from '@/components/compass-geometry';

const MAJOR_TICKS = TICKS.filter((_, i) => i % 5 === 0);

// Below these sizes the fine detail (leaf, letters, minor ticks) turns to mush,
// so the mark is simplified.
const FULL_DETAIL_MIN_SIZE = 56;
const MEDIUM_DETAIL_MIN_SIZE = 28;

interface CompassEmblemProps {
  size?: number;
  /** Colour of the whole mark — the logo is single-colour. */
  strokeColor?: string;
  /** No longer used; kept so existing call sites still type-check. */
  fillColor?: string;
}

export function CompassEmblem({ size = 36, strokeColor = Colors.pine }: CompassEmblemProps) {
  if (size < FULL_DETAIL_MIN_SIZE) {
    // Keep every line at least ~1 screen pixel wide (the viewBox is 100 units).
    const minStroke = 100 / size;
    const ringWidth = Math.max(2.4, minStroke);
    const outerRing = (
      <Circle
        cx={50}
        cy={50}
        r={Math.min(47, 50 - ringWidth / 2)}
        stroke={strokeColor}
        strokeWidth={ringWidth}
        fill="none"
      />
    );

    if (size < MEDIUM_DETAIL_MIN_SIZE) {
      return (
        <Svg width={size} height={size} viewBox="0 0 100 100">
          {outerRing}
          <Path d={SOLID_STAR_PATH} fill={strokeColor} />
        </Svg>
      );
    }

    return (
      <Svg width={size} height={size} viewBox="0 0 100 100">
        {outerRing}
        <G stroke={strokeColor} strokeLinecap="round">
          {MAJOR_TICKS.map((tick, i) => (
            <Line
              key={i}
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              strokeWidth={Math.max(tick.width, minStroke)}
            />
          ))}
        </G>
        <Path d={STAR_PATH} fill={strokeColor} />
        <Circle
          cx={50}
          cy={50}
          r={9.5}
          stroke={strokeColor}
          strokeWidth={Math.max(0.9, minStroke)}
          fill="none"
        />
        <Circle cx={50} cy={50} r={4.5} fill={strokeColor} />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx={50} cy={50} r={47} stroke={strokeColor} strokeWidth={2.4} fill="none" />
      <Circle cx={50} cy={50} r={44.8} stroke={strokeColor} strokeWidth={0.6} fill="none" />
      <G stroke={strokeColor} strokeLinecap="round">
        {TICKS.map((tick, i) => (
          <Line key={i} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} strokeWidth={tick.width} />
        ))}
      </G>
      <Path d={LETTERS_PATH} fill={strokeColor} />
      <Path d={STAR_PATH} fill={strokeColor} />
      <Circle cx={50} cy={50} r={9.5} stroke={strokeColor} strokeWidth={0.9} fill="none" />
      <Path d={LEAF_PATH} fill={strokeColor} />
    </Svg>
  );
}
