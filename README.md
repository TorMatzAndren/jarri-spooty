# Spooty Hardened

Self-hosted Spotify playlist and track downloader built with NestJS + Angular.

Spooty does not download audio from Spotify itself.  
It retrieves metadata from Spotify and locates matching audio on YouTube.

This hardened branch focuses on:

- Large playlist support (>100 tracks)
- Spotify OAuth login flow
- Better YouTube pacing and throttling resistance
- Improved Docker deployment
- Safer credential handling
- More resilient cover-art embedding
- Better queue stability

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

~~~bash
sudo mkdir -p /etc/tokens

sudo tee /etc/tokens/spotify.env > /dev/null <<'EOF'
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
EOF

sudo chown root:$USER /etc/tokens/spotify.env
sudo chmod 640 /etc/tokens/spotify.env
~~~

Never commit this file.

---

# Docker Run

~~~bash
docker run --rm -p 3000:3000 \
  --env-file /etc/tokens/spotify.env \
  -e SPOTIFY_REDIRECT_URI='http://127.0.0.1:3000/api/spotify/callback' \
  -e AUTH_ENABLED=true \
  -e SPOOTY_AUTH_TOKEN=change_this_token \
  -e YT_SEARCH_DELAY_MS=7000 \
  -e YT_DOWNLOADS_PER_MINUTE=3 \
  -v "$PWD/downloads:/spooty/backend/downloads" \
  spootyfy-hardened:local
~~~

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

~~~yaml
services:
  spooty:
    image: spootyfy-hardened:local
    container_name: spooty
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
      YT_DOWNLOADS_PER_MINUTE: "3"

    volumes:
      - ./downloads:/spooty/backend/downloads
~~~

---

# Build From Source

## Requirements

- Node.js 20.20.0
- Docker
- ffmpeg
- Python3
- Redis

---

## Build

~~~bash
npm install
npm run build
~~~

---

## Run

~~~bash
npm run start
~~~

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
| YT_SEARCH_DELAY_MS | `5000` | Delay between YouTube searches |
| YT_DOWNLOADS_PER_MINUTE | `3` | Download pacing |
| YT_COOKIES | unset | Browser cookie extraction |
| YT_COOKIES_FILE | unset | Netscape cookies.txt path |

---

# YouTube Cookies

YouTube may throttle or block requests without cookies.

Two supported methods exist.

---

## Browser Cookies (Native Install Only)

~~~bash
YT_COOKIES=firefox
~~~

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

~~~bash
-v /path/to/cookies.txt:/spooty/config/cookies.txt
~~~

Then:

~~~bash
-e YT_COOKIES_FILE=/spooty/config/cookies.txt
~~~

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

~~~bash
-e YT_SEARCH_DELAY_MS=7000
-e YT_DOWNLOADS_PER_MINUTE=3
~~~

---

# Security Notes

Never commit:

- Spotify secrets
- OAuth tokens
- cookies.txt
- downloaded music
- local databases

Recommended `.gitignore` additions:

~~~gitignore
downloads/
config/
*.sqlite
cookies.txt
.env
.env.local
~~~

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

- Added configurable search pacing
- Added configurable download pacing
- Reduced aggressive YouTube request bursts
- Improved queue throttling behavior

### Backend

- Added safer queue pacing logic
- Added explicit search processor throttling
- Improved Docker runtime stability
- Improved logging around Spotify retrieval
- Added auth bootstrap flow support

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

~~~bash
docker run --rm -p 3000:3000 \
  --env-file /etc/tokens/spotify.env \
  -e SPOTIFY_REDIRECT_URI='http://127.0.0.1:3000/api/spotify/callback' \
  -e AUTH_ENABLED=true \
  -e SPOOTY_AUTH_TOKEN=test-token \
  -e YT_SEARCH_DELAY_MS=7000 \
  -e YT_DOWNLOADS_PER_MINUTE=3 \
  -v "$PWD/downloads:/spooty/backend/downloads" \
  spootyfy-hardened:local
~~~

---

# License

MIT
