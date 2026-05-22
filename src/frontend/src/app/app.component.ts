import {Component, OnDestroy} from '@angular/core';
import {FormsModule} from "@angular/forms";
import {CommonModule, NgFor} from "@angular/common";
import {PlaylistService, PlaylistStatusEnum} from "./services/playlist.service";
import {PlaylistBoxComponent} from "./components/playlist-box/playlist-box.component";
import {VersionService} from "./services/version.service";
import {map} from "rxjs";
import {HttpClient} from "@angular/common/http";
import {ArchiveService} from "./services/archive.service";
import {ArchiveFile, ArchiveListing} from "./models/archive";
import {Track, TrackStatusEnum} from "./models/track";
import {TrackService} from "./services/track.service";

export type SpootyPanelType =
  'source-intake'
  | 'queue-observatory'
  | 'playlist-history'
  | 'single-songs'
  | 'archive-browser'
  | 'candidate-inspector';

export interface SpootyPanelInstance {
  id: string;
  type: SpootyPanelType;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpootyWorkspaceState {
  panels: SpootyPanelInstance[];
}

export type SpootyWorkspaceTab = 'intake' | 'archive' | 'diagnostics';
export type ArchiveSortMode = 'newest' | 'name' | 'size';

export interface SpootyWorkspaceTabsState {
  activeTab: SpootyWorkspaceTab;
  tabs: Record<SpootyWorkspaceTab, SpootyWorkspaceState>;
}

const WORKSPACE_STORAGE_KEY = 'jarri_spooty_workspace_state_v1';
const WORKSPACE_TABS_STORAGE_KEY = 'jarri_spooty_workspace_tabs_v1';
const ARCHIVE_DESTINATION_KEY = 'jarri_spooty_archive_destination_v1';
const GRID_SIZE = 12;
const MIN_PANEL_WIDTH = 260;
const MIN_PANEL_HEIGHT = 160;

const PANEL_TITLES: Record<SpootyPanelType, string> = {
  'source-intake': 'Source Intake',
  'queue-observatory': 'Queue Observatory',
  'playlist-history': 'Playlist History',
  'single-songs': 'Single Songs',
  'archive-browser': 'Archive Browser',
  'candidate-inspector': 'Candidate Inspector',
};

const WORKSPACE_TAB_LABELS: Record<SpootyWorkspaceTab, string> = {
  intake: 'Intake',
  archive: 'Archive',
  diagnostics: 'Diagnostics',
};

const DEFAULT_TAB_PANELS: Record<SpootyWorkspaceTab, SpootyPanelInstance[]> = {
  intake: [
    makePanel('source-intake', 24, 24, 520, 336, 'intake-source-intake'),
    makePanel('queue-observatory', 568, 24, 520, 260, 'intake-queue-observatory'),
    makePanel('playlist-history', 24, 392, 760, 448, 'intake-playlist-history'),
    makePanel('single-songs', 820, 392, 520, 448, 'intake-single-songs'),
  ],
  archive: [
    makePanel('archive-browser', 24, 24, 900, 720, 'archive-archive-browser'),
    makePanel('source-intake', 960, 24, 420, 336, 'archive-source-intake'),
    makePanel('queue-observatory', 960, 396, 420, 260, 'archive-queue-observatory'),
  ],
  diagnostics: [
    makePanel('candidate-inspector', 24, 24, 620, 720, 'diagnostics-candidate-inspector'),
    makePanel('playlist-history', 680, 24, 620, 520, 'diagnostics-playlist-history'),
    makePanel('queue-observatory', 1320, 24, 420, 260, 'diagnostics-queue-observatory'),
    makePanel('archive-browser', 1320, 320, 420, 420, 'diagnostics-archive-browser'),
  ],
};

export function makePanel(
  type: SpootyPanelType,
  x = 48,
  y = 48,
  w = 520,
  h = 320,
  id = `${type}-${Date.now()}`,
): SpootyPanelInstance {
  return {
    id,
    type,
    title: PANEL_TITLES[type],
    x,
    y,
    w,
    h,
  };
}

export function defaultWorkspaceState(): SpootyWorkspaceState {
  return defaultWorkspaceStateForTab('intake');
}

export function defaultWorkspaceStateForTab(tab: SpootyWorkspaceTab): SpootyWorkspaceState {
  return {
    panels: DEFAULT_TAB_PANELS[tab].map(panel => ({...panel})),
  };
}

export function defaultWorkspaceTabsState(): SpootyWorkspaceTabsState {
  return {
    activeTab: 'intake',
    tabs: {
      intake: defaultWorkspaceStateForTab('intake'),
      archive: defaultWorkspaceStateForTab('archive'),
      diagnostics: defaultWorkspaceStateForTab('diagnostics'),
    },
  };
}

export function loadWorkspaceState(): SpootyWorkspaceState {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);

