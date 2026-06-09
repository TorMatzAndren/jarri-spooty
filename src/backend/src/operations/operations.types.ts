export type SpootyOperation =
  | 'idle'
  | 'searching'
  | 'downloading'
  | 'retrying'
  | 'degraded';

export type ErrorClass =
  | 'YOUTUBE_VIDEO_UNAVAILABLE'
  | 'YOUTUBE_AGE_GATED'
  | 'YOUTUBE_NO_FORMATS'
  | 'YOUTUBE_PRIVATE_VIDEO'
  | 'YOUTUBE_WEBPAGE_UNAVAILABLE'
  | 'YOUTUBE_EXTRACTION_FAILURE'
  | 'NO_ACCEPTABLE_CANDIDATE'
  | 'FILE_WRITE_FAILED'
  | 'UNKNOWN_DOWNLOAD_ERROR';

export interface TrackTruth {
  id: number;
  artist: string;
  name: string;
  status: string;
  spotifyUrl?: string;
  youtubeUrl?: string;
  downloadAttemptCount?: number;
  errorClass?: ErrorClass;
  errorSummary?: string;
  errorDetail?: string;
  rejectedCandidateCount: number;
  rejectedCandidates: string[];
}

export interface FailureTruth extends TrackTruth {}

export interface OperationsSnapshot {
  generatedAt: string;
  runtime: {
    operation: SpootyOperation;
    spotifyConnected: boolean;
    searchQueueDepth: number;
    downloadQueueDepth: number;
    activeSearches: number;
    activeDownloads: number;
  };
  counters: {
    playlists: number;
    singleSongs: number;
    tracks: number;
    active: number;
    completed: number;
    failed: number;
    retries: number;
  };
  active: {
    searching: TrackTruth[];
    downloading: TrackTruth[];
  };
  recentFailures: FailureTruth[];
  recentTracks: TrackTruth[];
}
