/* Хранилище вложенных файлов.

   Сканы договоров и счетов — это мегабайты, а localStorage рассчитан на
   килобайты и хранит только строки: PDF пришлось бы переводить в base64,
   раздувая его на треть, и первый же десяток документов переполнил бы
   хранилище. Поэтому сами файлы лежат в IndexedDB как двоичные объекты, а
   в общем JSON остаётся только описание: имя, размер, дата, подписан или
   нет. IndexedDB работает и когда страницу открыли прямо из файла. */
'use strict';

const FILES_DB = 'sales-platform-files';
const FILES_STORE = 'files';

let dbPromise = null;

function filesDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(FILES_DB, 1); }
    catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) db.createObjectStore(FILES_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Не удалось открыть хранилище файлов'));
    req.onblocked = () => reject(new Error('Хранилище файлов занято другой вкладкой'));
  });
  return dbPromise;
}

function filesTx(mode, run) {
  return filesDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, mode);
    const store = tx.objectStore(FILES_STORE);
    let result;
    try { result = run(store); } catch (e) { reject(e); return; }
    tx.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Запись прервана'));
  }));
}

function filePut(id, blob) {
  return filesTx('readwrite', (store) => { store.put({ id: id, blob: blob }); });
}

function fileGet(id) {
  return filesTx('readonly', (store) => ({ __req: store.get(id) }))
    .then((row) => (row && row.blob) ? row.blob : null);
}

function fileDel(id) {
  return filesTx('readwrite', (store) => { store.delete(id); });
}

function fileKeys() {
  return filesTx('readonly', (store) => ({ __req: store.getAllKeys() }));
}

/* Вложения, на которые больше никто не ссылается, занимают место зря:
   это остатки от удалённых документов и контрагентов. */
function filesCleanup(usedIds) {
  const used = {};
  usedIds.forEach((id) => { used[id] = true; });
  return fileKeys().then((keys) => {
    const orphans = (keys || []).filter((k) => !used[k]);
    return Promise.all(orphans.map(fileDel)).then(() => orphans.length);
  });
}

/* Суммарный вес хранилища — показываем во вкладке «Данные» */
function filesTotalSize() {
  return filesTx('readonly', (store) => ({ __req: store.getAll() }))
    .then((rows) => (rows || []).reduce((s, r) => s + ((r.blob && r.blob.size) || 0), 0));
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1048576) return (n / 1048576).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' МБ';
  if (n >= 1024) return Math.round(n / 1024).toLocaleString('ru-RU') + ' КБ';
  return n + ' Б';
}

/* Blob в строку base64 и обратно — только для выгрузки и загрузки вместе
   с файлами. В обычной работе файл никогда не становится строкой. */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'application/pdf' });
}
