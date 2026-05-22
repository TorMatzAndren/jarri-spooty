export interface ArchiveFile {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: number;
}

export interface ArchiveListing {
  root: string;
  files: ArchiveFile[];
}
