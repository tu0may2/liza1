/* Хранилище. Всё лежит в localStorage браузера одним JSON-документом:
   платформа работает без сервера и без интернета, файл index.html можно
   открыть двойным щелчком. Поэтому данные привязаны к устройству и браузеру —
   перенос между устройствами идёт через «Данные → Выгрузить в файл». */
'use strict';

const STORE_KEY = 'sales-platform-v1';
const SCHEMA = 1;

const CONTRACT_KINDS = {
  main:   { label: 'Основной', tag: 'tag--main',   color: 'var(--c1)' },
  barter: { label: 'Бартерный', tag: 'tag--barter', color: 'var(--c2)' },
  other:  { label: 'Прочий',   tag: '',            color: 'var(--s3)' }
};

const PAY_METHODS = {
  bank: { label: 'Безнал', color: 'var(--c1)' },
  cash: { label: 'Нал',    color: 'var(--c2)' }
};

/* Статусы заказа идут по порядку: заказ можно завести черновиком и
   добавлять позиции, пока не дошло до документов. */
const ORDER_STATUSES = {
  draft:      { label: 'Черновик',    tag: 'tag--draft', step: 0 },
  agreed:     { label: 'Согласован',  tag: 'tag--info',  step: 1 },
  documented: { label: 'В документах', tag: 'tag--warn', step: 2 },
  shipped:    { label: 'Отгружен',    tag: 'tag--ok',    step: 3 },
  closed:     { label: 'Закрыт',      tag: 'tag--ok',    step: 4 }
};

const DOC_TYPES = {
  contract: 'Договор',
  invoice:  'Счёт',
  spec:     'Спецификация',
  payment:  'Оплата',
  upd:      'УПД / накладная',
  act:      'Акт',
  other:    'Прочее'
};

const DOC_STATUSES = {
  draft:    { label: 'Черновик', tag: 'tag--draft' },
  sent:     { label: 'Отправлен', tag: 'tag--info' },
  signed:   { label: 'Подписан',  tag: 'tag--ok' },
  paid:     { label: 'Оплачен',   tag: 'tag--ok' },
  rejected: { label: 'Отклонён',  tag: 'tag--bad' }
};

/* Состояние подписания вложенного файла. Главное, что нужно видеть по
   скану: он уже подписан обеими сторонами или ещё нет. */
const SIGN_STATES = {
  none: { label: 'Не подписан',               short: 'не подписан', tag: 'tag--warn' },
  one:  { label: 'Подписан одной стороной',   short: 'одна сторона', tag: 'tag--info' },
  both: { label: 'Подписан с обеих сторон',   short: 'обе стороны',  tag: 'tag--ok' }
};

let state = null;

function uid(prefix) {
  return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function blankState() {
  return { schema: SCHEMA, counterparties: [], orders: [], documents: [], payments: [], schedule: [] };
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }
  if (!raw) { state = seedState(); save(); return state; }
  try {
    const parsed = JSON.parse(raw);
    state = Object.assign(blankState(), parsed);
    ['counterparties', 'orders', 'documents', 'payments', 'schedule'].forEach((k) => {
      if (!Array.isArray(state[k])) state[k] = [];
    });
    state.counterparties.forEach((c) => { if (!Array.isArray(c.contracts)) c.contracts = []; });
    state.orders.forEach((o) => { if (!Array.isArray(o.items)) o.items = []; });
    state.documents.forEach((d2) => { if (!Array.isArray(d2.files)) d2.files = []; });
  } catch (e) {
    console.error('Не удалось прочитать сохранённые данные, начинаем с примера', e);
    state = seedState();
  }
  return state;
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('Не удалось сохранить данные в браузере: ' + e.message +
          '\n\nВыгрузите данные в файл (вкладка «Данные»), чтобы не потерять их.');
  }
}

function db() { return state || load(); }

/* ---------------------------------------------------------------- */
/* Доступ к справочникам                                            */
/* ---------------------------------------------------------------- */
function cpById(id) { return db().counterparties.find((c) => c.id === id) || null; }
function cpName(id) { const c = cpById(id); return c ? c.name : '—'; }

function contractById(cpId, contractId) {
  const c = cpById(cpId);
  if (!c) return null;
  return c.contracts.find((k) => k.id === contractId) || null;
}

