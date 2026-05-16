# Jarri Spooty

Self-hosted Spotify playlist and track downloader built with NestJS + Angular.

Jarri Spooty does not download audio from Spotify itself.  
It retrieves metadata from Spotify and locates matching audio on YouTube.

This hardened branch focuses on:

- Large playlist support (>100 tracks)
- Spotify OAuth login flow
- Better YouTube pacing and throttling resistance
- Improved Docker deployment
- Safer credential handling
- More resilient cover-art embedding
- Better queue stability
- Deterministic YouTube fallback handling
- Explicit yt-dlp CLI execution
- Automatic failed-candidate rejection
- Improved age-gated video handling
- Persistent SQLite state across container restarts
- Deterministic Docker config persistence
- Improved operational observability
- Reduced unused dependency surface
- Hardened filename, cover-art, subprocess, and websocket boundaries

---

# Features

- Download Spotify playlists
- Download individual Spotify tracks
- Playlist auto-subscription support
- Automatic YouTube matching
- MP3 tagging and embedded cover art
- Docker deployment
- Queue-based download system
- Spotify OAuth integration
- Large playlist pagination support
- Download pacing controls
- YouTube cookie support
- Automatic YouTube retry/fallback handling
- Failed YouTube candidate rejection memory
- Deterministic yt-dlp error classification
- Hardened cover-art validation and embedding
- Explicit client-facing websocket payload shaping

---

# Important Notice

Use this software responsibly.

Only download music you legally own or are permitted to access.

The maintainers are not responsible for misuse.

---

# Supported URLs

- Spotify playlists
- Spotify tracks

Example:

    https://open.spotify.com/playlist/...
    https://open.spotify.com/track/...

---

# Quick Start (Recommended)

## 1. Create Spotify Developer App

Go to:

    https://developer.spotify.com/dashboard

Create an application.

Add this Redirect URI:

    http://127.0.0.1:3000/api/spotify/callback

Copy:

- Client ID
- Client Secret

---

## 2. Store Credentials Outside Repository

Create a secure env file:

```bash
sudo mkdir -p /etc/tokens

sudo tee /etc/tokens/spotify.env > /dev/null <<'EOF'
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
EOF

sudo chown root:$USER /etc/tokens/spotify.env
sudo chmod 640 /etc/tokens/spotify.env
```

Never commit this file.

---

## 3. Export YouTube Cookies (Recommended)

YouTube increasingly rate-limits or age-gates anonymous downloads.

Export a Netscape-format `cookies.txt` from a logged-in browser session.

Recommended storage:

```bash
sudo cp cookies.txt /etc/tokens/youtube.cookies.txt
sudo chown root:$USER /etc/tokens/youtube.cookies.txt
sudo chmod 640 /etc/tokens/youtube.cookies.txt
```

---

# Docker Run

```bash
docker run --rm -p 3000:3000 \
  --env-file /etc/tokens/spotify.env \
  -e SPOTIFY_REDIRECT_URI='http://127.0.0.1:3000/api/spotify/callback' \
  -e AUTH_ENABLED=true \
  -e SPOOTY_AUTH_TOKEN=change_this_token \
  -e YT_SEARCH_DELAY_MS=7000 \
  -e YT_DOWNLOADS_PER_MINUTE=6 \
  -e YT_COOKIES_FILE=/spooty/config/youtube.cookies.txt \
  -v "$PWD/downloads:/spooty/backend/downloads" \
  -v "$PWD/spooty-config:/spooty/backend/config" \
  -v "/etc/tokens/youtube.cookies.txt:/spooty/config/youtube.cookies.txt:ro" \
  jarri-spooty:local
```

Open:

    http://127.0.0.1:3000/?token=change_this_token

Then:

1. Click "Connect Spotify"
2. Login to Spotify
3. Approve access
4. Paste playlist URL
5. Download

---

# Docker Compose

```yaml
services:
  spooty:
    image: jarri-spooty:local
    container_name: jarri-spooty
    restart: unless-stopped

    ports:
      - "3000:3000"

    env_file:
      - /etc/tokens/spotify.env

    environment:
      SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3000/api/spotify/callback"
      AUTH_ENABLED: "true"
      SPOOTY_AUTH_TOKEN: "change_this_token"

      YT_SEARCH_DELAY_MS: "7000"
      YT_DOWNLOADS_PER_MINUTE: "6"

      YT_COOKIES_FILE: "/spooty/config/youtube.cookies.txt"

    volumes:
      - ./downloads:/spooty/backend/downloads
      - ./spooty-config:/spooty/backend/config
      - /etc/tokens/youtube.cookies.txt:/spooty/config/youtube.cookies.txt:ro
```

---

# Build From Source

## Requirements

- Node.js 20.20.0
- Docker
- ffmpeg
- Python3
- Redis
- yt-dlp

---

## Build

```bash
npm install
npm run build
docker build -t jarri-spooty:local .
```

---

## Run

```bash
npm run start
```

---

# Environment Variables

| Variable | Default | Description |
|---|---|---|
| DB_PATH | `./config/db.sqlite` | SQLite database path |
| DOWNLOADS_PATH | `./downloads` | Download directory |
| FORMAT | `mp3` | Output format |
| REDIS_HOST | `localhost` | Redis host |
| REDIS_PORT | `6379` | Redis port |
| SPOTIFY_CLIENT_ID | unset | Spotify client ID |
| SPOTIFY_CLIENT_SECRET | unset | Spotify client secret |
| SPOTIFY_REDIRECT_URI | unset | OAuth callback URI |
| AUTH_ENABLED | `false` | Enable frontend token auth |
| SPOOTY_AUTH_TOKEN | unset | Frontend auth token |
| YT_SEARCH_DELAY_MS | `7000` | Delay between YouTube searches |
| YT_DOWNLOADS_PER_MINUTE | `6` | Download pacing |
| YT_COOKIES | unset | Browser cookie extraction |
| YT_COOKIES_FILE | unset | Netscape cookies.txt path |

