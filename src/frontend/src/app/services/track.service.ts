import { Injectable } from '@angular/core';
import {createStore} from "@ngneat/elf";
import {deleteEntities, selectAllEntities, selectManyByPredicate, upsertEntities, withEntities} from "@ngneat/elf-entities";
import {Socket} from "ngx-socket-io";
import {BehaviorSubject, map, Observable, tap} from "rxjs";
import {HttpClient} from "@angular/common/http";
import {Track, TrackStatusEnum} from "../models/track";

const STORE_NAME = 'track';
const ENDPOINT = '/api/track';
enum WsTrackOperation {
  New = 'trackNew',
  Update = 'trackUpdate',
  Delete = 'trackDelete',
}

@Injectable({
  providedIn: 'root'
})
export class TrackService {

  private readonly selectedTrackSubject = new BehaviorSubject<Track | undefined>(undefined);
  selectedTrack$ = this.selectedTrackSubject.asObservable();

  private store = createStore(
    { name: STORE_NAME },
    withEntities<Track>(),
  );

  all$ = this.store.pipe(selectAllEntities());

  getAllByPlaylist(id: number, status?: TrackStatusEnum): Observable<Track[]> {
    return this.store.pipe(
      selectManyByPredicate((track) => track?.playlistId === id),
      map(data => data.filter(item => status === undefined || item.status === status)),
    );
  }

  getCompletedByPlaylist(id: number): Observable<Track[]> {
    return this.getAllByPlaylist(id, TrackStatusEnum.Completed);
  }

  getErrorByPlaylist(id: number): Observable<Track[]> {
    return this.getAllByPlaylist(id, TrackStatusEnum.Error);
  }

  constructor(
    private readonly http: HttpClient,
    private readonly socket: Socket,
  ) {
    this.initWsConnection();
  }

  fetch(playlistId: number): void {
    this.http.get<Track[]>(`${ENDPOINT}/playlist/${playlistId}`).pipe(
      tap((data: Track[]) => this.store.update(upsertEntities(data.map(track => ({...track, playlistId}))))),
    ).subscribe();
  }

  delete(id: number): void {
    this.http.delete(`${ENDPOINT}/${id}`).subscribe();
  }

  retry(id: number): void {
    this.http.post(`${ENDPOINT}/retry/${id}`, {}).subscribe();
  }

  select(track: Track): void {
    this.selectedTrackSubject.next(track);
  }

  clearSelection(): void {
    this.selectedTrackSubject.next(undefined);
  }

  private initWsConnection(): void {
    this.socket.on(WsTrackOperation.Update, (track: Track) => {
      this.store.update(upsertEntities(track));
      const selected = this.selectedTrackSubject.value;

      if (selected?.id === track.id) {
        this.selectedTrackSubject.next({...selected, ...track});
      }
    });
    this.socket.on(WsTrackOperation.Delete, ({id}: {id: number}) => {
      this.store.update(deleteEntities(id));

      if (this.selectedTrackSubject.value?.id === id) {
        this.selectedTrackSubject.next(undefined);
      }
    });
    this.socket.on(WsTrackOperation.New, ({track, playlistId}: {track: Track, playlistId: number}) =>
      this.store.update(upsertEntities([{...track, playlistId}]))
    );
  }
}