function contractLabel(cpId, contractId) {
  const k = contractById(cpId, contractId);
  if (!k) return '—';
  return k.name;
}

function contractKind(cpId, contractId) {
  const k = contractById(cpId, contractId);
  return k ? (k.kind || 'other') : 'other';
}

function allContracts() {
  const out = [];
  db().counterparties.forEach((c) => c.contracts.forEach((k) => out.push({ cp: c, contract: k })));
  return out;
}

function orderById(id) { return db().orders.find((o) => o.id === id) || null; }

function orderLabel(id) {
  const o = orderById(id);
  if (!o) return '—';
  return 'Заказ ' + (o.number || o.id.slice(-4));
}

function orderTotal(order) {
  if (!order || !Array.isArray(order.items)) return 0;
  return order.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
}

/* ---------------------------------------------------------------- */
/* Запись                                                           */
/* ---------------------------------------------------------------- */
function upsert(collection, item, idPrefix) {
  const list = db()[collection];
  if (!item.id) {
    item.id = uid(idPrefix || collection.slice(0, 3));
    list.push(item);
  } else {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = Object.assign(list[i], item); else list.push(item);
  }
  save();
  return item;
}

function remove(collection, id) {
  const list = db()[collection];
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) { list.splice(i, 1); save(); }
}

/* Удаление контрагента уносит с собой всё, что на него ссылается:
   иначе в оплатах и документах остались бы строки без владельца. */
function removeCounterparty(cpId) {
  const d = db();
  /* Вложения удаляемых документов тоже вычищаем */
  const ids = [];
  d.documents.filter((x) => x.cpId === cpId).forEach((x) => docFiles(x).forEach((f) => ids.push(f.id)));
  ids.forEach((id) => { try { fileDel(id); } catch (e) { /* хранилище могло не открыться */ } });
  d.counterparties = d.counterparties.filter((c) => c.id !== cpId);
  ['orders', 'documents', 'payments', 'schedule'].forEach((k) => {
    d[k] = d[k].filter((x) => x.cpId !== cpId);
  });
  save();
}

function removeContract(cpId, contractId) {
  const c = cpById(cpId);
  if (!c) return;
  c.contracts = c.contracts.filter((k) => k.id !== contractId);
  /* Ссылки на договор обнуляем, сами записи оставляем: оплата была,
     даже если договор убрали из справочника. */
  ['orders', 'documents', 'payments', 'schedule'].forEach((k) => {
    db()[k].forEach((x) => { if (x.contractId === contractId) x.contractId = ''; });
  });
  save();
}

/* ---------------------------------------------------------------- */
/* Вложенные файлы                                                  */
/* ---------------------------------------------------------------- */
function docFiles(doc) {
  if (!doc) return [];
  if (!Array.isArray(doc.files)) doc.files = [];
  return doc.files;
}

/* Сводка по вложениям документа: сколько файлов и подписан ли он.
   Документ считается подписанным, если хотя бы один скан подписан
   обеими сторонами — именно такой экземпляр имеет силу. */
function docSignState(doc) {
  const list = docFiles(doc);
  if (!list.length) return { count: 0, key: 'empty', label: 'нет скана' };
  if (list.some((f) => f.signed === 'both')) return { count: list.length, key: 'both', label: 'подписан обеими' };
  if (list.some((f) => f.signed === 'one')) return { count: list.length, key: 'one', label: 'одна сторона' };
  return { count: list.length, key: 'none', label: 'без подписей' };
}

function allFileIds() {
  const out = [];
  db().documents.forEach((d2) => docFiles(d2).forEach((f) => out.push(f.id)));
  return out;
}

/* Удаление документа уносит и его вложения: иначе двоичные данные
   остались бы в хранилище навсегда, без единой ссылки на них. */
function removeDocument(docId) {
  const doc = db().documents.find((d2) => d2.id === docId);
  const ids = doc ? docFiles(doc).map((f) => f.id) : [];
  /* Оплаты остаются: деньги пришли, даже если счёт убрали. Снимаем только
     ссылку, чтобы платёж не указывал в пустоту. */
  db().payments.forEach((p) => { if (p.docId === docId) p.docId = ''; });
  remove('documents', docId);
  return Promise.all(ids.map((id) => fileDel(id).catch(() => null)));
}

