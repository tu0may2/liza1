/* Хранилище.

   Записи живут на локальном сервере: он кладёт их в файл базы рядом с
   программой и при каждой правке сохраняет предыдущее состояние в
   историю. Браузер держит ту же запись в памяти, чтобы экраны считались
   мгновенно, и отправляет её на сервер после каждого изменения.

   Отправка отложена на долю секунды: при наборе текста в поле правок
   десятки, а записать достаточно последнюю. */
'use strict';

const SAVE_DELAY = 400;

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
  '':     { label: 'Не отмечено',             short: 'без отметки', tag: '' },
  none:   { label: 'Не подписан',             short: 'не подписан', tag: 'tag--warn' },
  one:    { label: 'Подписан одной стороной', short: 'одна сторона', tag: 'tag--info' },
  both:   { label: 'Подписан с обеих сторон', short: 'обе стороны',  tag: 'tag--ok' }
};

let state = null;
let saveTimer = null;
let pendingEvent = '';
let lastUpdated = '';

function uid(prefix) {
  return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

function blankState() {
  return { schema: 1, counterparties: [], orders: [], documents: [], payments: [], schedule: [], shipments: [] };
}

function normalize(doc) {
  const out = Object.assign(blankState(), doc || {});
  ['counterparties', 'orders', 'documents', 'payments', 'schedule', 'shipments'].forEach((k) => {
    if (!Array.isArray(out[k])) out[k] = [];
  });
  out.shipments.forEach((sh) => { if (!Array.isArray(sh.lines)) sh.lines = []; });
  out.counterparties.forEach((c) => {
    if (!Array.isArray(c.contracts)) c.contracts = [];
    if (!Array.isArray(c.priceItems)) c.priceItems = [];
    delete c.priceFiles;   /* файлы переехали на сервер */
  });
  out.orders.forEach((o) => { if (!Array.isArray(o.items)) o.items = []; });
  out.documents.forEach((d) => { delete d.files; });
  return out;
}

function apiFail(res) {
  return res.json().catch(() => ({})).then((body) => {
    throw new Error(body.error || ('сервер ответил ' + res.status));
  });
}

/* Первая загрузка: записи, вложения и сведения о хранилище одним
   запросом — чтобы экран не моргал, собираясь по частям. */
function loadState() {
  return fetch('/api/state').then((res) => (res.ok ? res.json() : apiFail(res)))
    .then((body) => {
      state = normalize(body.doc);
      setFiles(body.files);
      lastUpdated = body.updatedAt || '';
      if (!state.counterparties.length && !state.orders.length) {
        /* Пустая база — показываем пример, но не сохраняем его сами:
           он исчезнет, как только появится первая настоящая запись */
        state = seedState();
        return pushState('Создан демонстрационный пример').then(() => state);
      }
      return state;
    });
}

/* Отправка на сервер. Событие попадает в историю и объясняет, что
   именно поменялось. */
function pushState(event) {
  return fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc: state, event: event || '' })
  }).then((res) => (res.ok ? res.json() : apiFail(res)))
    .then((body) => { lastUpdated = body.updatedAt; return body; });
}

function db() { return state || blankState(); }

/* save() вызывается из любого места после правки. Отправку откладываем
   и склеиваем: иначе каждый символ в поле уходил бы отдельным запросом. */
function save(event) {
  if (event) pendingEvent = event;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const label = pendingEvent;
    pendingEvent = '';
    pushState(label).catch((e) => {
      alert('Не удалось сохранить на сервере: ' + e.message +
            '\n\nПроверьте, что окно с сервером ещё открыто, и повторите правку.');
    });
  }, SAVE_DELAY);
}

/* Немедленная отправка — когда дальше идёт перезагрузка данных */
function saveNow(event) {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const label = event || pendingEvent;
  pendingEvent = '';
  return pushState(label);
}

function storedAt() { return lastUpdated; }

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
function upsert(collection, item, idPrefix, event) {
  const list = db()[collection];
  const isNew = !item.id;
  if (isNew) {
    item.id = uid(idPrefix || collection.slice(0, 3));
    list.push(item);
  } else {
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = Object.assign(list[i], item); else list.push(item);
  }
  save(event || ((isNew ? 'Добавлено: ' : 'Изменено: ') + collection));
  return item;
}

