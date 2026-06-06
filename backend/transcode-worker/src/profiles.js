'use strict';

const AAC_PROFILES = [
  { tag: 'aac_128', bitrate: 128000, codec: 'aac', sampleRate: 44100, channels: 2, container: 'm4a', contentType: 'audio/mp4' },
  { tag: 'aac_256', bitrate: 256000, codec: 'aac', sampleRate: 48000, channels: 2, container: 'm4a', contentType: 'audio/mp4' },
];

const OPUS_PROFILES = [
  { tag: 'opus_64',  bitrate: 64000,  codec: 'libopus', sampleRate: 48000, channels: 2, container: 'webm', contentType: 'audio/webm' },
  { tag: 'opus_128', bitrate: 128000, codec: 'libopus', sampleRate: 48000, channels: 2, container: 'webm', contentType: 'audio/webm' },
  { tag: 'opus_256', bitrate: 256000, codec: 'libopus', sampleRate: 48000, channels: 2, container: 'webm', contentType: 'audio/webm' },
];

const LOSSLESS_PROFILE = {
  tag: 'flac', bitrate: 0, codec: 'flac', sampleRate: 0, channels: 0, container: 'flac', contentType: 'audio/flac',
};

const LOSSY_CODEC_HEADROOM_BPS = 32000;

function filterApplicableProfiles(sourceBitrate, sourceSampleRate, sourceIsLossless) {
  const profiles = [];

  for (const p of OPUS_PROFILES) {
    if (!sourceBitrate) {
      profiles.push(p);
      continue;
    }
    if (sourceIsLossless || p.bitrate <= sourceBitrate + LOSSY_CODEC_HEADROOM_BPS) {
      profiles.push(p);
    }
  }

  for (const p of AAC_PROFILES) {
    if (!sourceBitrate) {
      profiles.push(p);
      continue;
    }
    if (sourceIsLossless || p.bitrate <= sourceBitrate + LOSSY_CODEC_HEADROOM_BPS) {
      profiles.push(p);
    }
  }

  if (sourceIsLossless && sourceSampleRate) {
    profiles.push({
      ...LOSSLESS_PROFILE,
      sampleRate: sourceSampleRate,
    });
  }

  return profiles;
}

module.exports = { AAC_PROFILES, OPUS_PROFILES, LOSSLESS_PROFILE, filterApplicableProfiles };
