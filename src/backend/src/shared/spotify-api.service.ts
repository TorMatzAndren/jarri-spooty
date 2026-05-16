import { Injectable, Logger } from '@nestjs/common';
import { resolve, dirname } from 'path';
import * as fs from 'fs';
import { EnvironmentEnum } from '../environmentEnum';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const fetch = require('isomorphic-unfetch');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDetails } = require('spotify-url-info')(fetch);

interface StoredSpotifyUserToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope?: string;
  token_type?: string;
}

@Injectable()
export class SpotifyApiService {
  private readonly logger = new Logger(SpotifyApiService.name);
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  private getPlaylistId(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const playlistIndex = pathParts.findIndex((part) => part === 'playlist');
      if (playlistIndex >= 0 && pathParts.length > playlistIndex + 1) {
        return pathParts[playlistIndex + 1].split('?')[0];
      }
      throw new Error('Invalid Spotify playlist URL');
    } catch (error) {
      this.logger.error(`Failed to extract playlist ID: ${error.message}`);
      throw error;
    }
  }

  isTrackUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname.includes('/track/');
    } catch {
      return false;
    }
  }

  private getTrackId(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const trackIndex = pathParts.findIndex((part) => part === 'track');
      if (trackIndex >= 0 && pathParts.length > trackIndex + 1) {
        return pathParts[trackIndex + 1].split('?')[0];
      }
      throw new Error('Invalid Spotify track URL');
    } catch (error) {
      this.logger.error(`Failed to extract track ID: ${error.message}`);
      throw error;
    }
  }

  isArtistUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname.includes('/artist/');
    } catch {
      return false;
    }
  }

  private getArtistId(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const artistIndex = pathParts.findIndex((part) => part === 'artist');
      if (artistIndex >= 0 && pathParts.length > artistIndex + 1) {
        return pathParts[artistIndex + 1].split('?')[0];
      }
      throw new Error('Invalid Spotify artist URL');
    } catch (error) {
      this.logger.error(`Failed to extract artist ID: ${error.message}`);
      throw error;
    }
  }

  private getClientId(): string {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    if (!clientId) {
      throw new Error('Missing SPOTIFY_CLIENT_ID');
    }
    return clientId;
  }

  private getClientSecret(): string {
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    if (!clientSecret) {
      throw new Error('Missing SPOTIFY_CLIENT_SECRET');
    }
    return clientSecret;
  }

  private getRedirectUri(): string {
    return (
      process.env[EnvironmentEnum.SPOTIFY_REDIRECT_URI] ||
      'http://127.0.0.1:3000/api/spotify/callback'
    );
  }

  private getTokenPath(): string {
    if (process.env[EnvironmentEnum.SPOTIFY_TOKEN_PATH]) {
      return process.env[EnvironmentEnum.SPOTIFY_TOKEN_PATH];
    }

    const dbPath = process.env[EnvironmentEnum.DB_PATH] || './config/db.sqlite';
    return resolve(dirname(resolve(__dirname, dbPath)), 'spotify-user-token.json');
  }

  private getBasicAuthHeader(): string {
    const credentials = Buffer.from(
      `${this.getClientId()}:${this.getClientSecret()}`,
    ).toString('base64');
    return `Basic ${credentials}`;
  }

  private readUserToken(): StoredSpotifyUserToken | null {
    const tokenPath = this.getTokenPath();

    if (!fs.existsSync(tokenPath)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
    } catch (error) {
      this.logger.error(`Failed to read Spotify user token: ${error.message}`);
      return null;
    }
  }

  private writeUserToken(token: StoredSpotifyUserToken): void {
    const tokenPath = this.getTokenPath();
    fs.mkdirSync(dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }

  async hasUserToken(): Promise<boolean> {
    return !!this.readUserToken();
  }

  getAuthorizationUrl(): string {
    const url = new URL('https://accounts.spotify.com/authorize');

    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.getClientId());
    url.searchParams.set(
      'scope',
      [
        'playlist-read-private',
        'playlist-read-collaborative',
        'user-read-private',
      ].join(' '),
    );
    url.searchParams.set('redirect_uri', this.getRedirectUri());
    url.searchParams.set('show_dialog', 'true');

    return url.toString();
  }

  async exchangeAuthorizationCode(code: string): Promise<void> {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: this.getBasicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.getRedirectUri(),
      }).toString(),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Failed to exchange Spotify authorization code: ${errorData}`);
    }

    const data = await response.json();

    this.writeUserToken({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000 - 60_000,
      scope: data.scope,
      token_type: data.token_type,
    });

    this.logger.debug('Stored Spotify user access token');
  }

  private async refreshUserAccessToken(
    token: StoredSpotifyUserToken,
  ): Promise<StoredSpotifyUserToken> {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: this.getBasicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token,
      }).toString(),
    });

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`Failed to refresh Spotify user token: ${errorData}`);
    }

    const data = await response.json();
    const refreshed = {
      ...token,
      access_token: data.access_token,
      refresh_token: data.refresh_token || token.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000 - 60_000,
      scope: data.scope || token.scope,
      token_type: data.token_type || token.token_type,
    };

    this.writeUserToken(refreshed);
    return refreshed;
  }

  private async getUserAccessToken(): Promise<string> {
    const token = this.readUserToken();

    if (!token) {
      throw new Error('Spotify user is not connected. Open /api/spotify/login first.');
    }

    if (Date.now() < token.expires_at) {
      return token.access_token;
    }

    return (await this.refreshUserAccessToken(token)).access_token;
  }

  async getTrackMetadata(
    spotifyUrl: string,
  ): Promise<{ name: string; artist: string; image: string; durationMs?: number }> {
    try {
      this.logger.debug(`Getting track metadata for ${spotifyUrl}`);
      const trackId = this.getTrackId(spotifyUrl);
      const accessToken = await this.getClientCredentialsAccessToken();

      const response = await fetch(
        `https://api.spotify.com/v1/tracks/${trackId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch track: ${response.status}`);
      }

      const data = await response.json();

      return {
        name: data.name,
        artist: data.artists.map((a) => a.name).join(', '),
        image: data.album.images[0]?.url || '',
        durationMs: data.duration_ms,
      };
    } catch (error) {
      this.logger.error(`Failed to get track metadata: ${error.message}`);
      throw error;
    }
  }

  async getPlaylistMetadata(
    spotifyUrl: string,
  ): Promise<{ name: string; image: string }> {
    try {
      this.logger.debug(`Getting playlist metadata for ${spotifyUrl}`);
      const detail = await getDetails(spotifyUrl);

      return {
        name: detail.preview.title,
        image: detail.preview.image,
      };
    } catch (error) {
      this.logger.error(`Failed to get playlist metadata: ${error.message}`);
      throw error;
    }
  }

  private async getClientCredentialsAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      this.logger.debug('Getting new Spotify client credentials access token');

      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: this.getBasicAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to get access token: ${errorData}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + data.expires_in * 1000 - 60000;

      this.logger.debug('Successfully obtained Spotify client credentials access token');
      return this.accessToken;
    } catch (error) {
      this.logger.error(`Error getting Spotify access token: ${error.message}`);
      throw error;
    }
  }

  async getAllPlaylistTracks(spotifyUrl: string): Promise<any[]> {
    try {
      this.logger.debug(`Getting all tracks for playlist ${spotifyUrl}`);

      const playlistId = this.getPlaylistId(spotifyUrl);
      this.logger.debug(`Extracted playlist ID: ${playlistId}`);

      const accessToken = await this.getUserAccessToken();

      const allTracks = [];
      let offset = 0;
      let hasMoreTracks = true;

      while (hasMoreTracks) {
        this.logger.debug(
          `Fetching tracks from Spotify API with offset ${offset}`,
        );

        const response = await fetch(
          `https://api.spotify.com/v1/playlists/${playlistId}/items?offset=${offset}&limit=100`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          this.logger.error(
            `Spotify API error: ${response.status} ${errorText}`,
          );

          if (response.status === 403) {
            throw new Error(
              'Spotify API refused playlist item access with 403 Forbidden. Connect Spotify through /api/spotify/login and ensure the authenticated user can access this playlist.',
            );
          }

          throw new Error(`Failed to fetch tracks: ${response.status}`);
        }

        const data = await response.json();

        if (!data.items || data.items.length === 0) {
          this.logger.debug('No more tracks to fetch from Spotify API');
          hasMoreTracks = false;
          continue;
        }

        const pageTracks = data.items
          .map(
            (item: {
              item: {
                id: string;
                name: any;
                artists: any[];
                preview_url: any;
                album: { images: any[] };
                duration_ms?: number;
              };
            }) => {
              if (!item.item) return null;

              return {
                id: item.item.id,
                name: item.item.name,
                artist: item.item.artists.map((a) => a.name).join(', '),
                previewUrl: item.item.preview_url,
                coverUrl: item.item.album?.images?.[0]?.url || null,
                durationMs: item.item.duration_ms,
              };
            },
          )
          .filter((track) => track !== null);

        this.logger.debug(
          `Retrieved ${pageTracks.length} tracks from Spotify API at offset ${offset}`,
        );

        if (pageTracks.length > 0) {
          allTracks.push(...pageTracks);
        }

        if (!data.next) {
          hasMoreTracks = false;
        } else {
          offset += 100;
        }
      }

      this.logger.debug(
        `Total tracks retrieved from Spotify API: ${allTracks.length}`,
      );
      return allTracks;
    } catch (error) {
      this.logger.error(`Failed to get all playlist tracks: ${error.message}`);
      throw error;
    }
  }

  async getArtistLibrary(
    spotifyUrl: string,
  ): Promise<{ name: string; image: string; tracks: any[] }> {
    try {
      this.logger.debug(`Getting artist library for ${spotifyUrl}`);
      const artistId = this.getArtistId(spotifyUrl);
      const accessToken = await this.getUserAccessToken();

      const artistResponse = await fetch(
        `https://api.spotify.com/v1/artists/${artistId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!artistResponse.ok) {
        const errorText = await artistResponse.text();
        throw new Error(`Failed to fetch artist metadata: ${artistResponse.status} ${errorText}`);
      }

      const artist = await artistResponse.json();
      const albums = await this.getAllArtistAlbums(artistId, accessToken);
      const tracks = await this.getTracksForAlbums(albums, accessToken, artist.name);

      return {
        name: `Artist Library: ${artist.name}`,
        image: artist.images?.[0]?.url || '',
        tracks,
      };
    } catch (error) {
      this.logger.error(`Failed to get artist library: ${error.message}`);
      throw error;
    }
  }

  private async getAllArtistAlbums(artistId: string, accessToken: string): Promise<any[]> {
    const includeGroups = process.env.SPOTIFY_ARTIST_INCLUDE_GROUPS || 'album,single';
    const albumByKey = new Map<string, any>();
    const artistAlbumPageLimit = 20;
    let offset = 0;
    let hasMoreAlbums = true;

    while (hasMoreAlbums) {
      this.logger.debug(
        `Fetching artist albums from Spotify API with offset ${offset}`,
      );

      const albumUrl = new URL(
        `https://api.spotify.com/v1/artists/${artistId}/albums`,
      );
      albumUrl.searchParams.set('include_groups', includeGroups);
      albumUrl.searchParams.set('offset', String(offset));

      this.logger.debug(`Spotify artist albums URL: ${albumUrl.toString()}`);

      const response = await fetch(albumUrl.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch artist albums: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      for (const album of data.items || []) {
        const key = this.normalizeLibraryKey(`${album.name}|${album.release_date}|${album.total_tracks}`);
        if (!albumByKey.has(key)) {
          albumByKey.set(key, album);
        }
      }

      if (!data.next) {
        hasMoreAlbums = false;
      } else {
        offset += artistAlbumPageLimit;
      }
    }

    const albums = [...albumByKey.values()];
    this.logger.debug(`Retrieved ${albums.length} deduplicated artist albums/singles`);
    return albums;
  }

  private async getTracksForAlbums(
    albums: any[],
    accessToken: string,
    artistName: string,
  ): Promise<any[]> {
    const trackByKey = new Map<string, any>();
    const maxTracks = Number(process.env.SPOTIFY_ARTIST_LIBRARY_MAX_TRACKS || 1000);

    for (const album of albums) {
      let offset = 0;
      let hasMoreTracks = true;

      while (hasMoreTracks) {
        const response = await fetch(
          `https://api.spotify.com/v1/albums/${album.id}/tracks?limit=50&offset=${offset}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to fetch album tracks: ${response.status} ${errorText}`);
        }

        const data = await response.json();

        for (const item of data.items || []) {
          if (!item?.name || !item?.artists?.length) {
            continue;
          }

          const fullTrack = await this.getTrackById(item.id, accessToken);
          const isrc = fullTrack?.external_ids?.isrc;
          const durationMs = fullTrack?.duration_ms || item.duration_ms;
          const artist = item.artists.map((a) => a.name).join(', ');
          const key = isrc
            ? `isrc:${isrc}`
            : this.normalizeLibraryKey(`${artist}|${item.name}|${Math.round((durationMs || 0) / 2000)}`);

          if (!trackByKey.has(key)) {
            trackByKey.set(key, {
              id: item.id,
              name: item.name,
              artist,
              previewUrl: item.external_urls?.spotify || null,
              coverUrl: album.images?.[0]?.url || null,
              durationMs,
              albumName: album.name,
              primaryArtist: artistName,
            });
          }

          if (trackByKey.size >= maxTracks) {
            this.logger.warn(`Artist library max track limit reached: ${maxTracks}`);
            return [...trackByKey.values()];
          }
        }

        if (!data.next) {
          hasMoreTracks = false;
        } else {
          offset += 50;
        }
      }
    }

    const tracks = [...trackByKey.values()];
    this.logger.debug(`Retrieved ${tracks.length} deduplicated artist library tracks`);
    return tracks;
  }

  private async getTrackById(trackId: string, accessToken: string): Promise<any> {
    const response = await fetch(
      `https://api.spotify.com/v1/tracks/${trackId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      return null;
    }

    return response.json();
  }

  private normalizeLibraryKey(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

}
