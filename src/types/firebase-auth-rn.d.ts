// firebase/auth's package.json exports map lists the "types" condition before
// "react-native", so TypeScript resolves to the platform-agnostic public types
// and misses this React Native-only export, even though it exists at runtime
// (Metro resolves the "react-native" condition correctly). Restore its type here.
import type { Persistence, ReactNativeAsyncStorage } from 'firebase/auth';

declare module 'firebase/auth' {
  export function getReactNativePersistence(storage: ReactNativeAsyncStorage): Persistence;
}
