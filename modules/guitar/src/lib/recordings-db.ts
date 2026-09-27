import { db, files } from "@lifehub/sdk";

/*
 * Записи голоса хранятся в хабе: аудио — как файлы модуля, описание — в коллекции
 * "recordings". Поэтому запись, сделанная на телефоне, слышна и на компьютере.
 */

export interface Recording {
  id: string;
  name: string;
  createdAt: number;
  duration: number;
  /** Адрес аудио для <audio src>. Есть у сохранённых записей. */
  url?: string;
  /** Содержимое новой записи — только при сохранении. */
  blob?: Blob;
}

interface RecordingDoc {
  name: string;
  duration: number;
  fileId: string;
}

const recordings = db.collection<RecordingDoc>("recordings");

export async function listRecordings(): Promise<Recording[]> {
  const all = await recordings.list();
  return all
    .map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt, duration: r.duration, url: files.url(r.fileId) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveRecording(recording: Recording): Promise<void> {
  if (!recording.blob) throw new Error("Нет аудио для сохранения");
  const ext = recording.blob.type.includes("mp4") ? "m4a" : recording.blob.type.includes("ogg") ? "ogg" : "webm";
  const file = await files.upload(recording.blob, `${recording.name}.${ext}`);
  await recordings.add({ name: recording.name, duration: recording.duration, fileId: file.id });
}

export async function deleteRecording(id: string): Promise<void> {
  const doc = await recordings.get(id);
  if (doc) await files.remove(doc.fileId).catch(() => {});
  await recordings.remove(id);
}

export async function renameRecording(recording: Recording, name: string): Promise<void> {
  await recordings.update(recording.id, { name });
}