function remove(collection, id, event) {
  const list = db()[collection];
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) { list.splice(i, 1); save(event || ('Удалено: ' + collection)); }
}

/* Удаление контрагента уносит с собой всё, что на него ссылается:
   иначе в оплатах и документах остались бы строки без владельца. */
function removeCounterparty(cpId) {
  const d = db();
  /* Сначала собираем всё, что к нему относится: вложения этих записей
     сервер уберёт отдельно, по владельцу */
  const owners = [['cp', cpId], ['price', cpId]];
  d.documents.filter((x) => x.cpId === cpId).forEach((x) => owners.push(['doc', x.id]));
  d.orders.filter((x) => x.cpId === cpId).forEach((x) => owners.push(['order', x.id]));
  d.payments.filter((x) => x.cpId === cpId).forEach((x) => owners.push(['pay', x.id]));
  const gone = d.counterparties.find((c) => c.id === cpId);
  if (gone) (gone.contracts || []).forEach((k) => owners.push(['contract', k.id]));

  d.counterparties = d.counterparties.filter((c) => c.id !== cpId);
  ['orders', 'documents', 'payments', 'schedule', 'shipments'].forEach((k) => {
    d[k] = d[k].filter((x) => x.cpId !== cpId);
  });
  save('Удалён контрагент ' + (gone ? gone.name : ''));
  return Promise.all(owners.map((o) => dropFilesOf(o[0], o[1])));
}

function removeContract(cpId, contractId) {
  const c = cpById(cpId);
  if (!c) return Promise.resolve();
  const k = c.contracts.find((x) => x.id === contractId);
  c.contracts = c.contracts.filter((x) => x.id !== contractId);
  /* Ссылки на договор обнуляем, сами записи оставляем: оплата была,
     даже если договор убрали из справочника. */
  ['orders', 'documents', 'payments', 'schedule'].forEach((key) => {
    db()[key].forEach((x) => { if (x.contractId === contractId) x.contractId = ''; });
  });
  save('Удалён договор ' + (k ? k.name : ''));
  return dropFilesOf('contract', contractId);
}

/* ---------------------------------------------------------------- */
/* Вложенные файлы                                                  */
/* ---------------------------------------------------------------- */
/* Сами файлы и их описания живут на сервере, здесь только выборки по
   владельцу. Владельцы: cp — контрагент целиком, contract — договор,
   order — заказ, doc — документ, pay — оплата, price — прайс-лист. */
function docFiles(doc) { return doc ? filesOf('doc', doc.id) : []; }

function priceItems(c) {
  if (!c) return [];
  if (!Array.isArray(c.priceItems)) c.priceItems = [];
  return c.priceItems;
}

function priceFiles(c) { return c ? filesOf('price', c.id) : []; }

/* Сводка по вложениям документа: сколько файлов и подписан ли он.
   Документ считается подписанным, если хотя бы один скан подписан
   обеими сторонами — именно такой экземпляр имеет силу. */
function docSignState(doc) {
  const list = docFiles(doc);
  if (!list.length) return { count: 0, key: 'empty', label: 'нет скана' };
  if (list.some((f) => f.kind === 'both')) return { count: list.length, key: 'both', label: 'подписан обеими' };
  if (list.some((f) => f.kind === 'one')) return { count: list.length, key: 'one', label: 'одна сторона' };
  return { count: list.length, key: 'none', label: 'без подписей' };
}

/* Владельцы, которые ещё существуют. Сервер по этому списку убирает
   вложения записей, которых больше нет. */
function liveOwners() {
  const d = db();
  const out = [];
  d.counterparties.forEach((c) => {
    out.push('cp:' + c.id, 'price:' + c.id);
    (c.contracts || []).forEach((k) => out.push('contract:' + k.id));
  });
  d.orders.forEach((o) => out.push('order:' + o.id));
  d.documents.forEach((x) => out.push('doc:' + x.id));
  d.payments.forEach((p) => out.push('pay:' + p.id));
  d.shipments.forEach((sh) => out.push('ship:' + sh.id));
  return out;
}

