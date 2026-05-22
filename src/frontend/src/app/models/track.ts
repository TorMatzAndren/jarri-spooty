export interface Track {
  id: number;
  artist: string;
  name: string;
  spotifyUrl: string;
  youtubeUrl: string;
  rejectedYoutubeUrls?: string[] | string;
  downloadAttemptCount?: number;
  status: TrackStatusEnum;
  playlistId?: number;
  error?: string;
  coverUrl?: string;
  durationMs?: number;
  createdAt?: number;
}

export enum TrackStatusEnum {
  New,
  Searching,
  Queued,
  Downloading,
  Completed,
  Error,
}
