import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '~/theme';

type Props = {
  height?: number;
  style?: ViewStyle;
};

// A thin horizontal rainbow band — the recurring Thingtime motif (🌈).
export function RainbowBar({ height = 6, style }: Props) {
  return (
    <View style={[styles.wrap, { height }, style]}>
      <LinearGradient colors={colors.rainbowGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    overflow: 'hidden'
  }
});
