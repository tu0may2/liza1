/* Вложенные файлы.

   Файлы лежат на диске рядом с программой, а их описание — в базе рядом
   с ними. Браузер только отправляет и получает их по адресу /api/files,
   поэтому размер ограничен лишь диском, а не правилами хранилища
   браузера, и файлы переживают чистку истории браузера.

   Описание всех вложений загружается один раз вместе с данными и лежит в
   памяти: по нему рисуются списки и скрепки, не дёргая сервер на каждую
   строку таблицы. */
'use strict';

/* 200 МБ — предел, который принимает сервер */
const MAX_FILE_MB = 200;

/* Что можно приложить. Список совпадает с серверным: если добавлять сюда
   новое, добавить и там, иначе загрузка вернёт отказ. */
const ACCEPT_FILES =
  '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.odt,.ods,' +
  '.png,.jpg,.jpeg,.gif,.webp,.heic,.bmp,.tif,.tiff,' +
  '.zip,.rar,.7z,.eml,.msg,.json';

let fileIndex = [];

function setFiles(list) { fileIndex = Array.isArray(list) ? list : []; }
function allFiles() { return fileIndex; }

/* Вложения одного владельца: документа, заказа, договора, оплаты,
   прайса или самого контрагента */
function filesOf(ownerKind, ownerId) {
  if (!ownerId) return [];
  return fileIndex.filter((f) => f.ownerKind === ownerKind && f.ownerId === ownerId);
}

/* Все файлы контрагента — из них собирается его база документации */
function filesOfCp(cpId) {
  if (!cpId) return [];
  return fileIndex.filter((f) => f.cpId === cpId);
}

function fileById(id) { return fileIndex.find((f) => f.id === id) || null; }

/* Адрес файла. Открывается и скачивается прямо по ссылке: сервер отдаёт
   его с правильным типом и исходным именем, в том числе кириллическим. */
function fileUrl(id, download) {
  return '/api/files/' + encodeURIComponent(id) + (download ? '?download=1' : '');
}

function apiError(res) {
  return res.json().catch(() => ({})).then((body) => {
    throw new Error(body.error || ('сервер ответил ' + res.status));
  });
}

function refreshFiles() {
  return fetch('/api/files').then((res) => (res.ok ? res.json() : apiError(res)))
    .then((body) => { setFiles(body.files); return fileIndex; });
}

/* Загрузка идёт телом запроса, без формы: имя и владелец передаются в
   адресе. Так не нужен разбор multipart ни здесь, ни на сервере, и
   большой файл не копируется лишний раз в память браузера. */
function uploadFile(ownerKind, ownerId, cpId, file, kind, label) {
  const params = new URLSearchParams({
    ownerKind: ownerKind, ownerId: ownerId, cpId: cpId || '',
    name: file.name, kind: kind || '', label: label || ''
  });
  return fetch('/api/files?' + params.toString(), {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file
  }).then((res) => (res.ok ? res.json() : apiError(res)))
    .then((body) => { fileIndex.unshift(body.file); return body.file; });
}

function updateFileMeta(id, fields) {
  return fetch('/api/files/' + encodeURIComponent(id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields)
  }).then((res) => (res.ok ? res.json() : apiError(res)))
    .then((body) => {
      const i = fileIndex.findIndex((f) => f.id === id);
      if (i >= 0) fileIndex[i] = body.file;
      return body.file;
    });
}

function deleteFileApi(id) {
  return fetch('/api/files/' + encodeURIComponent(id), { method: 'DELETE' })
    .then((res) => (res.ok ? res.json() : apiError(res)))
    .then(() => { fileIndex = fileIndex.filter((f) => f.id !== id); });
}

/* Владельца удалили — его вложения тоже не нужны */
function dropFilesOf(ownerKind, ownerId) {
  return fetch('/api/owner-removed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerKind: ownerKind, ownerId: ownerId })
  }).then(() => { fileIndex = fileIndex.filter((f) => !(f.ownerKind === ownerKind && f.ownerId === ownerId)); })
    .catch(() => null);
}

function storageInfo() {
  return fetch('/api/storage').then((res) => (res.ok ? res.json() : apiError(res)));
}

function cleanupFiles(owners) {
  return fetch('/api/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owners: owners })
  }).then((res) => (res.ok ? res.json() : apiError(res)))
    .then((body) => refreshFiles().then(() => body.removed));
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1073741824) return (n / 1073741824).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ГБ';
  if (n >= 1048576) return (n / 1048576).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' МБ';
  if (n >= 1024) return Math.round(n / 1024).toLocaleString('ru-RU') + ' КБ';
  return n + ' Б';
}

/* Короткая метка типа для значка файла */
function fileBadge(meta) {
  const ext = String(meta.name || '').split('.').pop().toLowerCase();
  if (['doc', 'docx', 'odt', 'rtf'].indexOf(ext) >= 0) return { label: 'DOC', cls: 'file__icon--doc' };
  if (['xls', 'xlsx', 'csv', 'ods'].indexOf(ext) >= 0) return { label: 'XLS', cls: 'file__icon--xls' };
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'bmp', 'tif', 'tiff'].indexOf(ext) >= 0)
    return { label: 'IMG', cls: 'file__icon--img' };
  if (['zip', 'rar', '7z'].indexOf(ext) >= 0) return { label: 'ZIP', cls: 'file__icon--zip' };
  if (ext === 'pdf') return { label: 'PDF', cls: 'file__icon--pdf' };
  return { label: (ext || 'файл').slice(0, 4).toUpperCase(), cls: '' };
}
