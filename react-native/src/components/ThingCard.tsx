import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSizes, radii, spacing } from '~/theme';

type Props = {
  title: string;
  subtitle?: string;
  accent?: string;
  onPress?: () => void;
};

export function ThingCard({ title, subtitle, accent = colors.chakras.throat, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.sm
  },
  pressed: {
    opacity: 0.7
  },
  accent: {
    width: 6
  },
  body: {
    flex: 1,
    padding: spacing.md
  },
  title: {
    fontSize: fontSizes.md,
    fontWeight: '600',
    color: colors.text
  },
  subtitle: {
    marginTop: spacing.xs,
    fontSize: fontSizes.sm,
    color: colors.textMuted
  }
});