/* ---------------------------------------------------------------- */
/* Выгрузка и загрузка                                              */
/* ---------------------------------------------------------------- */
function exportJSON() { return JSON.stringify(db(), null, 2); }

/* Выгрузка вместе со сканами: файлы переводятся в base64 и кладутся в то
   же поле, откуда загрузка их и достаёт. Файл получается большим — это
   полная копия, которой можно поднять работу на другом устройстве. */
function exportWithFiles() {
  const snapshot = JSON.parse(JSON.stringify(db()));
  const metas = [];
  snapshot.documents.forEach((d2) => (d2.files || []).forEach((f) => metas.push(f)));
  return Promise.all(metas.map((f) =>
    fileGet(f.id).then((blob) => (blob ? blobToBase64(blob).then((b64) => [f.id, { type: f.type, b64: b64 }]) : null))
      .catch(() => null)
  )).then((pairs) => {
    snapshot._files = {};
    pairs.filter(Boolean).forEach((pair) => { snapshot._files[pair[0]] = pair[1]; });
    return JSON.stringify(snapshot);
  });
}

function importJSON(text, mode) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Файл не похож на выгрузку платформы');
  if (!Array.isArray(parsed.counterparties)) throw new Error('В файле нет списка контрагентов');

  /* Сканы, если они есть в выгрузке, возвращаются в хранилище файлов.
     Делается это до правки состояния: если файлы не лягут, ссылки на них
     не появятся и в данных не останется битых вложений. */
  const blobs = parsed._files || {};
  delete parsed._files;
  const restore = Object.keys(blobs).map((id) =>
    filePut(id, base64ToBlob(blobs[id].b64, blobs[id].type)).catch(() => null));
  if (mode === 'merge') {
    const d = db();
    const known = new Set(d.counterparties.map((c) => c.id));
    parsed.counterparties.forEach((c) => { if (!known.has(c.id)) d.counterparties.push(c); });
    ['orders', 'documents', 'payments', 'schedule'].forEach((k) => {
      const ids = new Set(d[k].map((x) => x.id));
      (parsed[k] || []).forEach((x) => { if (!ids.has(x.id)) d[k].push(x); });
    });
  } else {
    state = Object.assign(blankState(), parsed);
  }
  state.documents.forEach((d2) => { if (!Array.isArray(d2.files)) d2.files = []; });
  save();
  return Promise.all(restore).then(() => Object.keys(blobs).length);
}

function resetAll(withSample) {
  state = withSample ? seedState() : blankState();
  save();
}

