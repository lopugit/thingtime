import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { RainbowBar } from '~/components/RainbowBar';
import { ThingCard } from '~/components/ThingCard';
import { colors, fontSizes, spacing } from '~/theme';
import type { RootStackParamList } from '~/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

// A few example "things" to give the starter something to render before it's
// wired to real data. Each maps to a chakra colour from the brand palette.
const sampleThings = [
  { uuid: 'welcome', title: 'Welcome to Thingtime 🦄', subtitle: 'Store and share information of all kinds.', accent: colors.chakras.crown },
  { uuid: 'notes', title: 'My Notes', subtitle: 'Personal notes, kept in sync.', accent: colors.chakras.throat },
  { uuid: 'projects', title: 'Projects', subtitle: 'Collaborate with your team.', accent: colors.chakras.heart },
  { uuid: 'ideas', title: 'Ideas', subtitle: 'Capture sparks before they fade.', accent: colors.chakras.sacral }
];

export function HomeScreen({ navigation }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.brand}>Thingtime</Text>
        <Text style={styles.tagline}>A GUI for the internet 🌈</Text>
      </View>
      <RainbowBar />
      <ScrollView contentContainerStyle={styles.list}>
        {sampleThings.map((thing) => (
          <ThingCard
            key={thing.uuid}
            title={thing.title}
            subtitle={thing.subtitle}
            accent={thing.accent}
            onPress={() => navigation.navigate('Thing', { uuid: thing.uuid, title: thing.title })}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg
  },
  brand: {
    fontSize: fontSizes.xxl,
    fontWeight: '800',
    color: colors.text
  },
  tagline: {
    marginTop: spacing.xs,
    fontSize: fontSizes.md,
    color: colors.textMuted
  },
  list: {
    padding: spacing.md
  }
});
