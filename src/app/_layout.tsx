import { useCallback, useEffect, useState } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { Platform, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import { Marcellus_400Regular } from '@expo-google-fonts/marcellus';
import {
  CormorantGaramond_500Medium,
  CormorantGaramond_500Medium_Italic,
} from '@expo-google-fonts/cormorant-garamond';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import AppTabs from '@/components/app-tabs';
import { SafeIntro } from '@/components/intro/safe-intro';
import { auth, db } from '@/lib/firebase';

SplashScreen.preventAutoHideAsync();

// Accounts created before the users/{uid} collection existed won't have a
// document yet — backfill one from their auth profile the first time we see
// them signed in, so every user has one going forward without a migration.
async function ensureUserDocument(user: User) {
  const userDocRef = doc(db, 'users', user.uid);
  const userDoc = await getDoc(userDocRef);
  if (userDoc.exists()) return;

  await setDoc(userDocRef, {
    displayName: user.displayName,
    email: user.email,
    role: 'user',
    createdAt: serverTimestamp(),
  });
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded] = useFonts({
    Marcellus_400Regular,
    CormorantGaramond_500Medium,
    CormorantGaramond_500Medium_Italic,
    JetBrainsMono_500Medium,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  // The intro plays every time the app starts, over the app as it loads
  // underneath, until it has finished, been skipped or failed. Its code (and
  // Skia's drawing of its world) only loads when it plays. It's mobile only;
  // the web build goes straight to the app.
  const [playIntro, setPlayIntro] = useState(Platform.OS !== 'web');
  const handleIntroFinish = useCallback(() => setPlayIntro(false), []);

  // Without the intro, the native splash comes down as soon as the app is
  // ready to show; with it, the intro takes it down once its first frame is
  // drawn.
  useEffect(() => {
    if (fontsLoaded && !playIntro) SplashScreen.hide();
  }, [fontsLoaded, playIntro]);

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      if (user) ensureUserDocument(user);
    });
  }, []);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AppTabs />
        {playIntro && <SafeIntro onFinish={handleIntroFinish} />}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