    if (!raw) {
      return defaultWorkspaceState();
    }

    const parsed = JSON.parse(raw) as SpootyWorkspaceState;
    const panels = parsed.panels
      ?.filter(panel => panel?.id && panel?.type && PANEL_TITLES[panel.type])
      .map(panel => ({
        ...panel,
        title: PANEL_TITLES[panel.type],
        x: snap(panel.x),
        y: snap(panel.y),
        w: Math.max(MIN_PANEL_WIDTH, snap(panel.w)),
        h: Math.max(MIN_PANEL_HEIGHT, snap(panel.h)),
      }));

    return panels?.length ? {panels} : defaultWorkspaceState();
  } catch {
    return defaultWorkspaceState();
  }
}

export function loadWorkspaceTabsState(): SpootyWorkspaceTabsState {
  try {
    const raw = localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY);

    if (raw) {
      const parsed = JSON.parse(raw) as SpootyWorkspaceTabsState;
      return {
        activeTab: parsed.activeTab && WORKSPACE_TAB_LABELS[parsed.activeTab] ? parsed.activeTab : 'intake',
        tabs: {
          intake: sanitizeWorkspaceState(parsed.tabs?.intake, defaultWorkspaceStateForTab('intake')),
          archive: sanitizeWorkspaceState(parsed.tabs?.archive, defaultWorkspaceStateForTab('archive')),
          diagnostics: sanitizeWorkspaceState(parsed.tabs?.diagnostics, defaultWorkspaceStateForTab('diagnostics')),
        },
      };
    }

    return {
      ...defaultWorkspaceTabsState(),
      tabs: {
        ...defaultWorkspaceTabsState().tabs,
        intake: loadWorkspaceState(),
      },
    };
  } catch {
    return defaultWorkspaceTabsState();
  }
}

function sanitizeWorkspaceState(
  state: SpootyWorkspaceState | undefined,
  fallback: SpootyWorkspaceState,
): SpootyWorkspaceState {
  const panels = state?.panels
    ?.filter(panel => panel?.id && panel?.type && PANEL_TITLES[panel.type])
    .map(panel => ({
      ...panel,
      title: PANEL_TITLES[panel.type],
      x: snap(panel.x),
      y: snap(panel.y),
      w: Math.max(MIN_PANEL_WIDTH, snap(panel.w)),
      h: Math.max(MIN_PANEL_HEIGHT, snap(panel.h)),
    }));

  return panels?.length ? {panels} : fallback;
}