/* ---------------------------------------------------------------- */
/* Пример: два контрагента из реальной работы                       */
/* ---------------------------------------------------------------- */
function seedState() {
  const s = blankState();
  const y = new Date().getFullYear();
  const m = (shift) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + shift);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  };
  const day = (shift, dd) => m(shift) + '-' + String(dd).padStart(2, '0');

  const amur = {
    id: 'cp-amur', name: 'Амур', fullName: 'ООО «Амур»',
    inn: '2721123456', kpp: '272101001',
    city: 'Хабаровск', address: 'г. Хабаровск, ул. Ленина, 18, оф. 404',
    contactPerson: 'Игнатьев Сергей', phone: '+7 (914) 200-10-10', email: 'sales@amur.example',
    manager: 'Лиза', note: 'Работаем по двум договорам: основной денежный и бартерный.',
    contracts: [
      { id: 'k-amur-main', kind: 'main', name: 'Основной', number: 'А-' + y + '/14',
        date: y + '-01-15', payTerms: 'Отсрочка 30 календарных дней', note: 'Оплата по счёту, безнал.' },
      { id: 'k-amur-barter', kind: 'barter', name: 'Бартерный', number: 'А-' + y + '/14-Б',
        date: y + '-02-03', payTerms: 'Взаимозачёт по спецификации', note: 'Закрывается поставкой и частично налом.' }
    ]
  };
  const sharks = {
    id: 'cp-sharks', name: 'Сахалинские акулы', fullName: 'ООО «Сахалинские акулы»',
    inn: '6500123789', kpp: '650001001',
    city: 'Южно-Сахалинск', address: 'г. Южно-Сахалинск, пр. Мира, 112',
    contactPerson: 'Ким Ольга', phone: '+7 (962) 300-44-55', email: 'zakaz@sakh-sharks.example',
    manager: 'Лиза', note: 'Один договор, оплата преимущественно безналом.',
    contracts: [
      { id: 'k-sharks-main', kind: 'main', name: 'Основной', number: 'СА-' + y + '/07',
        date: y + '-03-11', payTerms: 'Предоплата 50%, остаток в течение 14 дней', note: '' }
    ]
  };
  s.counterparties = [amur, sharks];

  s.orders = [
    { id: 'ord-1', cpId: 'cp-amur', contractId: 'k-amur-main', number: '114', date: day(-3, 5),
      status: 'closed', shipDate: day(-3, 18), note: 'Первая партия сезона.',
      items: [
        { id: 'it-1', name: 'Мука рыбная, мешок 25 кг', unit: 'т', qty: 12, price: 68000 },
        { id: 'it-2', name: 'Соль пищевая помол №2', unit: 'т', qty: 8, price: 9500 }
      ] },
    { id: 'ord-2', cpId: 'cp-amur', contractId: 'k-amur-barter', number: '118', date: day(-2, 9),
      status: 'shipped', shipDate: day(-1, 4), note: 'Закрывается встречной поставкой.',
      items: [
        { id: 'it-3', name: 'Тара полипропиленовая, 50 л', unit: 'шт', qty: 1800, price: 210 },
        { id: 'it-4', name: 'Стропы грузовые', unit: 'шт', qty: 60, price: 1450 }
      ] },
    { id: 'ord-3', cpId: 'cp-sharks', contractId: 'k-sharks-main', number: '121', date: day(-1, 12),
      status: 'documented', shipDate: day(0, 6), note: 'Ждём подписанную спецификацию.',
      items: [
        { id: 'it-5', name: 'Ящик рыбный 20 кг', unit: 'шт', qty: 2400, price: 165 },
        { id: 'it-6', name: 'Лёд технический', unit: 'т', qty: 30, price: 4200 }
      ] },
    { id: 'ord-4', cpId: 'cp-amur', contractId: 'k-amur-main', number: '124', date: day(0, 3),
      status: 'draft', shipDate: '', note: 'Собираю по частям: позиции уточняются у снабжения.',
      items: [
        { id: 'it-7', name: 'Мука рыбная, мешок 25 кг', unit: 'т', qty: 10, price: 71000 }
      ] }
  ];

  s.documents = [
    { id: 'doc-1', cpId: 'cp-amur', contractId: 'k-amur-main', orderId: '', type: 'contract',
      number: 'А-' + y + '/14', date: y + '-01-15', amount: 0, status: 'signed', files: [], note: 'Рамочный договор поставки.' },
    { id: 'doc-2', cpId: 'cp-amur', contractId: 'k-amur-main', orderId: 'ord-1', type: 'spec',
      number: 'С-114', date: day(-3, 5), amount: 892000, status: 'signed', files: [], note: '' },
    { id: 'doc-3', cpId: 'cp-amur', contractId: 'k-amur-main', orderId: 'ord-1', type: 'invoice',
      number: '114', date: day(-3, 6), amount: 892000, status: 'paid', files: [], note: 'Оплачен двумя частями.' },
    { id: 'doc-4', cpId: 'cp-amur', contractId: 'k-amur-main', orderId: 'ord-1', type: 'upd',
      number: 'УПД-114', date: day(-3, 18), amount: 892000, status: 'signed', files: [], note: '' },
    { id: 'doc-5', cpId: 'cp-amur', contractId: 'k-amur-barter', orderId: 'ord-2', type: 'contract',
      number: 'А-' + y + '/14-Б', date: y + '-02-03', amount: 0, status: 'signed', files: [], note: 'Бартерный договор.' },
    { id: 'doc-6', cpId: 'cp-amur', contractId: 'k-amur-barter', orderId: 'ord-2', type: 'spec',
      number: 'С-118Б', date: day(-2, 9), amount: 465000, status: 'signed', files: [], note: 'Перечень встречной поставки.' },
    { id: 'doc-7', cpId: 'cp-amur', contractId: 'k-amur-barter', orderId: 'ord-2', type: 'invoice',
      number: '118Б', date: day(-2, 10), amount: 465000, status: 'sent', files: [], note: 'Частично закрыт взаимозачётом.' },
    { id: 'doc-8', cpId: 'cp-sharks', contractId: 'k-sharks-main', orderId: '', type: 'contract',
      number: 'СА-' + y + '/07', date: y + '-03-11', amount: 0, status: 'signed', files: [], note: '' },
    { id: 'doc-9', cpId: 'cp-sharks', contractId: 'k-sharks-main', orderId: 'ord-3', type: 'spec',
      number: 'С-121', date: day(-1, 12), amount: 522000, status: 'sent', files: [], note: 'Ждём подпись.' },
    { id: 'doc-10', cpId: 'cp-sharks', contractId: 'k-sharks-main', orderId: 'ord-3', type: 'invoice',
      number: '121', date: day(-1, 13), amount: 522000, status: 'sent', files: [], note: 'Предоплата 50%.' }
  ];

  s.payments = [
    { id: 'pay-1', cpId: 'cp-amur', contractId: 'k-amur-main', orderId: 'ord-1', docId: 'doc-3', date: day(-3, 14),
      amount: 500000, method: 'bank', note: 'Первая часть по счёту 114.' },
    { id: 'pay-2', cpId: 'cp-amur', contractId: 'k-amur-main', orderId: 'ord-1', docId: 'doc-3', date: day(-2, 11),
      amount: 392000, method: 'bank', note: 'Остаток по счёту 114.' },
    { id: 'pay-3', cpId: 'cp-amur', contractId: 'k-amur-barter', orderId: 'ord-2', docId: 'doc-7', date: day(-2, 20),
      amount: 150000, method: 'cash', note: 'Доплата налом сверх взаимозачёта.' },
    { id: 'pay-4', cpId: 'cp-amur', contractId: 'k-amur-barter', orderId: 'ord-2', docId: 'doc-7', date: day(-1, 8),
      amount: 120000, method: 'cash', note: 'Вторая часть по счёту 118Б.' },
    { id: 'pay-5', cpId: 'cp-sharks', contractId: 'k-sharks-main', orderId: 'ord-3', docId: 'doc-10', date: day(-1, 19),
      amount: 261000, method: 'bank', note: 'Предоплата 50% по счёту 121.' },
    { id: 'pay-6', cpId: 'cp-amur', contractId: 'k-amur-main', orderId: '', date: day(-1, 26),
      amount: 180000, method: 'bank', note: 'Аванс под заказ 124.' },
    { id: 'pay-7', cpId: 'cp-amur', contractId: 'k-amur-main', orderId: 'ord-4', date: day(0, 8),
      amount: 240000, method: 'bank', note: 'Первый транш по заказу 124.' },
    { id: 'pay-8', cpId: 'cp-sharks', contractId: 'k-sharks-main', orderId: 'ord-3', docId: 'doc-10', date: day(0, 14),
      amount: 95000, method: 'cash', note: 'Доплата налом за срочную партию.' }
  ];

  s.schedule = [
    { id: 'sch-0', cpId: 'cp-amur', contractId: 'k-amur-main', orderId: 'ord-1', dueDate: day(-2, 10),
      amount: 392000, method: 'bank', status: 'paid', files: [], note: 'Остаток по счёту 114 — закрыт.' },
    { id: 'sch-1', cpId: 'cp-amur', contractId: 'k-amur-barter', orderId: 'ord-2', dueDate: day(-1, 25),
      amount: 195000, method: 'cash', status: 'plan', note: 'Остаток по бартеру — просрочен.' },
    { id: 'sch-2', cpId: 'cp-sharks', contractId: 'k-sharks-main', orderId: 'ord-3', dueDate: day(0, 20),
      amount: 261000, method: 'bank', status: 'plan', note: 'Остаток 50% по счёту 121.' },
    { id: 'sch-3', cpId: 'cp-amur', contractId: 'k-amur-main', orderId: 'ord-4', dueDate: day(1, 10),
      amount: 710000, method: 'bank', status: 'plan', note: 'По заказу 124, после подписания спецификации.' },
    { id: 'sch-4', cpId: 'cp-sharks', contractId: 'k-sharks-main', orderId: '', dueDate: day(1, 25),
      amount: 300000, method: 'bank', status: 'plan', note: 'Предварительно: вторая партия.' }
  ];

  return s;
}
