const AUDIO_EXTENSIONS = [
  '.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac', '.wma',
  '.opus', '.aiff', '.aif', '.ape', '.mp2', '.mka', '.wv',
  '.mid', '.midi', '.spx', '.dsf', '.dff', '.au', '.ra',
] as const;

const VIDEO_EXTENSIONS = [
  '.mp4', '.m4v', '.mov', '.mkv', '.avi', '.webm', '.flv', '.wmv',
  '.mpg', '.mpeg', '.3gp', '.ts', '.vob', '.rmvb',
] as const;

const DOCUMENT_EXTENSIONS = ['.ppt', '.pptx', '.doc', '.docx', '.pdf'] as const;

const FALLBACK_EXTENSIONS = new Set<string>([
  ...AUDIO_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
]);

/** File picker and drag/drop validation share this one extension authority. */
export const MEDIA_UPLOAD_ACCEPT = [
  'video/*',
  'image/*',
  'audio/*',
  ...DOCUMENT_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
].join(',');

export function isAllowedMediaFile(file: Pick<File, 'name' | 'type'>): boolean {
  if (
    file.type.startsWith('video/') ||
    file.type.startsWith('image/') ||
    file.type.startsWith('audio/')
  ) return true;
  const dot = file.name.lastIndexOf('.');
  return dot >= 0 && FALLBACK_EXTENSIONS.has(file.name.slice(dot).toLowerCase());
}

export function formatMediaSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatMediaDuration(seconds: number | null): string {
  if (!seconds) return '';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/** DirectoryReader returns at most one implementation-defined batch per call. */
export async function readAllFileSystemEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve) =>
      reader.readEntries(resolve, () => resolve([])),
    );
    all.push(...batch);
  } while (batch.length > 0);
  return all;
}

export async function collectFilesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise<File[]>((resolve) =>
      (entry as FileSystemFileEntry).file(
        (file) => resolve([file]),
        () => resolve([]),
      ),
    );
  }
  if (entry.isDirectory) {
    const entries = await readAllFileSystemEntries(
      (entry as FileSystemDirectoryEntry).createReader(),
    );
    return (await Promise.all(entries.map(collectFilesFromEntry))).flat();
  }
  return [];
}
