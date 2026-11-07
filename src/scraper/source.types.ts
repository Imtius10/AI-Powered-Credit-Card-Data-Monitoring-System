export interface FetchedSource {
  url: string;
  finalUrl: string;
  statusCode: number;
  fetchedAt: string;
  title: string;
  contentType: string;
  content: string;
  contentHash: string;
  fromCache: boolean;
  notModified: boolean;
}

export interface CardSourceContent extends FetchedSource {
  mode: 'live' | 'fixture';
}

export class SourceBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceBlockedError';
  }
}

export class UnsupportedSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedSourceError';
  }
}
