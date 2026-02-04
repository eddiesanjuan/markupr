/**
 * Audio Module - Main Process
 *
 * Re-exports the production AudioCapture service.
 * This is the primary entry point for audio capture functionality.
 */

import audioCapture from './AudioCapture';

export {
  audioCapture,
  AudioCaptureServiceImpl,
  AUDIO_IPC_CHANNELS,
  type AudioCaptureService,
  type AudioDevice,
  type AudioChunk,
  type AudioCaptureConfig,
} from './AudioCapture';

export default audioCapture;
