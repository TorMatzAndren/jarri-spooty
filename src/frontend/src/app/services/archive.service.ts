import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ArchiveListing } from '../models/archive';

@Injectable({
  providedIn: 'root'
})
export class ArchiveService {
  constructor(private readonly http: HttpClient) {}

  list(): Observable<ArchiveListing> {
    return this.http.get<ArchiveListing>('/api/archive');
  }
}
