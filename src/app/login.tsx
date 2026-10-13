import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FirebaseError } from 'firebase/app';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { router, useLocalSearchParams } from 'expo-router';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { Colors, Fonts } from '@/constants/theme';
import { auth, db } from '@/lib/firebase';
import { CompassEmblem } from '@/components/compass-emblem';

type Mode = 'login' | 'signup';

const ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/wrong-password': 'Incorrect password. Try again.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account already exists with that email.',
  'auth/weak-password': 'Password should be at least 6 characters.',
  'auth/missing-password': 'Enter a password to continue.',
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
};

function getErrorMessage(err: unknown): string {
  if (err instanceof FirebaseError) {
    return ERROR_MESSAGES[err.code] ?? 'Something went wrong. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

function PasswordField({
  value,
  onChangeText,
  visible,
  onToggleVisible,
}: {
  value: string;
  onChangeText: (text: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
}) {
  return (
    <View style={styles.passwordWrapper}>
      <TextInput
        style={[styles.input, styles.passwordInput]}
        value={value}
        onChangeText={onChangeText}
        placeholder="••••••••"
        placeholderTextColor={Colors.tan}
        secureTextEntry={!visible}
        autoCapitalize="none"
      />
      <Pressable style={styles.eyeButton} onPress={onToggleVisible} hitSlop={8}>
        <Ionicons name={visible ? 'eye-off' : 'eye'} size={18} color={Colors.tan} />
      </Pressable>
    </View>
  );
}

export default function LoginScreen() {
  const { redirect } = useLocalSearchParams<{ redirect?: string }>();
  const [mode, setMode] = useState<Mode>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    setMessage(null);

    if (mode === 'signup' && !fullName.trim()) {
      setError('Please enter your full name');
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const trimmedName = fullName.trim();
        await updateProfile(credential.user, { displayName: trimmedName });
        await setDoc(doc(db, 'users', credential.user.uid), {
          displayName: trimmedName,
          email: credential.user.email,
          role: 'user',
          createdAt: serverTimestamp(),
        });
      }
      router.replace(redirect === 'post' ? '/post' : '/');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    setError(null);
    setMessage(null);

    if (!email.trim()) {
      setError('Enter your email first');
      return;
    }

    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage('Password reset email sent — check your inbox');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.wordmarkRow}>
            <CompassEmblem size={36} />
            <Text style={styles.wordmark}>GoOutside</Text>
          </View>
          <Text style={styles.tagline}>Your passport to what's around you</Text>
        </View>

        {/* Mode toggle */}
        <View style={styles.toggleRow}>
          <Pressable
            style={[styles.toggleChip, mode === 'login' && styles.toggleChipActive]}
            onPress={() => setMode('login')}>
            <Text style={[styles.toggleText, mode === 'login' && styles.toggleTextActive]}>
              Log in
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toggleChip, mode === 'signup' && styles.toggleChipActive]}
            onPress={() => setMode('signup')}>
            <Text style={[styles.toggleText, mode === 'signup' && styles.toggleTextActive]}>
              Sign up
            </Text>
          </Pressable>
        </View>

        {/* Form */}
        <View style={styles.form}>
          {mode === 'signup' && (
            <>
              <Text style={styles.label}>Full name</Text>
              <TextInput
                style={styles.input}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Jane Doe"
                placeholderTextColor={Colors.tan}
                autoCapitalize="words"
              />
            </>
          )}

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={Colors.tan}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />

          <Text style={styles.label}>Password</Text>
          <PasswordField
            value={password}
            onChangeText={setPassword}
            visible={showPassword}
            onToggleVisible={() => setShowPassword((v) => !v)}
          />

          {mode === 'login' && (
            <Pressable onPress={handleForgotPassword} hitSlop={8}>
              <Text style={styles.forgotPasswordText}>Forgot password?</Text>
            </Pressable>
          )}

          {mode === 'signup' && (
            <>
              <Text style={styles.label}>Confirm password</Text>
              <PasswordField
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                visible={showConfirmPassword}
                onToggleVisible={() => setShowConfirmPassword((v) => !v)}
              />
            </>
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}
          {message && <Text style={styles.messageText}>{message}</Text>}

          <Pressable
            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={loading}>
            {loading ? (
              <ActivityIndicator color={Colors.gold} />
            ) : (
              <Text style={styles.submitButtonText}>
                {mode === 'login' ? 'Log in' : 'Create account'}
              </Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.parchment },
  container: { flex: 1, backgroundColor: Colors.parchment },
  header: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 90,
    paddingBottom: 30,
  },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wordmark: {
    fontFamily: Fonts.display,
    fontSize: 24,
    color: Colors.ink,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  tagline: {
    fontFamily: Fonts.secondaryItalic,
    fontSize: 15,
    color: Colors.tan,
    marginTop: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: Colors.parchment2,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: 4,
    marginBottom: 24,
  },
  toggleChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 16,
    alignItems: 'center',
  },
  toggleChipActive: { backgroundColor: Colors.ink },
  toggleText: { fontFamily: Fonts.bodyMedium, fontSize: 13, color: Colors.ink },
  toggleTextActive: { color: Colors.parchment },
  form: { marginHorizontal: 20 },
  label: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12.5,
    color: Colors.ink,
    marginBottom: 6,
    marginTop: 14,
  },
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
  },
  passwordWrapper: { justifyContent: 'center' },
  passwordInput: { paddingRight: 44 },
  eyeButton: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  forgotPasswordText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12.5,
    color: Colors.tan,
    marginTop: 10,
    alignSelf: 'flex-end',
  },
  errorText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.brown,
    marginTop: 14,
  },
  messageText: {
    fontFamily: Fonts.bodyMedium,
    fontSize: 12,
    color: Colors.pine,
    marginTop: 14,
  },
  submitButton: {
    marginTop: 24,
    backgroundColor: Colors.ink,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitButtonDisabled: { opacity: 0.7 },
  submitButtonText: { fontFamily: Fonts.bodySemiBold, fontSize: 14, color: Colors.gold },
});
