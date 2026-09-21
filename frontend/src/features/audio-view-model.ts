export interface AudioChannelIdentity {
  id: string;
  name: string;
  channel: number;
}

export interface AudioChannelStatus extends AudioChannelIdentity {
  volume: number;
  muted: boolean;
}

export interface AudioOutputOverview {
  total: number;
  active: number;
  avgVol: number;
  playing: number;
}

export type StereoPartnerIds = Readonly<Record<string, string>>;

const LEFT_SUFFIX = '·左';
const RIGHT_SUFFIX = '·右';

/** Build symmetric left/right links only when both convention-based names exist. */
export function buildStereoPartnerIds<T extends AudioChannelIdentity>(
  channels: readonly T[],
): Record<string, string> {
  const byName = new Map(channels.map((channel) => [channel.name, channel.id]));
  const partners: Record<string, string> = {};
  for (const channel of channels) {
    if (!channel.name.endsWith(LEFT_SUFFIX)) continue;
    const rightId = byName.get(`${channel.name.slice(0, -LEFT_SUFFIX.length)}${RIGHT_SUFFIX}`);
    if (!rightId) continue;
    partners[channel.id] = rightId;
    partners[rightId] = channel.id;
  }
  return partners;
}

export function findStereoPartner<T extends AudioChannelIdentity>(
  channels: readonly T[],
  partnerIds: StereoPartnerIds,
  channel: T,
): T | undefined {
  const partnerId = partnerIds[channel.id];
  return partnerId ? channels.find((candidate) => candidate.id === partnerId) : undefined;
}

/** A complete stereo pair is represented by its left channel; unpaired right channels remain visible. */
export function filterVisibleAudioChannels<T extends AudioChannelIdentity>(
  channels: readonly T[],
  partnerIds: StereoPartnerIds,
): T[] {
  return channels.filter(
    (channel) => !(channel.name.endsWith(RIGHT_SUFFIX) && partnerIds[channel.id]),
  );
}

export function isStereoLeftChannel(
  channel: AudioChannelIdentity,
  partnerIds: StereoPartnerIds,
): boolean {
  return Boolean(partnerIds[channel.id]) && channel.name.endsWith(LEFT_SUFFIX);
}

export function audioChannelDisplayName(
  channel: AudioChannelIdentity,
  partnerIds: StereoPartnerIds,
): string {
  return isStereoLeftChannel(channel, partnerIds)
    ? channel.name.slice(0, -LEFT_SUFFIX.length)
    : channel.name;
}

export function audioChannelDisplayAddress<T extends AudioChannelIdentity>(
  channel: T,
  channels: readonly T[],
  partnerIds: StereoPartnerIds,
): string {
  const partner = findStereoPartner(channels, partnerIds, channel);
  return partner ? `${channel.id.toUpperCase()}+${partner.channel + 1}` : channel.id.toUpperCase();
}

export function stereoChannelRows<T extends AudioChannelIdentity>(
  channel: T,
  channels: readonly T[],
  partnerIds: StereoPartnerIds,
): T[] {
  const partner = findStereoPartner(channels, partnerIds, channel);
  return partner ? [channel, partner] : [channel];
}

export function stereoLeftChannelId(
  channel: AudioChannelIdentity,
  partnerIds: StereoPartnerIds,
): string | null {
  const partnerId = partnerIds[channel.id];
  if (!partnerId) return null;
  return channel.name.endsWith(LEFT_SUFFIX) ? channel.id : partnerId;
}

/** UI percentage (0..100) to EKX gain dB, matching the backend protocol curve. */
export function percentToGainDb(percent: number): number {
  if (percent <= 0) return -60;
  if (percent >= 100) return 12;
  if (percent < 50) return -60 + (percent / 50) * 50;
  return -10 + ((percent - 50) / 50) * 22;
}

export function gainDbToPercent(db: number): number {
  if (db <= -60) return 0;
  if (db >= 12) return 100;
  if (db < -10) return Math.round(((db + 60) / 50) * 50);
  return Math.round(50 + ((db + 10) / 22) * 50);
}

export function formatGainDb(db: number | null | undefined): string {
  if (db === null || db === undefined) return '—';
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

export interface VerticalTrackBounds {
  bottom: number;
  height: number;
}

export function faderPercentFromY(
  track: VerticalTrackBounds,
  clientY: number,
  step = 5,
): number {
  const ratio = track.height > 0 ? (track.bottom - clientY) / track.height : 0;
  const clamped = Math.max(0, Math.min(100, ratio * 100));
  return Math.round(clamped / step) * step;
}

export function formatAudioDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function summarizeAudioOutputs<T extends AudioChannelStatus>(
  visibleChannels: readonly T[],
  isPlaying: boolean,
): AudioOutputOverview {
  const activeChannels = visibleChannels.filter((channel) => !channel.muted);
  const avgVol = activeChannels.length === 0
    ? 0
    : Math.round(
      activeChannels.reduce((sum, channel) => sum + channel.volume, 0) / activeChannels.length,
    );
  return {
    total: visibleChannels.length,
    active: activeChannels.length,
    avgVol,
    playing: isPlaying ? 1 : 0,
  };
}