/* Удаление документа уносит и его вложения */
function removeDocument(docId) {
  const doc = db().documents.find((d2) => d2.id === docId);
  /* Оплаты остаются: деньги пришли, даже если счёт убрали. Снимаем только
     ссылку, чтобы платёж не указывал в пустоту. То же с документами,
     выпущенными от этого счёта. */
  db().payments.forEach((p) => { if (p.docId === docId) p.docId = ''; });
  db().documents.forEach((x) => { if (x.baseDocId === docId) x.baseDocId = ''; });
  remove('documents', docId, 'Удалён документ ' + (doc ? (DOC_TYPES[doc.type] || '') + ' №' + (doc.number || '') : ''));
  return dropFilesOf('doc', docId);
}

function removeOrder(orderId) {
  /* Отгрузки живут только внутри заказа: без него они бессмысленны */
  db().shipments = db().shipments.filter((sh) => sh.orderId !== orderId);
  remove('orders', orderId, 'Удалён заказ');
  return dropFilesOf('order', orderId);
}

/* ---------------------------------------------------------------- */
/* Отгрузки                                                         */
/* ---------------------------------------------------------------- */
/* Отгрузка — это факт: что и сколько уехало к покупателю. Их может быть
   несколько на один заказ, поэтому считаем по позициям: по каждой видно,
   сколько заказано и сколько уже отгружено. */
function shipmentsOfOrder(orderId) {
  return db().shipments
    .filter((sh) => sh.orderId === orderId)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function shippedQty(orderId, itemId) {
  return shipmentsOfOrder(orderId).reduce((total, sh) =>
    total + sh.lines.reduce((n, l) => n + (l.itemId === itemId ? (Number(l.qty) || 0) : 0), 0), 0);
}

/* Сводка по отгрузке заказа. Доля считается по количеству позиций, а не
   по деньгам: отгружают штуки и тонны, а не рубли. */
function orderShipState(order) {
  if (!order) return { ordered: 0, shipped: 0, pct: 0, key: 'none', label: 'нет отгрузок', count: 0 };
  const ordered = order.items.reduce((n, it) => n + (Number(it.qty) || 0), 0);
  const shipped = order.items.reduce((n, it) => n + shippedQty(order.id, it.id), 0);
  const count = shipmentsOfOrder(order.id).length;
  const pct = ordered > 0 ? Math.min(100, shipped / ordered * 100) : 0;
  let key = 'none', label = 'не отгружен';
  if (shipped > 0 && shipped + 0.0001 < ordered) { key = 'part'; label = 'отгружен частично'; }
  else if (ordered > 0 && shipped + 0.0001 >= ordered) { key = 'full'; label = 'отгружен полностью'; }
  return { ordered: ordered, shipped: shipped, pct: pct, key: key, label: label, count: count };
}

/* ---------------------------------------------------------------- */
/* Выгрузка и загрузка                                              */
/* ---------------------------------------------------------------- */
/* Выгружаются записи и опись вложений. Сами файлы лежат в папке data
   рядом с программой — её и копируют целиком, когда нужна полная
   резервная копия. Класть мегабайты в JSON незачем: папка копируется
   быстрее и остаётся читаемой. */
function exportJSON() {
  return JSON.stringify({ doc: db(), files: allFiles(), exportedAt: new Date().toISOString() }, null, 2);
}

function importJSON(text, mode) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object') throw new Error('Файл не похож на выгрузку платформы');
  /* Понимаем и новый формат, и выгрузку прежней версии платформы */
  const doc = parsed.doc && parsed.doc.counterparties ? parsed.doc : parsed;
  if (!Array.isArray(doc.counterparties)) throw new Error('В файле нет списка контрагентов');

  if (mode === 'merge') {
    const d = db();
    const known = new Set(d.counterparties.map((c) => c.id));
    doc.counterparties.forEach((c) => { if (!known.has(c.id)) d.counterparties.push(c); });
    ['orders', 'documents', 'payments', 'schedule'].forEach((k) => {
      const ids = new Set(d[k].map((x) => x.id));
      (doc[k] || []).forEach((x) => { if (!ids.has(x.id)) d[k].push(x); });
    });
    state = normalize(d);
  } else {
    state = normalize(doc);
  }
  return saveNow(mode === 'merge' ? 'Загружены данные из файла (добавление)' : 'Загружены данные из файла');
}

