import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { RainbowBar } from '~/components/RainbowBar';
import { getThing, type Thing } from '~/api/thing';
import { colors, fontSizes, radii, spacing } from '~/theme';
import type { RootStackParamList } from '~/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Thing'>;

export function ThingScreen({ route }: Props) {
  const { uuid } = route.params;
  const [thing, setThing] = useState<Thing | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    getThing(uuid)
      .then((result) => {
        if (active) {
          setThing(result);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err?.message ?? 'Failed to load thing');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [uuid]);

  return (
    <View style={styles.container}>
      <RainbowBar />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>uuid</Text>
        <Text style={styles.uuid}>{uuid}</Text>

        {loading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <View style={styles.payload}>
            <Text style={styles.label}>payload</Text>
            <Text style={styles.code}>{thing === null ? 'No data returned' : JSON.stringify(thing, null, 2)}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  content: {
    padding: spacing.lg
  },
  label: {
    fontSize: fontSizes.sm,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  uuid: {
    marginTop: spacing.xs,
    fontSize: fontSizes.lg,
    color: colors.text,
    marginBottom: spacing.lg
  },
  loader: {
    marginTop: spacing.xl
  },
  error: {
    marginTop: spacing.lg,
    color: colors.chakras.root,
    fontSize: fontSizes.md
  },
  payload: {
    marginTop: spacing.sm
  },
  code: {
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.greys.light,
    borderRadius: radii.md,
    fontFamily: 'Courier',
    fontSize: fontSizes.sm,
    color: colors.text
  }
});
