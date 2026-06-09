export interface SelectedCandidateTruth {
  url: string;
  title?: string;
  author?: string;
  score?: number;
  reason?: string;
}

export interface RejectedCandidateTruth {
  url: string;
  title?: string;
  author?: string;
  score?: number;
  reason?: string;
  rejectionClass?: string;
  rejectionSummary?: string;
  rejectedAt?: string;
}

export interface TrackTruth {
  id: number;
  artist: string;
  name: string;
  status: string;
  spotifyUrl?: string;
  youtubeUrl?: string;
  selectedCandidate?: SelectedCandidateTruth;
  downloadAttemptCount?: number;
  errorClass?: string;
  errorSummary?: string;
  errorDetail?: string;
  rejectedCandidateCount: number;
  rejectedCandidates: RejectedCandidateTruth[];
}

export interface OperationsSnapshot {
  generatedAt: string;
  runtime: {
    operation: string;
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
  recentFailures: TrackTruth[];
  recentTracks: TrackTruth[];
}