---

# YouTube Cookies

YouTube may throttle or block requests without cookies.

Two supported methods exist.

---

## Browser Cookies (Native Install Only)

```bash
YT_COOKIES=firefox
```

Supported:

- firefox
- chrome
- chromium
- edge
- brave
- opera

This does NOT work reliably in Docker.

---

## Cookies File (Recommended)

Export a Netscape-format `cookies.txt`.

Mount into container:

```bash
-v /path/to/cookies.txt:/spooty/config/youtube.cookies.txt:ro
```

Then:

```bash
-e YT_COOKIES_FILE=/spooty/config/youtube.cookies.txt
```

---

# Deterministic YouTube Fallback Handling

The hardened branch now uses direct `yt-dlp` CLI execution rather than relying entirely on wrapper abstractions.

This provides:

- Explicit stderr visibility
- Better Docker compatibility
- Deterministic retry handling
- Automatic failed-candidate rejection
- Better age-gated video handling
- Improved operational observability

If a YouTube candidate fails:

1. The failed URL is recorded
2. The candidate is rejected
3. A new YouTube search is performed
4. The next-best valid candidate is attempted automatically

This prevents infinite retry loops against dead or restricted videos.

---

# Persistent Docker State

The hardened Docker flow strongly recommends persistent bind mounts for:

- downloads
- SQLite database
- runtime config

Recommended:

```bash
-v "$PWD/downloads:/spooty/backend/downloads" \
-v "$PWD/spooty-config:/spooty/backend/config"
```

This prevents:

- database resets on container recreation
- queue state loss
- retry-state loss
- playlist metadata loss

---

# Large Playlist Support

The hardened branch fixes several Spotify API limitations:

- Proper playlist pagination
- >100 track playlists
- OAuth-authenticated playlist access
- Queue stability improvements

Verified working with playlists containing 300+ tracks.

---

# Queue Pacing

Aggressive YouTube access can trigger:

- HTTP 302 loops
- CAPTCHA
- temporary throttling
- incomplete downloads

Recommended safe pacing:

```bash
-e YT_SEARCH_DELAY_MS=7000
-e YT_DOWNLOADS_PER_MINUTE=6
```

The hardened branch also includes additional internal pacing and retry coordination to reduce:

- repeated failed candidate loops
- aggressive retry bursts
- queue collisions
- YouTube anti-bot triggers

---

# yt-dlp Notes

Modern YouTube behavior changes frequently.

The hardened branch now:

- Uses explicit yt-dlp CLI execution
- Captures stderr deterministically
- Detects age-gated failures
- Detects missing downloadable formats
- Handles retry/fallback selection explicitly

Some videos may still fail due to:

- regional restrictions
- removed videos
- YouTube anti-bot measures
- invalid cookies
- unavailable formats

Recommended:

- fresh cookies.txt exports
- authenticated YouTube sessions
- moderate pacing settings

---

# Security Notes

Never commit:

- Spotify secrets
- OAuth tokens
- cookies.txt
- downloaded music
- local databases
- spooty-config/

Recommended `.gitignore` additions:

```gitignore
downloads/
config/
spooty-config/
*.sqlite
cookies.txt
.env
.env.local
```

---

# Hardened Branch Changelog

## Unreleased Hardened Changes

### Spotify

- Added Spotify OAuth login flow
- Added persistent Spotify user token storage
- Added authenticated playlist retrieval
- Fixed large playlist pagination
- Fixed playlist truncation at 100 tracks
- Added playlist retrieval debugging
- Added OAuth status endpoint

### YouTube

- Added deterministic YouTube candidate scoring
- Added duration-aware YouTube matching
- Added failed-candidate rejection memory
- Added automatic retry/fallback handling
- Added explicit YouTube candidate exclusion support
- Added detailed YouTube candidate debug logging
- Added explicit yt-dlp CLI execution
- Added deterministic yt-dlp stderr capture
- Added age-gated video detection
- Added invalid-format detection
- Added Docker-compatible cookie handling
- Added temporary cookie-copy isolation
- Added retry-aware queue coordination

### Backend

- Added safer queue pacing logic
- Added explicit search processor throttling
- Improved Docker runtime stability
- Improved logging around Spotify retrieval
- Added auth bootstrap flow support
- Added deterministic retry-state handling

### Frontend

- Added Spotify login integration
- Added frontend auth token bootstrap
- Fixed playlist progress handling for large playlists
- Improved playlist rendering stability

### Security

- Moved secrets to external env files
- Improved Docker secret handling recommendations
- Added security documentation
- Prevented accidental secret inclusion in repository

---

# Development Notes

Recommended local test run:

```bash
docker run --rm -p 3000:3000 \
  --env-file /etc/tokens/spotify.env \
  -e SPOTIFY_REDIRECT_URI='http://127.0.0.1:3000/api/spotify/callback' \
  -e AUTH_ENABLED=true \
  -e SPOOTY_AUTH_TOKEN=test-token \
  -e YT_SEARCH_DELAY_MS=7000 \
  -e YT_DOWNLOADS_PER_MINUTE=6 \
  -e YT_COOKIES_FILE=/spooty/config/youtube.cookies.txt \
  -v "$PWD/downloads:/spooty/backend/downloads" \
  -v "$PWD/spooty-config:/spooty/backend/config" \
  -v "/etc/tokens/youtube.cookies.txt:/spooty/config/youtube.cookies.txt:ro" \
  jarri-spooty:local
```

---

# License

MIT
