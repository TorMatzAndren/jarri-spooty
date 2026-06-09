# Spooty Operations Snapshot

`GET /api/operations/snapshot` exposes backend-owned operational truth for Workspace and other clients.

The MVP reports truth Spooty already owns without a schema migration:

- track state from `TrackEntity.status`
- selected YouTube URL from `TrackEntity.youtubeUrl`
- selected YouTube candidate title, author, score, and reason from `TrackEntity`
- raw failure evidence from `TrackEntity.error`
- download retry count from `TrackEntity.downloadAttemptCount`
- rejected YouTube candidates from `TrackEntity.rejectedYoutubeUrls`
- playlist and single-song counts from `PlaylistEntity.isTrack`
- queue depth and active jobs from BullMQ queues `track-search-processor` and `track-download-processor`
- Spotify connection presence from the stored Spotify user token

The endpoint intentionally does not infer candidate scoring history. Selected candidate metadata is persisted when Spooty chooses a candidate. Rejected candidates are still persisted only as URL strings.

Future persistence work is required for:

- full searched candidate history
- structured rejected candidate metadata beyond URL
- structured error class fields stored at write time instead of classified from the persisted raw error string
- operation attempt history across search and download phases