function resetAll(withSample) {
  state = withSample ? seedState() : blankState();
  return saveNow(withSample ? 'Возвращён демонстрационный пример' : 'Данные очищены');
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
    priceItems: [
      { id: 'pi-a1', article: 'МР-25', name: 'Мука рыбная, мешок 25 кг', unit: 'т', price: 71000, note: 'Цена действует с начала квартала.' },
      { id: 'pi-a2', article: 'СЛ-2', name: 'Соль пищевая помол №2', unit: 'т', price: 9800, note: '' },
      { id: 'pi-a3', article: 'ТР-50', name: 'Тара полипропиленовая, 50 л', unit: 'шт', price: 215, note: 'От 1000 шт.' },
      { id: 'pi-a4', article: 'СТ-Г', name: 'Стропы грузовые', unit: 'шт', price: 1450, note: '' }
    ],
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
    priceItems: [
      { id: 'pi-s1', article: 'ЯЩ-20', name: 'Ящик рыбный 20 кг', unit: 'шт', price: 165, note: '' },
      { id: 'pi-s2', article: 'ЛД-Т', name: 'Лёд технический', unit: 'т', price: 4200, note: 'Доставка по городу включена.' }
    ],
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
      number: 'А-' + y + '/14', date: y + '-01-15', amount: 0, status: 'signed', note: 'Рамочный договор поставки.' },
    { id: 'doc-2', cpId: 'cp-amur', contractId: 'k-amur-main', orderId: 'ord-1', type: 'spec',
      number: 'С-114', date: day(-3, 5), amount: 892000, status: 'signed', note: '' },
    { id: 'doc-3', cpId: 'cp-amur', contractId: 'k-amur-main', orderId: 'ord-1', type: 'invoice',
      number: '114', date: day(-3, 6), amount: 892000, status: 'paid', note: 'Оплачен двумя частями.' },
    { id: 'doc-4', cpId: 'cp-amur', contractId: 'k-amur-main', orderId: 'ord-1', type: 'upd',
      number: 'УПД-114', date: day(-3, 18), amount: 892000, status: 'signed', note: '' },
    { id: 'doc-5', cpId: 'cp-amur', contractId: 'k-amur-barter', orderId: 'ord-2', type: 'contract',
      number: 'А-' + y + '/14-Б', date: y + '-02-03', amount: 0, status: 'signed', note: 'Бартерный договор.' },
    { id: 'doc-6', cpId: 'cp-amur', contractId: 'k-amur-barter', orderId: 'ord-2', type: 'spec',
      number: 'С-118Б', date: day(-2, 9), amount: 465000, status: 'signed', note: 'Перечень встречной поставки.' },
    { id: 'doc-7', cpId: 'cp-amur', contractId: 'k-amur-barter', orderId: 'ord-2', type: 'invoice',
      number: '118Б', date: day(-2, 10), amount: 465000, status: 'sent', note: 'Частично закрыт взаимозачётом.' },
    { id: 'doc-8', cpId: 'cp-sharks', contractId: 'k-sharks-main', orderId: '', type: 'contract',
      number: 'СА-' + y + '/07', date: y + '-03-11', amount: 0, status: 'signed', note: '' },
    { id: 'doc-9', cpId: 'cp-sharks', contractId: 'k-sharks-main', orderId: 'ord-3', type: 'spec',
      number: 'С-121', date: day(-1, 12), amount: 522000, status: 'sent', note: 'Ждём подпись.' },
    { id: 'doc-10', cpId: 'cp-sharks', contractId: 'k-sharks-main', orderId: 'ord-3', type: 'invoice',
      number: '121', date: day(-1, 13), amount: 522000, status: 'sent', note: 'Предоплата 50%.' }
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

  s.shipments = [
    { id: 'sh-1', cpId: 'cp-amur', orderId: 'ord-1', date: day(-3, 18), number: 'УПД-114',
      note: 'Отгружено полностью, машина своя.',
      lines: [{ itemId: 'it-1', qty: 12 }, { itemId: 'it-2', qty: 8 }] },
    { id: 'sh-2', cpId: 'cp-amur', orderId: 'ord-2', date: day(-1, 4), number: 'ТН-118',
      note: 'Первая часть бартера.',
      lines: [{ itemId: 'it-3', qty: 1200 }, { itemId: 'it-4', qty: 60 }] }
  ];

  s.schedule = [
    { id: 'sch-0', cpId: 'cp-amur', contractId: 'k-amur-main', orderId: 'ord-1', dueDate: day(-2, 10),
      amount: 392000, method: 'bank', status: 'paid', note: 'Остаток по счёту 114 — закрыт.' },
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
