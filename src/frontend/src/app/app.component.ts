import {Component} from '@angular/core';
import {FormsModule} from "@angular/forms";
import {CommonModule, NgFor} from "@angular/common";
import {PlaylistService, PlaylistStatusEnum} from "./services/playlist.service";
import {PlaylistBoxComponent} from "./components/playlist-box/playlist-box.component";
import {VersionService} from "./services/version.service";
import {map} from "rxjs";

@Component({
    selector: 'app-root',
    imports: [CommonModule, FormsModule, NgFor, PlaylistBoxComponent],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss',
    standalone: true,
})
export class AppComponent {

  url = ''
  private readonly spotifyUrlPattern = /^https:\/\/open\.spotify\.com\/(track|playlist|album|artist)\/[a-zA-Z0-9]+/;

  get isValidSpotifyUrl(): boolean {
    return this.spotifyUrlPattern.test(this.url);
  }
  createLoading$ = this.playlistService.createLoading$;
  playlists$ = this.playlistService.all$.pipe(map(items => items.filter(item => !item.isTrack)));
  songs$ = this.playlistService.all$.pipe(map(items => items.filter(item => item.isTrack)));
  version = this.versionService.getVersion();

  constructor(
    private readonly playlistService: PlaylistService,
    private readonly versionService: VersionService,
  ) {
    this.bootstrapAuthTokenFromUrl();
    this.fetchPlaylists();
  }

  private bootstrapAuthTokenFromUrl(): void {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token');

    if (!token) {
      return;
    }

    localStorage.setItem('spooty_auth_token', token);
    url.searchParams.delete('token');
    window.history.replaceState({}, document.title, url.toString());
  }

  fetchPlaylists(): void {
    this.playlistService.fetch();
  }

  download(): void {
    this.url && this.playlistService.create(this.url);
    this.url = '';
  }

  deleteCompleted(): void {
    this.playlistService.deleteAllByStatus(PlaylistStatusEnum.Completed);
  }

  deleteFailed(): void {
    this.playlistService.deleteAllByStatus(PlaylistStatusEnum.Error);
  }
}
