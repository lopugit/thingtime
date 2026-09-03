import React from 'react';

import { LopuPage } from './LopuPage';

// 🎙️ Compatibility wrapper for /lopu/voice (the iOS app deep-links here and
// drives the microphone through the native bridge): the Lopu page in voice
// mode. The engine itself lives in LopuVoiceControls (`useLopuVoice`); the
// page frame, conversations and the shared chat column are LopuPage's.
export const LopuVoiceChat = () => <LopuPage mode="voice" />;