function snap(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

@Component({
    selector: 'app-root',
    imports: [CommonModule, FormsModule, NgFor, PlaylistBoxComponent],
    templateUrl: './app.component.html',
    styleUrl: './app.component.scss',
    standalone: true,
})
export class AppComponent implements OnDestroy {

  url = ''
  private readonly spotifyUrlPattern = /^https:\/\/open\.spotify\.com\/(track|playlist|album|artist)\/[a-zA-Z0-9]+/;
  private interaction?: {
    mode: 'drag' | 'resize';
    panelId: string;
    startPointerX: number;
    startPointerY: number;
    startPanelX: number;
    startPanelY: number;
    startPanelW: number;
    startPanelH: number;
  };
  readonly panelTypes: SpootyPanelType[] = [
    'source-intake',
    'queue-observatory',
    'playlist-history',
    'single-songs',
    'archive-browser',
    'candidate-inspector',
  ];
  readonly workspaceTabs: SpootyWorkspaceTab[] = ['intake', 'archive', 'diagnostics'];
  readonly archiveSortModes: ArchiveSortMode[] = ['newest', 'name', 'size'];
  selectedPanelType: SpootyPanelType = 'source-intake';
  workspaceTabsState: SpootyWorkspaceTabsState = loadWorkspaceTabsState();

  get isValidSpotifyUrl(): boolean {
    return this.spotifyUrlPattern.test(this.url);
  }
  createLoading$ = this.playlistService.createLoading$;
  playlists$ = this.playlistService.all$.pipe(map(items => items.filter(item => !item.isTrack)));
  songs$ = this.playlistService.all$.pipe(map(items => items.filter(item => item.isTrack)));
  allTracks$ = this.trackService.all$;
  selectedTrack$ = this.trackService.selectedTrack$;
  version = this.versionService.getVersion();
  spotifyConnected = false;
  archiveDestination = localStorage.getItem(ARCHIVE_DESTINATION_KEY) || '';
  archiveListing?: ArchiveListing;
  archiveLoading = false;
  archiveError = '';
  archiveSearch = '';
  archiveSort: ArchiveSortMode = 'newest';
  trackStatuses = TrackStatusEnum;

  get activeWorkspaceTab(): SpootyWorkspaceTab {
    return this.workspaceTabsState.activeTab;
  }

  get workspace(): SpootyWorkspaceState {
    return this.workspaceTabsState.tabs[this.activeWorkspaceTab];
  }

  constructor(
    private readonly playlistService: PlaylistService,
    private readonly versionService: VersionService,
    private readonly http: HttpClient,
    private readonly archiveService: ArchiveService,
    private readonly trackService: TrackService,
  ) {
    this.bootstrapAuthTokenFromUrl();
    this.checkSpotifyStatus();
    this.fetchPlaylists();
    this.refreshArchive();
  }

  ngOnDestroy(): void {
    this.stopWorkspaceInteraction();
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

  checkSpotifyStatus(): void {
    this.http
      .get<{ connected: boolean }>('/api/spotify/status')
      .subscribe((status) => (this.spotifyConnected = status.connected));
  }

  connectSpotify(): void {
    window.location.href = '/api/spotify/login';
  }

  fetchPlaylists(): void {
    this.playlistService.fetch();
  }

  download(): void {
    this.saveArchiveDestination();
    this.url && this.playlistService.create(this.url);
    this.url = '';
  }

  deleteCompleted(): void {
    this.playlistService.deleteAllByStatus(PlaylistStatusEnum.Completed);
  }

  deleteFailed(): void {
    this.playlistService.deleteAllByStatus(PlaylistStatusEnum.Error);
  }

  saveArchiveDestination(): void {
    localStorage.setItem(ARCHIVE_DESTINATION_KEY, this.archiveDestination);
  }

  refreshArchive(): void {
    this.archiveLoading = true;
    this.archiveError = '';
    this.archiveService.list().subscribe({
      next: (listing) => {
        this.archiveListing = listing;
        this.archiveDestination ||= listing.root;
        this.archiveLoading = false;
      },
      error: () => {
        this.archiveError = 'Archive listing is unavailable.';
        this.archiveLoading = false;
      },
    });
  }

  formatBytes(sizeBytes: number): string {
    if (sizeBytes < 1024) {
      return `${sizeBytes} B`;
    }

    if (sizeBytes < 1024 * 1024) {
      return `${(sizeBytes / 1024).toFixed(1)} KB`;
    }

    return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
  }

  formatModifiedAt(modifiedAt: number): string {
    return new Date(modifiedAt).toLocaleString();
  }

  trackStatusLabel(status?: TrackStatusEnum): string {
    switch (status) {
      case TrackStatusEnum.New:
        return 'New';
      case TrackStatusEnum.Searching:
        return 'Searching';
      case TrackStatusEnum.Queued:
        return 'Queued';
      case TrackStatusEnum.Downloading:
        return 'Downloading';
      case TrackStatusEnum.Completed:
        return 'Completed';
      case TrackStatusEnum.Error:
        return 'Error';
      default:
        return 'Unknown';
    }
  }

  rejectedUrls(track: Track): string[] {
    if (Array.isArray(track.rejectedYoutubeUrls)) {
      return track.rejectedYoutubeUrls;
    }

    if (!track.rejectedYoutubeUrls) {
      return [];
    }

    try {
      const parsed = JSON.parse(track.rejectedYoutubeUrls);
      return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  selectTrack(track: Track): void {
    this.trackService.select(track);
  }

  clearSelectedTrack(): void {
    this.trackService.clearSelection();
  }

  getWorkspaceTabLabel(tab: SpootyWorkspaceTab): string {
    return WORKSPACE_TAB_LABELS[tab];
  }

  switchWorkspaceTab(tab: SpootyWorkspaceTab): void {
    this.workspaceTabsState = {
      ...this.workspaceTabsState,
      activeTab: tab,
    };
    this.saveWorkspaceState();
  }

  resetLayout(): void {
    this.setActiveWorkspace(defaultWorkspaceStateForTab(this.activeWorkspaceTab));
  }

  resetAllLayouts(): void {
    this.workspaceTabsState = defaultWorkspaceTabsState();
    this.saveWorkspaceState();
  }

  filteredArchiveFiles(): ArchiveFile[] {
    const files = this.archiveListing?.files || [];
    const query = this.archiveSearch.trim().toLowerCase();
    const filtered = query
      ? files.filter(file => `${file.name} ${file.path}`.toLowerCase().includes(query))
      : [...files];

    return filtered.sort((a, b) => {
      if (this.archiveSort === 'name') {
        return a.name.localeCompare(b.name);
      }

      if (this.archiveSort === 'size') {
        return b.sizeBytes - a.sizeBytes;
      }

      return b.modifiedAt - a.modifiedAt;
    });
  }

  archiveGroups(): { folder: string; files: ArchiveFile[] }[] {
    const groups = new Map<string, ArchiveFile[]>();

    this.filteredArchiveFiles().forEach(file => {
      const folder = this.topLevelFolder(file);
      groups.set(folder, [...(groups.get(folder) || []), file]);
    });

    return [...groups.entries()].map(([folder, files]) => ({folder, files}));
  }

  archiveFileCount(): number {
    return this.filteredArchiveFiles().length;
  }

  archiveTotalBytes(): number {
    return this.filteredArchiveFiles().reduce((total, file) => total + file.sizeBytes, 0);
  }

  topLevelFolder(file: ArchiveFile): string {
    return file.path.includes('/') ? file.path.split('/')[0] : 'Root';
  }

  folderPath(file: ArchiveFile): string {
    const index = file.path.lastIndexOf('/');
    return index === -1 ? 'Root' : file.path.slice(0, index);
  }

  hasFolder(file: ArchiveFile): boolean {
    return file.path.includes('/');
  }

  getPanelTitle(type: SpootyPanelType): string {
    return PANEL_TITLES[type];
  }

  addPanel(type: SpootyPanelType = this.selectedPanelType): void {
    const offset = this.workspace.panels.length * GRID_SIZE;
    this.setActiveWorkspace({
      panels: [
        ...this.workspace.panels,
        makePanel(type, 48 + offset, 72 + offset),
      ],
    });
  }

  closePanel(panelId: string): void {
    if (this.workspace.panels.length <= 1) {
      return;
    }

    this.setActiveWorkspace({
      panels: this.workspace.panels.filter(panel => panel.id !== panelId),
    });
  }

  movePanel(panelId: string, x: number, y: number): void {
    this.updatePanel(panelId, {
      x: Math.max(0, snap(x)),
      y: Math.max(0, snap(y)),
    });
  }

  resizePanel(panelId: string, w: number, h: number): void {
    this.updatePanel(panelId, {
      w: Math.max(MIN_PANEL_WIDTH, snap(w)),
      h: Math.max(MIN_PANEL_HEIGHT, snap(h)),
    });
  }

  beginDrag(event: PointerEvent, panel: SpootyPanelInstance): void {
    event.preventDefault();
    this.bringPanelToFront(panel.id);
    this.interaction = {
      mode: 'drag',
      panelId: panel.id,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startPanelX: panel.x,
      startPanelY: panel.y,
      startPanelW: panel.w,
      startPanelH: panel.h,
    };
    this.startWorkspaceInteraction();
  }

  beginResize(event: PointerEvent, panel: SpootyPanelInstance): void {
    event.preventDefault();
    event.stopPropagation();
    this.bringPanelToFront(panel.id);
    this.interaction = {
      mode: 'resize',
      panelId: panel.id,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startPanelX: panel.x,
      startPanelY: panel.y,
      startPanelW: panel.w,
      startPanelH: panel.h,
    };
    this.startWorkspaceInteraction();
  }

  renderPanel(index: number, panel: SpootyPanelInstance): string {
    return panel.id;
  }

  panelStyle(panel: SpootyPanelInstance): Record<string, string> {
    return {
      transform: `translate(${panel.x}px, ${panel.y}px)`,
      width: `${panel.w}px`,
      height: `${panel.h}px`,
    };
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.interaction) {
      return;
    }

    const dx = event.clientX - this.interaction.startPointerX;
    const dy = event.clientY - this.interaction.startPointerY;

    if (this.interaction.mode === 'drag') {
      this.movePanel(
        this.interaction.panelId,
        this.interaction.startPanelX + dx,
        this.interaction.startPanelY + dy,
      );
      return;
    }

    this.resizePanel(
      this.interaction.panelId,
      this.interaction.startPanelW + dx,
      this.interaction.startPanelH + dy,
    );
  };

  private readonly handlePointerUp = (): void => {
    this.stopWorkspaceInteraction();
  };

  private startWorkspaceInteraction(): void {
    document.addEventListener('pointermove', this.handlePointerMove);
    document.addEventListener('pointerup', this.handlePointerUp, {once: true});
  }

  private stopWorkspaceInteraction(): void {
    this.interaction = undefined;
    document.removeEventListener('pointermove', this.handlePointerMove);
    document.removeEventListener('pointerup', this.handlePointerUp);
  }

  private bringPanelToFront(panelId: string): void {
    const panel = this.workspace.panels.find(item => item.id === panelId);

    if (!panel) {
      return;
    }

    this.setActiveWorkspace({
      panels: [
        ...this.workspace.panels.filter(item => item.id !== panelId),
        panel,
      ],
    });
  }

  private updatePanel(panelId: string, changes: Partial<SpootyPanelInstance>): void {
    this.setActiveWorkspace({
      panels: this.workspace.panels.map(panel =>
        panel.id === panelId ? {...panel, ...changes} : panel
      ),
    });
  }

  private setActiveWorkspace(workspace: SpootyWorkspaceState): void {
    this.workspaceTabsState = {
      ...this.workspaceTabsState,
      tabs: {
        ...this.workspaceTabsState.tabs,
        [this.activeWorkspaceTab]: workspace,
      },
    };
    this.saveWorkspaceState();
  }

  private saveWorkspaceState(): void {
    localStorage.setItem(WORKSPACE_TABS_STORAGE_KEY, JSON.stringify(this.workspaceTabsState));
  }
}
