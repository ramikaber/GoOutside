// GoOutside — design tokens
// "Precision & Parchment": Canadian outdoor heritage meets precision/craftsmanship styling

export const Colors = {
  parchment: '#EFE6D0',
  parchment2: '#E4D9BC',
  pine: '#3B4A2E',
  brown: '#6B4E2E',
  gold: '#B8975A',
  tan: '#8B7754',
  ink: '#2E2812',
  line: 'rgba(59,74,46,0.25)',
};

export const Fonts = {
  display: 'Marcellus_400Regular',              // headers, wordmark — uppercase, letter-spaced
  secondary: 'CormorantGaramond_500Medium',      // taglines, secondary text
  secondaryItalic: 'CormorantGaramond_500Medium_Italic',
  body: 'Inter_400Regular',                      // normal UI text
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_500Medium',               // stats, tags, uppercase labels
};

export const Categories = {
  nature: { label: 'Nature', color: Colors.pine },
  food: { label: 'Food & drink', color: Colors.brown },
  art: { label: 'Art & culture', color: Colors.gold },
  hiddenGem: { label: 'Hidden gem', color: Colors.ink },
  adventure: { label: 'Adventure', color: '#5E7A46' }, // pine, lightened
  historic: { label: 'Historic', color: '#54391F' }, // brown, deepened
  nightlife: { label: 'Nightlife', color: '#241F0E' }, // ink, darkened further
  seasonal: { label: 'Winter & seasonal', color: '#D4C19C' }, // gold, tinted toward parchment
  roadTrip: { label: 'Road trip', color: Colors.tan },
};

// WCAG relative luminance of a #RRGGBB colour.
function relativeLuminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG contrast ratio between two #RRGGBB colours (1–21).
export function contrastRatio(a: string, b: string) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

// Parchment or ink, whichever reads better on the given background.
export function markColorOn(background: string) {
  return contrastRatio(Colors.parchment, background) >= contrastRatio(Colors.ink, background)
    ? Colors.parchment
    : Colors.ink;
}

export const Spacing = {
  zero: 0,
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 20,
  six: 24,
  eight: 32,
  ten: 40,
  twelve: 48,
};
