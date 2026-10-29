/* Экраны платформы и их отрисовка.

   Навигация плоская: верхний ряд вкладок — разделы, у каждого контрагента
   своя вкладка в том же ряду. Внутри контрагента второй ряд вкладок:
   документы, заказы, оплаты, график, договоры, реквизиты.

   Отрисовка целиком перестраивает содержимое раздела из состояния —
   никакой точечной правки DOM, поэтому расхождений между экраном и
   данными не бывает. */
'use strict';

let route = { view: 'dash', cpId: '', sub: 'summary', orderId: '' };
let filters = { cpId: '', contractId: '', method: '', from: '', to: '', status: '', scan: '' };

/* Подглядывающий котик — общий для пустых мест платформы. Контур один,
   цвет берётся от текста, поэтому он живёт на любой подложке и в обеих
   темах. Глаза и нос — сквозные отверстия (fill-rule evenodd), так что
   сквозь них видно фон, а не залитый цвет. */
function catSVG() {
  return '<svg viewBox="0 0 128 80" fill="currentColor" aria-hidden="true" focusable="false">' +
    '<path fill-rule="evenodd" d="' +
      'M21 44 L30 2 L55 27 C61 23 67 23 73 27 L98 2 L107 44 ' +
      'C110 54 109 66 108 74 L20 74 C19 66 18 54 21 44 Z ' +
      'M35 44 a13 14 0 1 0 26 0 a13 14 0 1 0 -26 0 Z ' +
      'M67 44 a13 14 0 1 0 26 0 a13 14 0 1 0 -26 0 Z ' +
      'M59 60 L69 60 L64 66 Z' +
    '"/>' +
    '<path fill-rule="evenodd" d="' +
      'M40.5 46 a7.5 7.5 0 1 0 15 0 a7.5 7.5 0 1 0 -15 0 Z ' +
      'M42.9 42.8 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0 Z ' +
      'M72.5 46 a7.5 7.5 0 1 0 15 0 a7.5 7.5 0 1 0 -15 0 Z ' +
      'M74.9 42.8 a2.6 2.6 0 1 0 5.2 0 a2.6 2.6 0 1 0 -5.2 0 Z' +
    '"/>' +
    '<path d="M55 27 L51 15 L59 25 Z M63 24 L63 12 L67 24 Z M71 26 L78 15 L75 28 Z"/>' +
    '<path d="M5 75 C3 66 8 57 17 56 C20.5 55.6 22 58 22.5 60 C23.5 57.5 25.5 56 28.5 56.2 ' +
      'C31.5 56.5 33.5 58.2 34 60.6 C35 59 37 58.4 38.5 59.8 C41.5 62.4 39.5 70.5 38.5 75 Z"/>' +
    '<path d="M123 75 C125 66 120 57 111 56 C107.5 55.6 106 58 105.5 60 C104.5 57.5 102.5 56 99.5 56.2 ' +
      'C96.5 56.5 94.5 58.2 94 60.6 C93 59 91 58.4 89.5 59.8 C86.5 62.4 88.5 70.5 89.5 75 Z"/>' +
    '</svg>';
}

/* Пусто — не повод оставлять дыру: котик выглядывает оттуда, где данных
   ещё нет, и подсказка объясняет, что делать дальше. */
function emptyBox(text) {
  return '<div class="empty"><span class="empty__cat">' + catSVG() + '</span>' + text + '</div>';
}

/* ------------------------------------------------------------------ */
/* Мелкие помощники разметки                                          */
/* ------------------------------------------------------------------ */
function tag(text, cls) { return '<span class="tag ' + (cls || '') + '">' + esc(text) + '</span>'; }

function contractTag(cpId, contractId) {
  const k = contractById(cpId, contractId);
  if (!k) return '<span class="hint">без договора</span>';
  const kind = CONTRACT_KINDS[k.kind] || CONTRACT_KINDS.other;
  return '<span class="tag ' + kind.tag + '"><i class="swatch" style="background:' + kind.color + '"></i>' +
    esc(k.name) + '</span>';
}

function methodTag(method) {
  const m = PAY_METHODS[method] || PAY_METHODS.bank;
  return '<span class="tag"><i class="swatch" style="background:' + m.color + '"></i>' + esc(m.label) + '</span>';
}

function orderTag(status) {
  const s = ORDER_STATUSES[status] || ORDER_STATUSES.draft;
  return tag(s.label, s.tag);
}

function docTag(status) {
  const s = DOC_STATUSES[status] || DOC_STATUSES.draft;
  return tag(s.label, s.tag);
}

function kpi(label, value, hint, cls) {
  return '<div class="kpi ' + (cls || '') + '"><div class="kpi__label">' + esc(label) + '</div>' +
    '<div class="kpi__value">' + value + '</div>' +
    (hint ? '<div class="kpi__hint">' + hint + '</div>' : '') + '</div>';
}

function card(title, bodyHTML, opts) {
  const o = opts || {};
  return '<article class="card"' + (o.id ? ' id="' + o.id + '"' : '') + '>' +
    '<header class="card__head"><h2>' + esc(title) + '</h2>' +
    (o.tools ? '<div class="card__tools">' + o.tools + '</div>' : '') + '</header>' +
    '<div class="card__body' + (o.flush ? ' card__body--flush' : '') + '">' + bodyHTML + '</div>' +
    (o.note ? '<p class="card__note">' + o.note + '</p>' : '') + '</article>';
}

function selectOptions(pairs, current) {
  return pairs.map((p) => '<option value="' + esc(p[0]) + '"' +
    (String(p[0]) === String(current == null ? '' : current) ? ' selected' : '') + '>' + esc(p[1]) + '</option>').join('');
}

function cpOptions(includeAll) {
  const list = includeAll ? [['', 'Все контрагенты']] : [];
  return list.concat(db().counterparties.map((c) => [c.id, c.name]));
}

function contractOptions(cpId, includeAll) {
  const list = includeAll ? [['', 'Все договоры']] : [['', '— без договора —']];
  const cps = cpId ? [cpById(cpId)].filter(Boolean) : db().counterparties;
  cps.forEach((c) => c.contracts.forEach((k) => {
    list.push([k.id, (cpId ? '' : c.name + ' · ') + k.name + ' №' + (k.number || '—')]);
  }));
  return list;
}

/* Счета контрагента для привязки оплаты. Счёт — не обязателен: деньги
   могут прийти авансом, до выставления. */
function invoiceOptions(cpId, orderId) {
  const list = [['', '— без счёта —']];
  db().documents
    .filter((x) => x.type === 'invoice' && (!cpId || x.cpId === cpId) && (!orderId || x.orderId === orderId))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .forEach((x) => {
      const left = Number(x.amount) - paidByDoc(x.id);
      list.push([x.id, 'Счёт №' + (x.number || '—') + ' от ' + fmtDate(x.date) +
        ' · ' + fmtMoney(x.amount, { bare: true }) + (left > 0.5 ? ', осталось ' + fmtMoney(left, { bare: true }) : ', закрыт')]);
    });
  return list;
}

function orderOptions(cpId) {
  const list = [['', '— без заказа —']];
  db().orders.filter((o) => !cpId || o.cpId === cpId).forEach((o) => {
    list.push([o.id, 'Заказ ' + (o.number || o.id.slice(-4)) + ' от ' + fmtDate(o.date) +
      (cpId ? '' : ' · ' + cpName(o.cpId))]);
  });
  return list;
}

/* ------------------------------------------------------------------ */
/* Выборки и расчёты                                                  */
/* ------------------------------------------------------------------ */
function inPeriod(dateStr, from, to) {
  if (from && String(dateStr) < from) return false;
  if (to && String(dateStr) > to) return false;
  return true;
}

function paymentsOf(opts) {
  const o = opts || {};
  return db().payments.filter((p) =>
    (!o.cpId || p.cpId === o.cpId) &&
    (!o.contractId || p.contractId === o.contractId) &&
    (!o.method || p.method === o.method) &&
    (!o.orderId || p.orderId === o.orderId) &&
    inPeriod(p.date, o.from, o.to)
  ).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function ordersOf(opts) {
  const o = opts || {};
  return db().orders.filter((x) =>
    (!o.cpId || x.cpId === o.cpId) &&
    (!o.contractId || x.contractId === o.contractId) &&
    (!o.status || x.status === o.status) &&
    inPeriod(x.date, o.from, o.to)
  ).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function docsOf(opts) {
  const o = opts || {};
  return db().documents.filter((d) =>
    (!o.cpId || d.cpId === o.cpId) &&
    (!o.contractId || d.contractId === o.contractId) &&
    (!o.type || d.type === o.type) &&
    (!o.orderId || d.orderId === o.orderId) &&
    inPeriod(d.date, o.from, o.to)
  ).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function scheduleOf(opts) {
  const o = opts || {};
  return db().schedule.filter((s) =>
    (!o.cpId || s.cpId === o.cpId) &&
    (!o.contractId || s.contractId === o.contractId) &&
    (!o.method || s.method === o.method)
  ).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
}

function sum(list, field) {
  return list.reduce((s, x) => s + (Number(x[field == null ? 'amount' : field]) || 0), 0);
}

/* Состояние строки графика: оплачено вручную, просрочено или ожидается */
function schedStatus(s) {
  if (s.status === 'paid') return { key: 'paid', label: 'Оплачено', tag: 'tag--ok' };
  const d = daysFromToday(s.dueDate);
  if (d == null) return { key: 'plan', label: 'Без срока', tag: '' };
  if (d < 0) return { key: 'overdue', label: 'Просрочено на ' + Math.abs(d) + ' ' + plural(Math.abs(d), 'день', 'дня', 'дней'), tag: 'tag--bad' };
  if (d <= 7) return { key: 'soon', label: d === 0 ? 'Сегодня' : 'Через ' + d + ' ' + plural(d, 'день', 'дня', 'дней'), tag: 'tag--warn' };
  return { key: 'plan', label: 'Через ' + d + ' ' + plural(d, 'день', 'дня', 'дней'), tag: 'tag--info' };
}

/* Оплачено по заказу — из фактических оплат, привязанных к заказу */
function paidByOrder(orderId) {
  return sum(db().payments.filter((p) => p.orderId === orderId));
}

/* Счета по заказу. Спецификация и УПД сюда не входят: они описывают ту же
   поставку, и сложить их со счётом значило бы посчитать заказ дважды. */
function invoicesOfOrder(orderId) {
  return db().documents.filter((x) => x.orderId === orderId && x.type === 'invoice' && x.status !== 'rejected');
}

function invoicedByOrder(orderId) { return sum(invoicesOfOrder(orderId)); }

/* Оплаты, привязанные к конкретному счёту. Счёт может закрываться
   несколькими платежами — заказ при этом остаётся одним. */
function paymentsOfDoc(docId) {
  return db().payments.filter((p) => p.docId === docId);
}

function paidByDoc(docId) { return sum(paymentsOfDoc(docId)); }

/* Сводка по заказу: одна строка цепочки заказ → счета → оплаты.
   Оплаты берутся по заказу целиком, поэтому платёж, привязанный к счёту,
   и платёж без счёта считаются один раз и не теряются. */
function orderChain(order) {
  const total = orderTotal(order);
  const invoiced = invoicedByOrder(order.id);
  const pays = db().payments.filter((p) => p.orderId === order.id);
  const paid = sum(pays);
  return {
    total: total, invoiced: invoiced, paid: paid,
    payCount: pays.length, left: total - paid,
    docs: docsOf({ orderId: order.id }),
    overpaid: invoiced > 0 && paid - invoiced > 0.5
  };
}

/* Долг контрагента: выставлено счетами минус оплачено. Договоры и
   спецификации в сумму долга не входят — счёт определяет требование. */
function balanceOf(cpId, contractId) {
  const inv = db().documents.filter((d) => d.cpId === cpId && d.type === 'invoice' &&
    (!contractId || d.contractId === contractId) && d.status !== 'rejected');
  const paid = db().payments.filter((p) => p.cpId === cpId && (!contractId || p.contractId === contractId));
  return { invoiced: sum(inv), paid: sum(paid), debt: sum(inv) - sum(paid) };
}

/* Список месяцев от самой ранней записи до самой поздней, но не больше 18 */
function monthRange(dates, minCount) {
  const keys = dates.map(monthKey).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort();
  const nowKey = monthShift(0);
  let first = keys.length ? keys[0] : nowKey;
  let last = keys.length ? keys[keys.length - 1] : nowKey;
  if (last < nowKey) last = nowKey;
  const out = [];
  let [y, m] = first.split('-').map(Number);
  for (let guard = 0; guard < 120; guard++) {
    const key = y + '-' + String(m).padStart(2, '0');
    out.push(key);
    if (key >= last) break;
    m++; if (m > 12) { m = 1; y++; }
  }
  const want = minCount || 6;
  return out.length > 18 ? out.slice(-18) : out.length < want ? out : out;
}

function byMonth(list, dateField, months, pick) {
  const idx = {};
  months.forEach((k, i) => { idx[k] = i; });
  const out = months.map(() => 0);
  list.forEach((x) => {
    const i = idx[monthKey(x[dateField])];
    if (i != null) out[i] += pick ? pick(x) : (Number(x.amount) || 0);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Модальная форма                                                    */
/* ------------------------------------------------------------------ */
/* fields: [{ name, label, type, options, value, wide, required, step, hint }]
   type: text | number | date | select | textarea */
function openForm(cfg) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  const fields = cfg.fields.filter(Boolean);

  back.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(cfg.title) + '">' +
      '<header class="modal__head"><h2>' + esc(cfg.title) + '</h2>' +
        '<button class="btn btn--sm" data-close type="button">Закрыть</button></header>' +
      '<form class="modal__body" id="modal-form"><div class="form-grid">' +
        fields.map((f) => {
          const id = 'f-' + f.name;
          let input;
          if (f.type === 'select') {
            input = '<select id="' + id + '" name="' + esc(f.name) + '"' + (f.required ? ' required' : '') + '>' +
              selectOptions(f.options || [], f.value) + '</select>';
          } else if (f.type === 'textarea') {
            input = '<textarea id="' + id + '" name="' + esc(f.name) + '">' + esc(f.value || '') + '</textarea>';
          } else {
            input = '<input id="' + id + '" name="' + esc(f.name) + '" type="' + (f.type || 'text') + '"' +
              (f.type === 'number' ? ' step="' + (f.step || 'any') + '" inputmode="decimal"' : '') +
              ' value="' + esc(f.value == null ? '' : f.value) + '"' + (f.required ? ' required' : '') + '>';
          }
          return '<label class="field' + (f.wide ? ' field--wide' : '') + '"><span>' + esc(f.label) + '</span>' +
            input + (f.hint ? '<span class="hint">' + esc(f.hint) + '</span>' : '') + '</label>';
        }).join('') +
      '</div></form>' +
      '<footer class="modal__foot">' +
        (cfg.onDelete ? '<button class="btn btn--danger" data-del type="button">Удалить</button>' : '') +
        '<button class="btn" data-close type="button">Отмена</button>' +
        '<button class="btn btn--primary" data-save type="button">' + esc(cfg.saveLabel || 'Сохранить') + '</button>' +
      '</footer>' +
    '</div>';

  const close = () => { document.removeEventListener('keydown', onKey); back.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const collect = () => {
    const form = back.querySelector('#modal-form');
    const out = {};
    fields.forEach((f) => {
      const node = form.elements[f.name];
      if (!node) return;
      out[f.name] = f.type === 'number'
        ? (node.value === '' ? 0 : Number(String(node.value).replace(',', '.')))
        : node.value.trim();
    });
    return out;
  };

  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('[data-close]')) { close(); return; }
    if (e.target.closest('[data-del]')) {
      if (confirm('Удалить запись? Действие нельзя отменить.')) { cfg.onDelete(); close(); render(); }
      return;
    }
    if (e.target.closest('[data-save]')) {
      const form = back.querySelector('#modal-form');
      if (!form.reportValidity()) return;
      const values = collect();
      const err = cfg.validate ? cfg.validate(values) : null;
      if (err) { alert(err); return; }
      cfg.onSave(values);
      close();
      render();
    }
  });

  /* Связанные списки: при смене контрагента перестраиваем договоры и заказы */
  back.addEventListener('change', (e) => {
    const form = back.querySelector('#modal-form');
    const cpSel = form.elements.cpId;
    const dSel = back.querySelector('[name="docId"]');

    if (e.target.name === 'cpId') {
      const cpId = e.target.value;
      const kSel = back.querySelector('[name="contractId"]');
      if (kSel) kSel.innerHTML = selectOptions(contractOptions(cpId, false), '');
      const oSel = back.querySelector('[name="orderId"]');
      if (oSel) oSel.innerHTML = selectOptions(orderOptions(cpId), '');
      if (dSel) dSel.innerHTML = selectOptions(invoiceOptions(cpId, ''), '');
      return;
    }
    /* Выбрали заказ — список счетов сужается до его счетов: именно по ним
       и приходят деньги, а чужой счёт в этом списке только мешает */
    if (e.target.name === 'orderId' && dSel) {
      dSel.innerHTML = selectOptions(invoiceOptions(cpSel ? cpSel.value : '', e.target.value), '');
    }
  });

  document.body.appendChild(back);
  const first = back.querySelector('input, select, textarea');
  if (first) first.focus();
}

/* ------------------------------------------------------------------ */
/* Вложенные файлы документа                                          */
/* ------------------------------------------------------------------ */
const MAX_FILE_MB = 25;

/* Скрепка в таблице: сразу видно, есть ли скан и подписан ли он. */
function clipHTML(doc) {
  const st = docSignState(doc);
  if (!st.count) return '<span class="hint">—</span>';
  const cls = st.key === 'both' ? ' paperclip--signed' : '';
  return '<span class="paperclip' + cls + '" title="' + esc(st.label) + '">📎 ' + st.count +
    ' · ' + esc(st.label) + '</span>';
}

function signTag(signed) {
  const st = SIGN_STATES[signed] || SIGN_STATES.none;
  return tag(st.label, st.tag);
}

/* Открыть файл в новой вкладке. Страница может быть открыта из файла, и
   тогда у blob-ссылки нет происхождения — переход делаем настоящей
   ссылкой по клику пользователя, так надёжнее, чем window.open. */
function openBlob(blob, name, download) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  if (download) a.download = asciiFileName(name, 'document.pdf');
  else { a.target = '_blank'; a.rel = 'noopener'; }
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function openFilesModal(docId) {
  const doc = db().documents.find((x) => x.id === docId);
  if (!doc) return;

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true" aria-label="Файлы документа">' +
      '<header class="modal__head"><h2>Файлы: ' +
        esc(DOC_TYPES[doc.type] || doc.type) + ' №' + esc(doc.number || '—') + '</h2>' +
        '<button class="btn btn--sm" data-close type="button">Закрыть</button></header>' +
      '<div class="modal__body">' +
        '<p class="hint" style="margin-top:0">' + esc(cpName(doc.cpId)) + ' · ' + fmtDate(doc.date) +
          (Number(doc.amount) ? ' · ' + fmtMoney(doc.amount) : '') + '</p>' +
        '<div class="drop" id="drop" tabindex="0" role="button">' +
          '<span class="drop__cat">' + catSVG() + '</span>' +
          '<b>Перетащите сюда PDF или нажмите, чтобы выбрать</b>' +
          'Можно сразу несколько файлов: неподписанный и подписанный экземпляры. ' +
          'Принимаются PDF и фотографии скана, до ' + MAX_FILE_MB + '\u00a0МБ каждый.' +
        '</div>' +
        '<input type="file" id="file-input" accept="application/pdf,image/*" multiple hidden>' +
        '<div id="file-list" style="margin-top:16px"></div>' +
      '</div>' +
      '<footer class="modal__foot">' +
        '<button class="btn btn--primary" data-close type="button">Готово</button>' +
      '</footer>' +
    '</div>';

  const close = () => { document.removeEventListener('keydown', onKey); back.remove(); render(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const listBox = () => back.querySelector('#file-list');

  function paint() {
    const list = docFiles(doc);
    if (!list.length) {
      /* Котик уже сидит в зоне загрузки прямо над этим местом — второй
         подряд был бы перебором */
      listBox().innerHTML = '<p class="hint" style="text-align:center;margin:0">Файлов пока нет</p>';
      return;
    }
    listBox().innerHTML = '<div class="files">' + list.map((f) =>
      '<div class="file">' +
        '<span class="file__icon">' + (/(^image\/)/.test(f.type || '') ? 'IMG' : 'PDF') + '</span>' +
        '<span class="file__body">' +
          '<span class="file__name" title="' + esc(f.name) + '">' + esc(f.name) + '</span>' +
          '<span class="file__meta">' + fmtSize(f.size) + ' · загружен ' + fmtDate(f.addedAt) + '</span>' +
        '</span>' +
        '<label class="field" style="min-width:210px">' +
          '<span>Подписание</span>' +
          '<select data-sign="' + esc(f.id) + '">' +
            selectOptions(Object.keys(SIGN_STATES).map((k) => [k, SIGN_STATES[k].label]), f.signed) +
          '</select>' +
        '</label>' +
        '<span class="file__actions">' +
          '<button class="btn btn--sm" data-file-open="' + esc(f.id) + '" type="button">Открыть</button>' +
          '<button class="btn btn--sm" data-file-save="' + esc(f.id) + '" type="button">Скачать</button>' +
          '<button class="btn btn--sm btn--danger" data-file-del="' + esc(f.id) + '" type="button">Удалить</button>' +
        '</span>' +
      '</div>').join('') + '</div>';
  }

  function addFiles(fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    const tooBig = files.filter((f) => f.size > MAX_FILE_MB * 1048576);
    if (tooBig.length) {
      alert('Слишком большие файлы (больше ' + MAX_FILE_MB + ' МБ):\n' +
            tooBig.map((f) => f.name).join('\n') + '\n\nСожмите скан и попробуйте снова.');
    }
    const ok = files.filter((f) => f.size <= MAX_FILE_MB * 1048576);
    Promise.all(ok.map((f) => {
      const id = uid('file');
      return filePut(id, f).then(() => {
        docFiles(doc).push({
          id: id, name: f.name, size: f.size, type: f.type || 'application/pdf',
          signed: 'none', addedAt: today()
        });
      });
    })).then(() => { save(); paint(); })
      .catch((e) => alert('Не удалось сохранить файл: ' + e.message));
  }

  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('[data-close]')) { close(); return; }
    if (e.target.closest('#drop')) { back.querySelector('#file-input').click(); return; }

    const open = e.target.closest('[data-file-open]');
    const dl = e.target.closest('[data-file-save]');
    const del = e.target.closest('[data-file-del]');
    const id = (open || dl || del) && (open || dl || del).getAttribute(
      open ? 'data-file-open' : dl ? 'data-file-save' : 'data-file-del');
    if (!id) return;

    if (del) {
      const f = docFiles(doc).find((x) => x.id === id);
      if (!confirm('Удалить файл «' + (f ? f.name : '') + '»?')) return;
      fileDel(id).catch(() => null).then(() => {
        doc.files = docFiles(doc).filter((x) => x.id !== id);
        save(); paint();
      });
      return;
    }
    const meta = docFiles(doc).find((x) => x.id === id);
    fileGet(id).then((blob) => {
      if (!blob) { alert('Файл не найден в хранилище — возможно, он был удалён.'); return; }
      openBlob(blob, meta && meta.name, !!dl);
    }).catch((e) => alert('Не удалось прочитать файл: ' + e.message));
  });

  back.addEventListener('change', (e) => {
    if (e.target.id === 'file-input') { addFiles(e.target.files); e.target.value = ''; return; }
    const sign = e.target.closest('[data-sign]');
    if (sign) {
      const f = docFiles(doc).find((x) => x.id === sign.getAttribute('data-sign'));
      if (f) { f.signed = sign.value; save(); }
    }
  });

  /* Перетаскивание: гасим поведение браузера, иначе он просто откроет
     файл поверх страницы и работа потеряется */
  const drop = back.querySelector('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.add('drop--over');
  }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.remove('drop--over');
  }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer && e.dataTransfer.files));
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); back.querySelector('#file-input').click(); }
  });

  document.body.appendChild(back);
  paint();
}

/* ------------------------------------------------------------------ */
/* Навигация                                                          */
/* ------------------------------------------------------------------ */
function navHTML() {
  const cps = db().counterparties;
  const items = [['dash', 'Обзор']];
  const tabs = items.map((it) =>
    '<button class="tab' + (route.view === it[0] ? ' tab--active' : '') + '" data-nav="' + it[0] + '" type="button">' +
    esc(it[1]) + '</button>').join('');

  const cpTabs = cps.map((c, i) => {
    /* Контрагентов может быть сколько угодно, поэтому точка берёт ступень
       светлоты по месту в справочнике, а не отдельный тон: четыре разных
       тона из зелени и красного смешались бы при дальтонизме. */
    const color = 'var(--s' + ((i % 4) + 1) + ')';
    const active = route.view === 'cp' && route.cpId === c.id;
    return '<button class="tab' + (active ? ' tab--active' : '') + '" data-nav="cp" data-cp="' + esc(c.id) + '" type="button">' +
      '<i class="tab__dot" style="background:' + color + '"></i>' + esc(c.name) + '</button>';
  }).join('');

  const rest = [['orders', 'Заказы'], ['payments', 'Оплаты'], ['docs', 'Документы'],
                ['analytics', 'Аналитика'], ['cps', 'Контрагенты'], ['data', 'Данные']];
  const restTabs = rest.map((it) =>
    '<button class="tab' + (route.view === it[0] ? ' tab--active' : '') + '" data-nav="' + it[0] + '" type="button">' +
    esc(it[1]) + '</button>').join('');

  return tabs + cpTabs + restTabs;
}

function go(view, extra) {
  route = Object.assign({ view: view, cpId: '', sub: 'summary', orderId: '' }, extra || {});
  if (view === 'cp' && !route.sub) route.sub = 'summary';
  window.scrollTo({ top: 0 });
  render();
}

/* ------------------------------------------------------------------ */
/* Фильтры (общая полоса)                                            */
/* ------------------------------------------------------------------ */
function filtersHTML(opts) {
  const o = opts || {};
  let html = '<div class="filters">';
  if (o.cp) {
    html += '<label class="field"><span>Контрагент</span><select data-filter="cpId">' +
      selectOptions(cpOptions(true), filters.cpId) + '</select></label>';
  }
  if (o.contract) {
    html += '<label class="field"><span>Договор</span><select data-filter="contractId">' +
      selectOptions(contractOptions(filters.cpId, true), filters.contractId) + '</select></label>';
  }
  if (o.method) {
    html += '<label class="field"><span>Способ</span><select data-filter="method">' +
      selectOptions([['', 'Нал и безнал'], ['bank', 'Безнал'], ['cash', 'Нал']], filters.method) + '</select></label>';
  }
  if (o.status) {
    html += '<label class="field"><span>Статус</span><select data-filter="status">' +
      selectOptions([['', 'Любой']].concat(Object.keys(ORDER_STATUSES).map((k) => [k, ORDER_STATUSES[k].label])), filters.status) +
      '</select></label>';
  }
  if (o.period) {
    html += '<label class="field"><span>С даты</span><input type="date" data-filter="from" value="' + esc(filters.from) + '"></label>' +
      '<label class="field"><span>По дату</span><input type="date" data-filter="to" value="' + esc(filters.to) + '"></label>';
  }
  html += '<button class="btn" data-act="filters-reset" type="button">Сбросить</button>';
  if (o.extra) html += o.extra;
  return html + '</div>';
}

/* ------------------------------------------------------------------ */
/* Графики рисуются после вставки разметки: им нужен готовый DOM       */
/* ------------------------------------------------------------------ */
let chartJobs = [];

function chartSlot(id, draw, tableHTML) {
  chartJobs.push({ id: id, draw: draw });
  return '<div class="chart" id="' + id + '"></div>' +
    (tableHTML ? '<div id="' + id + '-tbl" hidden style="margin-top:10px">' + tableHTML + '</div>' : '');
}

function tableToggle(id) {
  return '<button class="btn btn--sm" data-act="toggle-table" data-target="' + id + '-tbl" type="button">Таблицей</button>';
}

/* ------------------------------------------------------------------ */
/* Обзор                                                              */
/* ------------------------------------------------------------------ */
function viewDash() {
  const d = db();
  const thisMonth = monthShift(0);
  const paidThis = sum(d.payments.filter((p) => monthKey(p.date) === thisMonth));
  const paidPrev = sum(d.payments.filter((p) => monthKey(p.date) === monthShift(-1)));
  const sched = d.schedule.filter((s) => s.status !== 'paid');
  const overdue = sched.filter((s) => schedStatus(s).key === 'overdue');
  const soon = sched.filter((s) => ['soon', 'plan'].indexOf(schedStatus(s).key) >= 0 && monthKey(s.dueDate) === thisMonth);
  const debtTotal = d.counterparties.reduce((s, c) => s + Math.max(0, balanceOf(c.id).debt), 0);
  const activeOrders = d.orders.filter((o) => ['draft', 'agreed', 'documented'].indexOf(o.status) >= 0);

  const delta = paidPrev ? ((paidThis - paidPrev) / paidPrev * 100) : null;
  const kpis =
    kpi('Оплаты за ' + fmtMonth(thisMonth), fmtMoney(paidThis),
        delta == null ? 'за прошлый месяц данных нет'
          : (delta >= 0 ? '▲ ' : '▼ ') + fmtPct(Math.abs(delta)) + ' к прошлому месяцу',
        delta == null ? '' : (delta >= 0 ? 'kpi--up' : 'kpi--down')) +
    kpi('Ожидается в этом месяце', fmtMoney(sum(soon, 'amount')),
        soon.length + ' ' + plural(soon.length, 'платёж', 'платежа', 'платежей') + ' по графику') +
    kpi('Просрочено', fmtMoney(sum(overdue, 'amount')),
        overdue.length ? overdue.length + ' ' + plural(overdue.length, 'строка', 'строки', 'строк') + ' графика' : 'нет просрочки',
        overdue.length ? 'kpi--down' : '') +
    kpi('Долг по счётам', fmtMoney(debtTotal), 'выставлено минус оплачено, авансы не вычитаются',
        debtTotal > 0 ? 'kpi--warn' : '') +
    kpi('Заказы в работе', String(activeOrders.length),
        fmtMoney(activeOrders.reduce((s, o) => s + orderTotal(o), 0)) + ' на сумму');

  /* Оплаты по месяцам: разделение нал/безнал — то, что спрашивают первым */
  const months = monthRange(d.payments.map((p) => p.date).concat(d.schedule.map((s) => s.dueDate)));
  const payMonths = months.map(fmtMonth);
  const seriesMethod = Object.keys(PAY_METHODS).map((k) => ({
    key: k, label: PAY_METHODS[k].label, color: PAY_METHODS[k].color,
    values: byMonth(d.payments.filter((p) => p.method === k), 'date', months)
  }));

  const nearest = sched.slice().sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))).slice(0, 8);

  /* Доля контрагента в поступлениях: цвет закреплён за ним по месту в
     справочнике, как и точка на его вкладке */
  const cpRows = d.counterparties.map((c, i) => ({
    label: c.name,
    color: 'var(--s' + ((i % 4) + 1) + ')',
    value: sum(d.payments.filter((p) => p.cpId === c.id))
  })).sort((a, b) => b.value - a.value);

  /* Три доли, которые спрашивают первыми: сколько из заказанного оплачено,
     насколько закрыт график и чем платят. */
  const ordersAll = d.orders.reduce((s2, o) => s2 + orderTotal(o), 0);
  const paidAll = sum(d.payments);
  const schedAll = sum(d.schedule, 'amount');
  const schedDone = sum(d.schedule.filter((x) => x.status === 'paid'), 'amount');
  const bankAll = sum(d.payments.filter((p) => p.method === 'bank'));
  const ringItems = [
    { value: paidAll, max: ordersAll, label: 'Оплачено от заказов', cap: 'Доля',
      sub: fmtMoney(paidAll) + ' из ' + fmtMoney(ordersAll), color: 'var(--c1)' },
    { value: schedDone, max: schedAll, label: 'График закрыт', cap: 'Доля',
      sub: fmtMoney(schedAll - schedDone) + ' осталось', color: 'var(--accent)' }
  ];
  /* Безнал всюду зелёный, нал малиновый — пончик держит те же цвета, что
     столбцы и метки, иначе читался бы как другая величина */
  const methodDonut = Object.keys(PAY_METHODS).map((k) => ({
    label: PAY_METHODS[k].label, color: PAY_METHODS[k].color,
    value: sum(d.payments.filter((p) => p.method === k))
  }));

  return '<div class="kpi-grid">' + kpis + '</div>' +
    '<div class="grid2">' +
      card('Как идут расчёты', chartSlot('ch-dash-rings', (host) => ringGauge(host, ringItems)),
        { note: 'Точные суммы — под каждым кольцом и в таблицах разделов.' }) +
      card('Нал и безнал',
        chartSlot('ch-dash-donut', (host) => donutChart(host, methodDonut,
          { cap: 'Поступило', center: fmtShort(paidAll) })),
        { note: 'За всё время. Помесячно — на графике ниже.' }) +
    '</div>' +
    card('Оплаты по месяцам — нал и безнал',
      chartSlot('ch-dash-pay', (host) => stackedBars(host, { labels: payMonths, series: seriesMethod }),
        seriesTable(payMonths, seriesMethod)),
      { tools: tableToggle('ch-dash-pay'), note: 'Фактические поступления по дате оплаты. Разрез по договорам — во вкладке «Оплаты».' }) +
    '<div class="grid2">' +
      card('Ближайшие платежи по графику', nearest.length ? schedTable(nearest, { compact: true }) :
        emptyBox('График пуст — добавьте плановые платежи во вкладке «Оплаты»'),
        { flush: nearest.length > 0, tools: '<button class="btn btn--sm" data-act="go-payments" type="button">Весь график</button>' }) +
      card('Доля в поступлениях', chartSlot('ch-dash-cp', (host) => dotMeters(host, cpRows)),
        { note: 'За всё время. Точки — доля контрагента в общей сумме поступлений.' }) +
    '</div>';
}

/* ------------------------------------------------------------------ */
/* Таблица графика платежей                                           */
/* ------------------------------------------------------------------ */
function schedTable(rows, opts) {
  const o = opts || {};
  if (!rows.length) return emptyBox('Строк нет');
  return '<div class="table-wrap"><table class="tbl"><thead><tr>' +
    '<th>Срок</th><th>Состояние</th>' + (o.compact ? '<th>Контрагент</th>' : '<th>Контрагент</th><th>Договор</th><th>Заказ</th>') +
    '<th>Способ</th><th class="num">Сумма</th>' + (o.compact ? '' : '<th>Комментарий</th><th></th>') +
    '</tr></thead><tbody>' +
    rows.map((s) => {
      const st = schedStatus(s);
      return '<tr><td class="nowrap">' + fmtDate(s.dueDate) + '</td>' +
        '<td>' + tag(st.label, st.tag) + '</td>' +
        '<td class="nowrap">' + esc(cpName(s.cpId)) + '</td>' +
        (o.compact ? '' : '<td>' + contractTag(s.cpId, s.contractId) + '</td>' +
          '<td class="nowrap">' + (s.orderId ? esc(orderLabel(s.orderId)) : '<span class="hint">—</span>') + '</td>') +
        '<td>' + methodTag(s.method) + '</td>' +
        '<td class="num">' + fmtMoney(s.amount) + '</td>' +
        (o.compact ? '' : '<td>' + esc(s.note || '') + '</td>' +
          '<td><div class="row-actions">' +
            (s.status === 'paid' ? '' : '<button class="btn btn--sm btn--primary" data-act="sched-pay" data-id="' + esc(s.id) + '" type="button">Оплачено</button>') +
            '<button class="btn btn--sm" data-act="sched-edit" data-id="' + esc(s.id) + '" type="button">Правка</button>' +
          '</div></td>') +
        '</tr>';
    }).join('') +
    '</tbody><tfoot><tr><td colspan="' + (o.compact ? 4 : 6) + '">Итого</td>' +
    '<td class="num">' + fmtMoney(sum(rows, 'amount')) + '</td>' + (o.compact ? '' : '<td colspan="2"></td>') +
    '</tr></tfoot></table></div>';
}

/* Ссылка на счёт в строке оплаты */
function docLabel(docId) {
  if (!docId) return '<span class="hint">—</span>';
  const d = db().documents.find((x) => x.id === docId);
  return d ? esc('№' + (d.number || '—')) : '<span class="hint">удалён</span>';
}

/* ------------------------------------------------------------------ */
/* Таблица фактических оплат                                          */
/* ------------------------------------------------------------------ */
function payTable(rows, opts) {
  const o = opts || {};
  if (!rows.length) return emptyBox('Оплат по этому фильтру нет');
  return '<div class="table-wrap"><table class="tbl"><thead><tr>' +
    '<th>Дата</th>' + (o.hideCp ? '' : '<th>Контрагент</th>') + '<th>Договор</th><th>Заказ</th><th>Счёт</th>' +
    '<th>Способ</th><th class="num">Сумма</th><th>Комментарий</th><th></th>' +
    '</tr></thead><tbody>' +
    rows.map((p) => '<tr>' +
      '<td class="nowrap">' + fmtDate(p.date) + '</td>' +
      (o.hideCp ? '' : '<td class="nowrap">' + esc(cpName(p.cpId)) + '</td>') +
      '<td>' + contractTag(p.cpId, p.contractId) + '</td>' +
      '<td class="nowrap">' + (p.orderId ? esc(orderLabel(p.orderId)) : '<span class="hint">—</span>') + '</td>' +
      '<td class="nowrap">' + docLabel(p.docId) + '</td>' +
      '<td>' + methodTag(p.method) + '</td>' +
      '<td class="num">' + fmtMoney(p.amount) + '</td>' +
      '<td>' + esc(p.note || '') + '</td>' +
      '<td><button class="btn btn--sm" data-act="pay-edit" data-id="' + esc(p.id) + '" type="button">Правка</button></td>' +
      '</tr>').join('') +
    '</tbody><tfoot><tr><td colspan="' + (o.hideCp ? 5 : 6) + '">Итого ' + rows.length + ' ' +
    plural(rows.length, 'оплата', 'оплаты', 'оплат') + '</td>' +
    '<td class="num">' + fmtMoney(sum(rows, 'amount')) + '</td><td colspan="2"></td></tr></tfoot></table></div>';
}

/* Под суммой счёта — сколько по нему уже пришло. Счёт закрывается
   частями, и в строке должно быть видно, сколько осталось. */
function invoicePaidHTML(doc) {
  if (doc.type !== 'invoice' || !Number(doc.amount)) return '';
  const paid = paidByDoc(doc.id);
  if (!paid) return '<div class="hint" style="font-family:var(--sans)">не оплачен</div>';
  const left = Number(doc.amount) - paid;
  const n = paymentsOfDoc(doc.id).length;
  return '<div class="hint" style="font-family:var(--sans)">' +
    (left > 0.5
      ? 'оплачено ' + fmtMoney(paid) + ', осталось ' + fmtMoney(left)
      : 'оплачен полностью') +
    (n > 1 ? ' · ' + n + ' ' + plural(n, 'платёж', 'платежа', 'платежей') : '') +
    '</div>';
}

/* ------------------------------------------------------------------ */
/* Таблица документов                                                 */
/* ------------------------------------------------------------------ */
function docTable(rows, opts) {
  const o = opts || {};
  if (!rows.length) return emptyBox('Документов по этому фильтру нет');
  /* В узкой карточке показываем только то, что помещается без прокрутки:
     остальное — в полной истории документов контрагента */
  if (o.compact) {
    return '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>Дата</th><th>Тип</th><th>Номер</th><th>Договор</th><th class="num">Сумма</th><th>Скан</th>' +
      '</tr></thead><tbody>' + rows.map((x) => '<tr>' +
        '<td class="nowrap">' + fmtDate(x.date) + '</td>' +
        '<td class="nowrap">' + esc(DOC_TYPES[x.type] || x.type) + '</td>' +
        '<td class="nowrap">' + esc(x.number || '—') + '</td>' +
        '<td>' + contractTag(x.cpId, x.contractId) + '</td>' +
        '<td class="num">' + (Number(x.amount) ? fmtMoney(x.amount) : '<span class="hint">—</span>') + '</td>' +
        '<td class="nowrap">' + clipHTML(x) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }
  return '<div class="table-wrap"><table class="tbl"><thead><tr>' +
    '<th>Дата</th><th>Тип</th><th>Номер</th>' + (o.hideCp ? '' : '<th>Контрагент</th>') +
    '<th>Договор</th><th>Заказ</th><th class="num">Сумма</th><th>Статус</th><th>Скан</th><th>Комментарий</th><th></th>' +
    '</tr></thead><tbody>' +
    rows.map((x) => '<tr>' +
      '<td class="nowrap">' + fmtDate(x.date) + '</td>' +
      '<td class="nowrap">' + esc(DOC_TYPES[x.type] || x.type) + '</td>' +
      '<td class="nowrap">' + esc(x.number || '—') + '</td>' +
      (o.hideCp ? '' : '<td class="nowrap">' + esc(cpName(x.cpId)) + '</td>') +
      '<td>' + contractTag(x.cpId, x.contractId) + '</td>' +
      '<td class="nowrap">' + (x.orderId ? esc(orderLabel(x.orderId)) : '<span class="hint">—</span>') + '</td>' +
      '<td class="num">' + (Number(x.amount) ? fmtMoney(x.amount) : '<span class="hint">—</span>') +
        invoicePaidHTML(x) + '</td>' +
      '<td>' + docTag(x.status) + '</td>' +
      '<td class="nowrap">' + clipHTML(x) + '</td>' +
      '<td>' + esc(x.note || '') + '</td>' +
      '<td><div class="row-actions">' +
        '<button class="btn btn--sm btn--primary" data-act="doc-files" data-id="' + esc(x.id) + '" type="button">Файлы</button>' +
        '<button class="btn btn--sm" data-act="doc-edit" data-id="' + esc(x.id) + '" type="button">Правка</button>' +
      '</div></td>' +
      '</tr>').join('') +
    /* В итог идут только счета. Спецификация, УПД и акт описывают ту же
       поставку, и сумма всех документов подряд завысила бы заказ в разы. */
    '</tbody><tfoot><tr><td colspan="' + (o.hideCp ? 5 : 6) + '">Итого ' + rows.length + ' ' +
    plural(rows.length, 'документ', 'документа', 'документов') + ', из них счетов на</td>' +
    '<td class="num">' + fmtMoney(sum(rows.filter((x) => x.type === 'invoice' && x.status !== 'rejected'), 'amount')) +
    '</td><td colspan="4"></td></tr></tfoot></table></div>';
}

/* ------------------------------------------------------------------ */
/* Таблица заказов                                                    */
/* ------------------------------------------------------------------ */
function orderTable(rows, opts) {
  const o = opts || {};
  if (!rows.length) return emptyBox('Заказов по этому фильтру нет');
  return '<div class="table-wrap"><table class="tbl"><thead><tr>' +
    '<th>Дата</th><th>Номер</th>' + (o.hideCp ? '' : '<th>Контрагент</th>') + '<th>Договор</th>' +
    '<th>Статус</th><th class="num">Позиций</th><th class="num">Сумма</th>' +
    '<th class="num">Выставлено</th><th class="num">Оплачено</th>' +
    '<th>Готовность оплаты</th><th></th></tr></thead><tbody>' +
    rows.map((x) => {
      const total = orderTotal(x);
      const paid = paidByOrder(x.id);
      const pct = total ? Math.min(100, paid / total * 100) : 0;
      return '<tr>' +
        '<td class="nowrap">' + fmtDate(x.date) + '</td>' +
        '<td class="nowrap"><b>' + esc(x.number || x.id.slice(-4)) + '</b></td>' +
        (o.hideCp ? '' : '<td class="nowrap">' + esc(cpName(x.cpId)) + '</td>') +
        '<td>' + contractTag(x.cpId, x.contractId) + '</td>' +
        '<td>' + orderTag(x.status) + '</td>' +
        '<td class="num">' + x.items.length + '</td>' +
        '<td class="num">' + fmtMoney(total) + '</td>' +
        '<td class="num">' + (invoicedByOrder(x.id) ? fmtMoney(invoicedByOrder(x.id)) : '<span class="hint">—</span>') + '</td>' +
        '<td class="num">' + fmtMoney(paid) + '</td>' +
        '<td><div class="prog' + (paid > total && total ? ' prog--over' : '') + '" title="' + fmtPct(pct) + '">' +
          '<i style="width:' + pct + '%"></i></div></td>' +
        '<td><button class="btn btn--sm" data-act="order-open" data-id="' + esc(x.id) + '" type="button">Открыть</button></td>' +
        '</tr>';
    }).join('') +
    '</tbody><tfoot><tr><td colspan="' + (o.hideCp ? 5 : 6) + '">Итого ' + rows.length + ' ' +
    plural(rows.length, 'заказ', 'заказа', 'заказов') + '</td>' +
    '<td class="num">' + fmtMoney(rows.reduce((s, x) => s + orderTotal(x), 0)) + '</td>' +
    '<td class="num">' + fmtMoney(rows.reduce((s, x) => s + invoicedByOrder(x.id), 0)) + '</td>' +
    '<td class="num">' + fmtMoney(rows.reduce((s, x) => s + paidByOrder(x.id), 0)) + '</td>' +
    '<td colspan="2"></td></tr></tfoot></table></div>';
}

/* ------------------------------------------------------------------ */
/* Вкладка контрагента                                                */
/* ------------------------------------------------------------------ */
function viewCp() {
  const c = cpById(route.cpId);
  if (!c) { route.view = 'cps'; return viewCps(); }

  const subs = [['summary', 'Сводка'], ['docs', 'Документы'], ['orders', 'Заказы'],
                ['payments', 'Оплаты'], ['schedule', 'График'], ['price', 'Прайс-лист'],
                ['contracts', 'Договоры'], ['card', 'Реквизиты']];
  const nav = '<nav class="tabs tabs--sub">' + subs.map((s) =>
    '<button class="tab' + (route.sub === s[0] ? ' tab--active' : '') + '" data-sub="' + s[0] + '" type="button">' +
    esc(s[1]) + '</button>').join('') + '</nav>';

  const head = '<div class="card__head" style="border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-elev);margin-bottom:14px">' +
    '<div><h1>' + esc(c.name) + '</h1><p class="topbar__subtitle">' +
      esc(c.fullName || '') + (c.inn ? ' · ИНН ' + esc(c.inn) : '') + (c.city ? ' · ' + esc(c.city) : '') + '</p></div>' +
    '<div class="card__tools">' +
      '<button class="btn btn--primary" data-act="order-new" data-cp="' + esc(c.id) + '" type="button">+ Заказ</button>' +
      '<button class="btn" data-act="pay-new" data-cp="' + esc(c.id) + '" type="button">+ Оплата</button>' +
      '<button class="btn" data-act="doc-new" data-cp="' + esc(c.id) + '" type="button">+ Документ</button>' +
      '<button class="btn" data-act="sched-new" data-cp="' + esc(c.id) + '" type="button">+ В график</button>' +
      '<button class="btn" data-sub="price" type="button">Прайс-лист</button>' +
    '</div></div>';

  let body = '';
  if (route.sub === 'summary') body = cpSummary(c);
  else if (route.sub === 'docs') body = cpDocs(c);
  else if (route.sub === 'orders') body = cpOrders(c);
  else if (route.sub === 'payments') body = cpPayments(c);
  else if (route.sub === 'schedule') body = cpSchedule(c);
  else if (route.sub === 'price') body = cpPrice(c);
  else if (route.sub === 'contracts') body = cpContracts(c);
  else body = cpCard(c);

  return head + nav + body;
}

function cpSummary(c) {
  const bal = balanceOf(c.id);
  const pays = paymentsOf({ cpId: c.id });
  const sched = scheduleOf({ cpId: c.id }).filter((s) => s.status !== 'paid');
  const overdue = sched.filter((s) => schedStatus(s).key === 'overdue');
  const orders = ordersOf({ cpId: c.id });
  const active = orders.filter((o) => ['draft', 'agreed', 'documented'].indexOf(o.status) >= 0);
  const lastPay = pays[0];

  const kpis =
    kpi('Выставлено счетами', fmtMoney(bal.invoiced), 'по всем договорам') +
    kpi('Оплачено', fmtMoney(bal.paid),
        lastPay ? 'последняя оплата ' + fmtDate(lastPay.date) : 'оплат не было', 'kpi--up') +
    (bal.debt < 0
      ? kpi('Аванс', fmtMoney(-bal.debt), 'оплачено сверх выставленного', 'kpi--up')
      : kpi('Долг', fmtMoney(bal.debt), bal.debt > 0 ? 'ждём оплату' : 'расчёты закрыты',
            bal.debt > 0 ? 'kpi--warn' : '')) +
    kpi('Просрочено по графику', fmtMoney(sum(overdue, 'amount')),
        overdue.length ? overdue.length + ' ' + plural(overdue.length, 'строка', 'строки', 'строк') : 'нет',
        overdue.length ? 'kpi--down' : '') +
    kpi('Заказы в работе', String(active.length), fmtMoney(active.reduce((s, o) => s + orderTotal(o), 0)));

  /* По договорам: отдельный расчёт на каждый — у Амура основной и бартерный
     живут своей жизнью и смешивать их в одну сумму нельзя */
  const perContract = c.contracts.map((k) => {
    const b = balanceOf(c.id, k.id);
    const kind = CONTRACT_KINDS[k.kind] || CONTRACT_KINDS.other;
    const cash = sum(db().payments.filter((p) => p.cpId === c.id && p.contractId === k.id && p.method === 'cash'));
    const bank = sum(db().payments.filter((p) => p.cpId === c.id && p.contractId === k.id && p.method === 'bank'));
    return '<tr><td>' + contractTag(c.id, k.id) + '</td>' +
      '<td class="nowrap">№' + esc(k.number || '—') + ' от ' + fmtDate(k.date) + '</td>' +
      '<td class="num">' + fmtMoney(b.invoiced) + '</td>' +
      '<td class="num">' + fmtMoney(bank) + '</td>' +
      '<td class="num">' + fmtMoney(cash) + '</td>' +
      '<td class="num">' + fmtMoney(b.debt) + '</td>' +
      '<td>' + esc(k.payTerms || '') + '</td></tr>';
  }).join('');

  const months = monthRange(db().payments.filter((p) => p.cpId === c.id).map((p) => p.date));
  const labels = months.map(fmtMonth);
  const byContract = c.contracts.map((k) => ({
    label: k.name, color: (CONTRACT_KINDS[k.kind] || CONTRACT_KINDS.other).color,
    values: byMonth(db().payments.filter((p) => p.cpId === c.id && p.contractId === k.id), 'date', months)
  }));
  const noContract = byMonth(db().payments.filter((p) => p.cpId === c.id && !p.contractId), 'date', months);
  if (noContract.some((v) => v)) byContract.push({ label: 'Без договора', color: 'var(--s4)', values: noContract });

  const docs = docsOf({ cpId: c.id }).slice(0, 6);

  const ordersSum = orders.reduce((s2, o) => s2 + orderTotal(o), 0);
  const bankSum = sum(pays.filter((p) => p.method === 'bank'));
  const closed = orders.filter((o) => o.status === 'closed').length;
  const cpRings = [
    { value: bal.paid, max: bal.invoiced, label: 'Оплачено от выставленного',
      sub: fmtMoney(bal.paid) + ' из ' + fmtMoney(bal.invoiced), color: 'var(--c1)' },
    { value: bankSum, max: bal.paid, label: 'Доля безнала',
      sub: fmtMoney(bal.paid - bankSum) + ' налом', color: 'var(--c1)' },
    { value: closed, max: orders.length, label: 'Заказы закрыты',
      center: closed + ' / ' + orders.length,
      sub: fmtMoney(ordersSum) + ' всего', color: 'var(--accent)' }
  ];

  return '<div class="kpi-grid">' + kpis + '</div>' +
    card('Как идут расчёты', chartSlot('ch-cp-rings', (host) => ringGauge(host, cpRings))) +
    card('Расчёты по договорам',
      c.contracts.length ? '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th>Договор</th><th>Реквизиты</th><th class="num">Выставлено</th><th class="num">Безнал</th>' +
        '<th class="num">Нал</th><th class="num">Долг</th><th>Условия оплаты</th></tr></thead><tbody>' +
        perContract + '</tbody></table></div>'
        : emptyBox('Договоров нет — добавьте во вкладке «Договоры»'),
      { flush: c.contracts.length > 0 }) +
    card('Оплаты по месяцам и договорам',
      chartSlot('ch-cp-pay', (host) => stackedBars(host, { labels: labels, series: byContract }),
        seriesTable(labels, byContract)),
      { tools: tableToggle('ch-cp-pay'),
        note: 'Цвет закреплён за договором: основной — зелёный, бартерный — синий.' }) +
    '<div class="grid2">' +
      card('Последние документы', docs.length ? docTable(docs, { hideCp: true, compact: true }) : emptyBox('Документов нет'),
        { flush: docs.length > 0, tools: '<button class="btn btn--sm" data-sub="docs" type="button">Вся история</button>' }) +
      card('График платежей', sched.length ? schedTable(sched.slice(0, 8), { compact: true }) : emptyBox('График пуст'),
        { flush: sched.length > 0, tools: '<button class="btn btn--sm" data-sub="schedule" type="button">Весь график</button>' }) +
    '</div>';
}

function cpDocs(c) {
  const types = [['', 'Все типы']].concat(Object.keys(DOC_TYPES).map((k) => [k, DOC_TYPES[k]]));
  const rows = filterByScan(docsOf({ cpId: c.id, contractId: filters.contractId, type: filters.status,
                                    from: filters.from, to: filters.to }));
  const byType = Object.keys(DOC_TYPES).map((t, i) => ({
    label: DOC_TYPES[t],
    parts: [{ label: DOC_TYPES[t], color: 'var(--s' + ((i % 4) + 1) + ')',
      value: sum(docsOf({ cpId: c.id, type: t })) }]
  })).filter((r) => r.parts[0].value > 0);

  return '<div class="filters">' +
      '<label class="field"><span>Договор</span><select data-filter="contractId">' +
        selectOptions(contractOptions(c.id, true), filters.contractId) + '</select></label>' +
      '<label class="field"><span>Тип</span><select data-filter="status">' + selectOptions(types, filters.status) + '</select></label>' +
      '<label class="field"><span>Скан</span><select data-filter="scan">' + selectOptions(SCAN_OPTIONS, filters.scan) + '</select></label>' +
      '<label class="field"><span>С даты</span><input type="date" data-filter="from" value="' + esc(filters.from) + '"></label>' +
      '<label class="field"><span>По дату</span><input type="date" data-filter="to" value="' + esc(filters.to) + '"></label>' +
      '<button class="btn" data-act="filters-reset" type="button">Сбросить</button>' +
      '<button class="btn btn--primary" data-act="doc-new" data-cp="' + esc(c.id) + '" type="button">+ Документ</button>' +
    '</div>' +
    '<div class="kpi-grid">' + docScanKPIs(rows) + '</div>' +
    card('История документов — ' + c.name, docTable(rows, { hideCp: true }),
      { flush: true, note: 'Счёт, спецификация, оплата, УПД и акт одной лентой: видно, что уже выпущено, а что ещё нет.' }) +
    (byType.length ? card('Суммы по типам документов', chartSlot('ch-cp-doctype', (host) => hBars(host, byType))) : '');
}

function cpOrders(c) {
  const rows = ordersOf({ cpId: c.id, contractId: filters.contractId, status: filters.status });
  return '<div class="filters">' +
      '<label class="field"><span>Договор</span><select data-filter="contractId">' +
        selectOptions(contractOptions(c.id, true), filters.contractId) + '</select></label>' +
      '<label class="field"><span>Статус</span><select data-filter="status">' +
        selectOptions([['', 'Любой']].concat(Object.keys(ORDER_STATUSES).map((k) => [k, ORDER_STATUSES[k].label])), filters.status) +
        '</select></label>' +
      '<button class="btn" data-act="filters-reset" type="button">Сбросить</button>' +
      '<button class="btn btn--primary" data-act="order-new" data-cp="' + esc(c.id) + '" type="button">+ Новый заказ</button>' +
    '</div>' +
    card('Заказы — ' + c.name, orderTable(rows, { hideCp: true }), { flush: true });
}

function cpPayments(c) {
  const rows = paymentsOf({ cpId: c.id, contractId: filters.contractId, method: filters.method, from: filters.from, to: filters.to });
  const months = monthRange(db().payments.filter((p) => p.cpId === c.id).map((p) => p.date));
  const labels = months.map(fmtMonth);
  const byMethod = Object.keys(PAY_METHODS).map((k) => ({
    label: PAY_METHODS[k].label, color: PAY_METHODS[k].color,
    values: byMonth(db().payments.filter((p) => p.cpId === c.id && p.method === k), 'date', months)
  }));
  const cash = sum(rows.filter((p) => p.method === 'cash'));
  const bank = sum(rows.filter((p) => p.method === 'bank'));
  const total = cash + bank;

  return '<div class="filters">' +
      '<label class="field"><span>Договор</span><select data-filter="contractId">' +
        selectOptions(contractOptions(c.id, true), filters.contractId) + '</select></label>' +
      '<label class="field"><span>Способ</span><select data-filter="method">' +
        selectOptions([['', 'Нал и безнал'], ['bank', 'Безнал'], ['cash', 'Нал']], filters.method) + '</select></label>' +
      '<label class="field"><span>С даты</span><input type="date" data-filter="from" value="' + esc(filters.from) + '"></label>' +
      '<label class="field"><span>По дату</span><input type="date" data-filter="to" value="' + esc(filters.to) + '"></label>' +
      '<button class="btn" data-act="filters-reset" type="button">Сбросить</button>' +
      '<button class="btn btn--primary" data-act="pay-new" data-cp="' + esc(c.id) + '" type="button">+ Оплата</button>' +
    '</div>' +
    '<div class="kpi-grid">' +
      kpi('Итого по фильтру', fmtMoney(total), rows.length + ' ' + plural(rows.length, 'оплата', 'оплаты', 'оплат')) +
      kpi('Безнал', fmtMoney(bank), total ? fmtPct(bank / total * 100) + ' от суммы' : '') +
      kpi('Нал', fmtMoney(cash), total ? fmtPct(cash / total * 100) + ' от суммы' : '') +
    '</div>' +
    card('Оплаты по месяцам — нал и безнал',
      chartSlot('ch-cp-method', (host) => stackedBars(host, { labels: labels, series: byMethod }),
        seriesTable(labels, byMethod)), { tools: tableToggle('ch-cp-method') }) +
    card('Все оплаты — ' + c.name, payTable(rows, { hideCp: true }), { flush: true });
}

function cpSchedule(c) {
  const rows = scheduleOf({ cpId: c.id, contractId: filters.contractId, method: filters.method });
  const open = rows.filter((s) => s.status !== 'paid');
  return '<div class="filters">' +
      '<label class="field"><span>Договор</span><select data-filter="contractId">' +
        selectOptions(contractOptions(c.id, true), filters.contractId) + '</select></label>' +
      '<label class="field"><span>Способ</span><select data-filter="method">' +
        selectOptions([['', 'Нал и безнал'], ['bank', 'Безнал'], ['cash', 'Нал']], filters.method) + '</select></label>' +
      '<button class="btn" data-act="filters-reset" type="button">Сбросить</button>' +
      '<button class="btn btn--primary" data-act="sched-new" data-cp="' + esc(c.id) + '" type="button">+ Плановый платёж</button>' +
    '</div>' +
    card('График платежей — ' + c.name, schedTable(rows), { flush: true,
      note: 'Кнопка «Оплачено» переносит строку в фактические оплаты: сумма, договор и способ сохраняются, дата ставится сегодняшней.' }) +
    card('К оплате вперёд', scheduleAheadChart('ch-cp-ahead', open), { tools: tableToggle('ch-cp-ahead') });
}

/* Плановые платежи по месяцам вперёд, с разбивкой на нал и безнал */
function scheduleAheadChart(id, rows) {
  const months = monthRange(rows.map((s) => s.dueDate));
  const labels = months.map(fmtMonth);
  const series = Object.keys(PAY_METHODS).map((k) => ({
    label: PAY_METHODS[k].label, color: PAY_METHODS[k].color,
    values: byMonth(rows.filter((s) => s.method === k), 'dueDate', months)
  }));
  return chartSlot(id, (host) => stackedBars(host, { labels: labels, series: series }), seriesTable(labels, series));
}

function cpContracts(c) {
  const rows = c.contracts.map((k) => {
    const b = balanceOf(c.id, k.id);
    return '<tr><td>' + contractTag(c.id, k.id) + '</td>' +
      '<td class="nowrap">' + esc(k.number || '—') + '</td>' +
      '<td class="nowrap">' + fmtDate(k.date) + '</td>' +
      '<td>' + esc(k.payTerms || '') + '</td>' +
      '<td class="num">' + fmtMoney(b.invoiced) + '</td>' +
      '<td class="num">' + fmtMoney(b.paid) + '</td>' +
      '<td class="num">' + fmtMoney(b.debt) + '</td>' +
      '<td>' + esc(k.note || '') + '</td>' +
      '<td><div class="row-actions">' +
        '<button class="btn btn--sm" data-act="contract-edit" data-cp="' + esc(c.id) + '" data-id="' + esc(k.id) + '" type="button">Правка</button>' +
      '</div></td></tr>';
  }).join('');

  return card('Договоры — ' + c.name,
    c.contracts.length ? '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>Название</th><th>Номер</th><th>Дата</th><th>Условия оплаты</th>' +
      '<th class="num">Выставлено</th><th class="num">Оплачено</th><th class="num">Долг</th>' +
      '<th>Комментарий</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : emptyBox('Договоров нет'),
    { flush: c.contracts.length > 0,
      tools: '<button class="btn btn--primary btn--sm" data-act="contract-new" data-cp="' + esc(c.id) + '" type="button">+ Договор</button>',
      note: 'У одного контрагента может быть сколько угодно договоров — оплаты, заказы и документы привязываются к конкретному.' });
}

function cpCard(c) {
  const rows = [
    ['Короткое название', c.name], ['Полное название', c.fullName], ['ИНН', c.inn], ['КПП', c.kpp],
    ['Город', c.city], ['Адрес', c.address], ['Контактное лицо', c.contactPerson],
    ['Телефон', c.phone], ['Почта', c.email], ['Ответственный', c.manager], ['Заметки', c.note]
  ];
  return card('Реквизиты — ' + c.name,
    '<div class="table-wrap"><table class="tbl"><tbody>' + rows.map((r) =>
      '<tr><th style="width:220px">' + esc(r[0]) + '</th><td>' + (r[1] ? esc(r[1]) : '<span class="hint">не заполнено</span>') + '</td></tr>'
    ).join('') + '</tbody></table></div>',
    { flush: true,
      tools: '<button class="btn btn--sm" data-act="cp-edit" data-id="' + esc(c.id) + '" type="button">Правка</button>' +
             '<button class="btn btn--sm btn--danger" data-act="cp-del" data-id="' + esc(c.id) + '" type="button">Удалить контрагента</button>' });
}


/* ------------------------------------------------------------------ */
/* Прайс-лист контрагента                                             */
/* ------------------------------------------------------------------ */
/* Две части, потому что в работе нужны обе: присланный PDF — это то, на
   что ссылаются в переписке, а позиции руками — то, из чего собирается
   заказ. Одно другое не заменяет. */
function cpPrice(c) {
  const items = priceItems(c);
  const files = priceFiles(c);

  const table = items.length
    ? '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th style="width:120px">Артикул</th><th style="min-width:220px">Позиция</th>' +
      '<th style="width:90px">Ед.</th><th style="width:140px" class="num">Цена</th>' +
      '<th>Комментарий</th><th style="width:48px"></th></tr></thead><tbody>' +
      items.map((it) =>
        '<tr>' +
        '<td><input data-price="' + esc(it.id) + '" data-field="article" value="' + esc(it.article || '') + '"></td>' +
        '<td><input data-price="' + esc(it.id) + '" data-field="name" value="' + esc(it.name || '') + '"></td>' +
        '<td><input data-price="' + esc(it.id) + '" data-field="unit" value="' + esc(it.unit || '') + '"></td>' +
        '<td><input class="num" type="number" step="any" inputmode="decimal" data-price="' + esc(it.id) +
          '" data-field="price" value="' + esc(it.price) + '"></td>' +
        '<td><input data-price="' + esc(it.id) + '" data-field="note" value="' + esc(it.note || '') + '"></td>' +
        '<td><button class="btn btn--sm btn--danger" data-act="price-del" data-cp="' + esc(c.id) +
          '" data-id="' + esc(it.id) + '" type="button" title="Убрать позицию">✕</button></td>' +
        '</tr>').join('') +
      '</tbody></table></div>'
    : emptyBox('Позиций пока нет — добавьте первую или возьмите их из присланного прайса');

  const filesHTML = files.length
    ? '<div class="files">' + files.map((f) =>
        '<div class="file">' +
          '<span class="file__icon">' + (/^image\//.test(f.type || '') ? 'IMG' : 'PDF') + '</span>' +
          '<span class="file__body">' +
            '<span class="file__name" title="' + esc(f.name) + '">' + esc(f.name) + '</span>' +
            '<span class="file__meta">' + fmtSize(f.size) + ' · загружен ' + fmtDate(f.addedAt) +
              (f.validFrom ? ' · действует с ' + fmtDate(f.validFrom) : '') + '</span>' +
          '</span>' +
          '<label class="field" style="min-width:170px"><span>Действует с</span>' +
            '<input type="date" data-price-file-date="' + esc(f.id) + '" data-cp="' + esc(c.id) +
            '" value="' + esc(f.validFrom || '') + '"></label>' +
          '<span class="file__actions">' +
            '<button class="btn btn--sm" data-act="price-file-open" data-cp="' + esc(c.id) + '" data-id="' + esc(f.id) + '" type="button">Открыть</button>' +
            '<button class="btn btn--sm" data-act="price-file-save" data-cp="' + esc(c.id) + '" data-id="' + esc(f.id) + '" type="button">Скачать</button>' +
            '<button class="btn btn--sm btn--danger" data-act="price-file-del" data-cp="' + esc(c.id) + '" data-id="' + esc(f.id) + '" type="button">Удалить</button>' +
          '</span>' +
        '</div>').join('') + '</div>'
    : '';

  return card('Прайс-лист — ' + c.name, table + '<div style="margin-top:12px" class="row-actions">' +
      '<button class="btn btn--primary" data-act="price-add" data-cp="' + esc(c.id) + '" type="button">+ Позиция</button>' +
    '</div>',
    { note: 'Эти позиции подставляются в заказ: в карточке заказа есть кнопка «Из прайса». ' +
      'Цена и единица подтянутся, останется ввести количество.' }) +
    card('Присланный прайс в PDF',
      '<div class="drop" id="price-drop" data-cp="' + esc(c.id) + '" tabindex="0" role="button">' +
        '<span class="drop__cat">' + catSVG() + '</span>' +
        '<b>Перетащите сюда PDF или нажмите, чтобы выбрать</b>' +
        'Можно хранить несколько версий — у каждой своя дата начала действия. ' +
        'Принимаются PDF и фотографии, до ' + MAX_FILE_MB + '\u00a0МБ каждая.' +
      '</div>' +
      '<input type="file" id="price-file-input" accept="application/pdf,image/*" multiple hidden>' +
      (filesHTML ? '<div style="margin-top:16px">' + filesHTML + '</div>' : ''),
      { note: 'Файл — то, на что ссылаются в переписке. Позиции выше нужны отдельно: из них собирается заказ.' });
}

/* ------------------------------------------------------------------ */
/* Заказы                                                             */
/* ------------------------------------------------------------------ */
function viewOrders() {
  const rows = ordersOf({ cpId: filters.cpId, contractId: filters.contractId, status: filters.status,
                          from: filters.from, to: filters.to });
  const byStatus = Object.keys(ORDER_STATUSES).map((k, i) => {
    const list = db().orders.filter((o) => o.status === k);
    return { label: ORDER_STATUSES[k].label,
      parts: [{ label: ORDER_STATUSES[k].label, color: 'var(--s' + ((i % 4) + 1) + ')',
        value: list.reduce((s, o) => s + orderTotal(o), 0) }] };
  }).filter((r) => r.parts[0].value > 0);

  const draft = db().orders.filter((o) => o.status === 'draft');

  return filtersHTML({ cp: true, contract: true, status: true, period: true,
    extra: '<button class="btn btn--primary" data-act="order-new" type="button">+ Новый заказ</button>' }) +
    '<div class="kpi-grid">' +
      kpi('Заказов по фильтру', String(rows.length), fmtMoney(rows.reduce((s, o) => s + orderTotal(o), 0))) +
      kpi('Черновики', String(draft.length), fmtMoney(draft.reduce((s, o) => s + orderTotal(o), 0)) + ' — ещё собираются') +
      kpi('Оплачено по этим заказам', fmtMoney(rows.reduce((s, o) => s + paidByOrder(o.id), 0)),
          'привязанные оплаты', 'kpi--up') +
    '</div>' +
    card('Заказы', orderTable(rows), { flush: true,
      note: 'Заказ можно завести черновиком и дополнять позициями, пока не дошло до документов. Нажмите «Открыть», чтобы редактировать.' }) +
    (byStatus.length ? card('Суммы заказов по статусам', chartSlot('ch-ord-status', (host) => hBars(host, byStatus))) : '');
}

/* Карточка заказа: здесь его и собирают по частям */
function viewOrderEdit() {
  const o = orderById(route.orderId);
  if (!o) { route.view = 'orders'; return viewOrders(); }
  const total = orderTotal(o);
  const paid = paidByOrder(o.id);
  const docs = docsOf({ orderId: o.id });
  const pays = paymentsOf({ orderId: o.id });
  const sched = db().schedule.filter((s) => s.orderId === o.id);

  const header = card('Заказ ' + (o.number || o.id.slice(-4)),
    '<div class="form-grid">' +
      '<label class="field"><span>Контрагент</span><select data-order-field="cpId">' +
        selectOptions(cpOptions(false), o.cpId) + '</select></label>' +
      '<label class="field"><span>Договор</span><select data-order-field="contractId">' +
        selectOptions(contractOptions(o.cpId, false), o.contractId) + '</select></label>' +
      '<label class="field"><span>Номер заказа</span><input data-order-field="number" value="' + esc(o.number || '') + '"></label>' +
      '<label class="field"><span>Дата заказа</span><input type="date" data-order-field="date" value="' + esc(o.date || '') + '"></label>' +
      '<label class="field"><span>Статус</span><select data-order-field="status">' +
        selectOptions(Object.keys(ORDER_STATUSES).map((k) => [k, ORDER_STATUSES[k].label]), o.status) + '</select></label>' +
      '<label class="field"><span>Плановая отгрузка</span><input type="date" data-order-field="shipDate" value="' + esc(o.shipDate || '') + '"></label>' +
      '<label class="field field--wide"><span>Комментарий</span><textarea data-order-field="note">' + esc(o.note || '') + '</textarea></label>' +
    '</div>',
    { tools:
        '<button class="btn btn--sm" data-act="order-back" type="button">← К списку</button>' +
        '<button class="btn btn--sm btn--danger" data-act="order-del" data-id="' + esc(o.id) + '" type="button">Удалить заказ</button>',
      note: 'Любое поле сохраняется сразу, как только вы его покинули — черновик не потеряется.' });

  const items = '<div class="table-wrap"><table class="tbl"><thead><tr>' +
    '<th style="min-width:220px">Позиция</th><th style="width:90px">Ед.</th><th style="width:110px" class="num">Кол-во</th>' +
    '<th style="width:130px" class="num">Цена</th><th class="num">Сумма</th><th style="width:48px"></th>' +
    '</tr></thead><tbody>' +
    (o.items.length ? o.items.map((it) =>
      '<tr><td><input data-item="' + esc(it.id) + '" data-field="name" value="' + esc(it.name || '') + '"></td>' +
      '<td><input data-item="' + esc(it.id) + '" data-field="unit" value="' + esc(it.unit || '') + '"></td>' +
      '<td><input class="num" type="number" step="any" inputmode="decimal" data-item="' + esc(it.id) + '" data-field="qty" value="' + esc(it.qty) + '"></td>' +
      '<td><input class="num" type="number" step="any" inputmode="decimal" data-item="' + esc(it.id) + '" data-field="price" value="' + esc(it.price) + '"></td>' +
      '<td class="num" data-sum-for="' + esc(it.id) + '">' + fmtMoney((Number(it.qty) || 0) * (Number(it.price) || 0)) + '</td>' +
      '<td><button class="btn btn--sm btn--danger" data-act="item-del" data-id="' + esc(it.id) + '" type="button" title="Убрать позицию">✕</button></td></tr>'
    ).join('') : '<tr><td colspan="6" class="empty">Позиций пока нет — добавьте первую</td></tr>') +
    '</tbody><tfoot><tr><td colspan="4">Итого по заказу</td><td class="num" id="order-total">' + fmtMoney(total) + '</td><td></td></tr></tfoot></table></div>';

  const actions =
    '<div class="row-actions">' +
      '<button class="btn btn--primary" data-act="item-add" type="button">+ Позиция</button>' +
      '<button class="btn" data-act="order-price-pick" type="button">Из прайса</button>' +
      '<button class="btn" data-act="order-make-doc" data-type="invoice" type="button">Выписать счёт</button>' +
      '<button class="btn" data-act="order-make-doc" data-type="spec" type="button">Сформировать спецификацию</button>' +
      '<button class="btn" data-act="order-make-sched" type="button">Внести в график оплат</button>' +
      '<button class="btn" data-act="order-make-pay" type="button">Отметить оплату</button>' +
    '</div>';

  return header +
    '<div class="kpi-grid" id="order-kpis">' + orderKpisHTML(o) + '</div>' +
    card('Позиции заказа', items + '<div style="margin-top:12px">' + actions + '</div>',
      { note: 'Счёт и спецификация создаются на текущую сумму заказа и сразу попадают в историю документов контрагента.' }) +
    '<div class="grid2">' +
      card('Документы по заказу', docs.length ? docTable(docs, { hideCp: true }) : emptyBox('Документов по заказу нет'),
        { flush: docs.length > 0 }) +
      card('Оплаты по заказу',
        (pays.length ? payTable(pays, { hideCp: true }) : emptyBox('Оплат по заказу нет')) +
        (sched.length ? '<div style="padding:12px"><h3 style="margin-bottom:8px">В графике</h3></div>' + schedTable(sched, { compact: true }) : ''),
        { flush: true }) +
    '</div>';
}

/* Плитки заказа считаются от текущих позиций, поэтому вынесены отдельно:
   их же разметка подставляется при живой правке строк. */
function orderKpisHTML(o) {
  const ch = orderChain(o);
  const pct = ch.total ? Math.min(100, ch.paid / ch.total * 100) : 0;
  const invCount = invoicesOfOrder(o.id).length;
  return kpi('Сумма заказа', fmtMoney(ch.total),
        o.items.length + ' ' + plural(o.items.length, 'позиция', 'позиции', 'позиций')) +
    kpi('Выставлено счетами', fmtMoney(ch.invoiced),
        invCount ? invCount + ' ' + plural(invCount, 'счёт', 'счёта', 'счетов') : 'счёт ещё не выписан',
        !invCount && ch.total ? 'kpi--warn' : '') +
    kpi('Оплачено', fmtMoney(ch.paid),
        (ch.total ? fmtPct(pct) + ' от заказа' : '') +
        (ch.payCount > 1 ? ' · ' + ch.payCount + ' ' + plural(ch.payCount, 'платёж', 'платежа', 'платежей') : ''),
        'kpi--up') +
    kpi('Остаток', fmtMoney(Math.max(0, ch.left)), ch.left > 0.5 ? 'ждём оплату' : 'закрыт',
        ch.left > 0.5 ? 'kpi--warn' : '') +
    kpi('Статус', ORDER_STATUSES[o.status] ? esc(ORDER_STATUSES[o.status].label) : '—',
        o.shipDate ? 'отгрузка ' + fmtDate(o.shipDate) : 'дата отгрузки не задана');
}

/* Правка позиции обновляет только то, что от неё зависит: суммы строк,
   итог и плитки. Пересобирать таблицу на каждом нажатии клавиши нельзя —
   поле вместе с курсором исчезло бы из-под рук, а щелчок по кнопке,
   сделанный сразу после ввода, не дошёл бы до неё. */
function updateOrderLive() {
  const o = orderById(route.orderId);
  if (!o) return;
  o.items.forEach((it) => {
    const cell = document.querySelector('[data-sum-for="' + it.id + '"]');
    if (cell) cell.textContent = fmtMoney((Number(it.qty) || 0) * (Number(it.price) || 0));
  });
  const totalCell = document.getElementById('order-total');
  if (totalCell) totalCell.textContent = fmtMoney(orderTotal(o));
  const kpis = document.getElementById('order-kpis');
  if (kpis) kpis.innerHTML = orderKpisHTML(o);
}

/* ------------------------------------------------------------------ */
/* Оплаты (общий раздел)                                              */
/* ------------------------------------------------------------------ */
function viewPayments() {
  const rows = paymentsOf({ cpId: filters.cpId, contractId: filters.contractId, method: filters.method,
                            from: filters.from, to: filters.to });
  const sched = scheduleOf({ cpId: filters.cpId, contractId: filters.contractId, method: filters.method });
  const open = sched.filter((s) => s.status !== 'paid');
  const overdue = open.filter((s) => schedStatus(s).key === 'overdue');
  const cash = sum(rows.filter((p) => p.method === 'cash'));
  const bank = sum(rows.filter((p) => p.method === 'bank'));
  const total = cash + bank;

  const months = monthRange(db().payments.map((p) => p.date).concat(db().schedule.map((s) => s.dueDate)));
  const labels = months.map(fmtMonth);

  /* Разрез по договорам: у каждого договора свой цвет, закреплённый за ним */
  const contracts = allContracts().filter((x) => !filters.cpId || x.cp.id === filters.cpId);
  /* Цвет по типу договора годится, только когда выбран один контрагент:
     иначе два разных «Основных» встали бы в стопку одним цветом и их
     было бы не различить. Без фильтра раздаём цвета по порядку. */
  const byContract = contracts.map((x, i) => ({
    label: (filters.cpId ? '' : x.cp.name + ' · ') + x.contract.name,
    color: filters.cpId
      ? (CONTRACT_KINDS[x.contract.kind] || CONTRACT_KINDS.other).color
      : 'var(--s' + ((i % 4) + 1) + ')',
    values: byMonth(db().payments.filter((p) => p.contractId === x.contract.id), 'date', months)
  })).filter((s) => s.values.some((v) => v));
  const noContract = byMonth(db().payments.filter((p) => !p.contractId &&
    (!filters.cpId || p.cpId === filters.cpId)), 'date', months);
  if (noContract.some((v) => v)) byContract.push({ label: 'Без договора', color: 'var(--s4)', values: noContract });

  /* План против факта: одна шкала, обе серии в рублях */
  const planVsFact = [
    { label: 'Факт — оплачено', color: 'var(--c1)',
      values: byMonth(db().payments.filter((p) => !filters.cpId || p.cpId === filters.cpId), 'date', months) },
    { label: 'План по графику', color: 'var(--c2)', dashed: true,
      values: byMonth(db().schedule.filter((s) => !filters.cpId || s.cpId === filters.cpId), 'dueDate', months) }
  ];

  const methodSeries = Object.keys(PAY_METHODS).map((k) => ({
    label: PAY_METHODS[k].label, color: PAY_METHODS[k].color,
    values: byMonth(db().payments.filter((p) => p.method === k && (!filters.cpId || p.cpId === filters.cpId)), 'date', months)
  }));

  return filtersHTML({ cp: true, contract: true, method: true, period: true,
    extra: '<button class="btn btn--primary" data-act="pay-new" type="button">+ Оплата</button>' +
           '<button class="btn" data-act="sched-new" type="button">+ В график</button>' }) +
    '<div class="kpi-grid">' +
      kpi('Поступило по фильтру', fmtMoney(total), rows.length + ' ' + plural(rows.length, 'оплата', 'оплаты', 'оплат')) +
      kpi('Безнал', fmtMoney(bank), total ? fmtPct(bank / total * 100) + ' от суммы' : '') +
      kpi('Нал', fmtMoney(cash), total ? fmtPct(cash / total * 100) + ' от суммы' : '') +
      kpi('Ждём по графику', fmtMoney(sum(open, 'amount')),
          open.length + ' ' + plural(open.length, 'строка', 'строки', 'строк')) +
      kpi('Просрочено', fmtMoney(sum(overdue, 'amount')),
          overdue.length ? overdue.length + ' ' + plural(overdue.length, 'строка', 'строки', 'строк') : 'нет',
          overdue.length ? 'kpi--down' : '') +
    '</div>' +
    card('График платежей',
      schedTable(sched),
      { flush: true, note: 'Строка графика живёт отдельно от факта: пока не нажали «Оплачено», это план. ' +
        'Срок подсвечивается сам — просрочка красным, ближайшая неделя жёлтым.' }) +
    card('План и факт по месяцам',
      chartSlot('ch-pay-pf', (host) => lineChart(host, { labels: labels, series: planVsFact }),
        seriesTable(labels, planVsFact)),
      { tools: tableToggle('ch-pay-pf'),
        note: 'Сплошная линия — фактические оплаты, пунктир — график. Обе в рублях на одной шкале.' }) +
    '<div class="grid2">' +
      card('Оплаты по договорам',
        chartSlot('ch-pay-contract', (host) => stackedBars(host, { labels: labels, series: byContract }),
          seriesTable(labels, byContract)), { tools: tableToggle('ch-pay-contract') }) +
      card('Нал и безнал по месяцам',
        chartSlot('ch-pay-method', (host) => stackedBars(host, { labels: labels, series: methodSeries }),
          seriesTable(labels, methodSeries)), { tools: tableToggle('ch-pay-method') }) +
    '</div>' +
    card('Фактические оплаты', payTable(rows), { flush: true });
}

/* Отбор по состоянию скана: «без скана», «есть, но не подписан обеими»
   и «подписан обеими». Третий вариант — то, что обычно и ищут. */
function filterByScan(rows) {
  if (!filters.scan) return rows;
  return rows.filter((d) => {
    const st = docSignState(d);
    if (filters.scan === 'none') return st.key === 'empty';
    if (filters.scan === 'both') return st.key === 'both';
    return st.key === 'none' || st.key === 'one';
  });
}

const SCAN_OPTIONS = [['', 'Любой скан'], ['both', 'Подписан обеими'],
                      ['unsigned', 'Есть, но не подписан'], ['none', 'Без скана']];

function docScanKPIs(rows) {
  const withScan = rows.filter((d) => docSignState(d).count);
  const both = rows.filter((d) => docSignState(d).key === 'both');
  return kpi('Документов', String(rows.length), 'по текущему фильтру') +
    kpi('Со сканом', String(withScan.length),
        rows.length ? fmtPct(withScan.length / rows.length * 100) + ' от всех' : '') +
    kpi('Подписано обеими', String(both.length),
        rows.length ? fmtPct(both.length / rows.length * 100) + ' от всех' : '', both.length ? 'kpi--up' : '') +
    kpi('Без скана', String(rows.length - withScan.length), 'нечего приложить к оплате',
        rows.length - withScan.length ? 'kpi--warn' : '');
}

/* ------------------------------------------------------------------ */
/* Документы (общий раздел)                                           */
/* ------------------------------------------------------------------ */
function viewDocs() {
  const types = [['', 'Все типы']].concat(Object.keys(DOC_TYPES).map((k) => [k, DOC_TYPES[k]]));
  const rows = filterByScan(docsOf({ cpId: filters.cpId, contractId: filters.contractId, type: filters.status,
                        from: filters.from, to: filters.to }));
  return '<div class="filters">' +
      '<label class="field"><span>Контрагент</span><select data-filter="cpId">' + selectOptions(cpOptions(true), filters.cpId) + '</select></label>' +
      '<label class="field"><span>Договор</span><select data-filter="contractId">' + selectOptions(contractOptions(filters.cpId, true), filters.contractId) + '</select></label>' +
      '<label class="field"><span>Тип</span><select data-filter="status">' + selectOptions(types, filters.status) + '</select></label>' +
      '<label class="field"><span>Скан</span><select data-filter="scan">' + selectOptions(SCAN_OPTIONS, filters.scan) + '</select></label>' +
      '<label class="field"><span>С даты</span><input type="date" data-filter="from" value="' + esc(filters.from) + '"></label>' +
      '<label class="field"><span>По дату</span><input type="date" data-filter="to" value="' + esc(filters.to) + '"></label>' +
      '<button class="btn" data-act="filters-reset" type="button">Сбросить</button>' +
      '<button class="btn btn--primary" data-act="doc-new" type="button">+ Документ</button>' +
    '</div>' +
    '<div class="kpi-grid">' + docScanKPIs(rows) + '</div>' +
    card('Все документы', docTable(rows), { flush: true,
      note: 'Кнопка «Файлы» в строке открывает вложения: туда складывают неподписанный экземпляр и подписанный с обеих сторон.' });
}

/* ------------------------------------------------------------------ */
/* Аналитика                                                          */
/* ------------------------------------------------------------------ */
function viewAnalytics() {
  const d = db();
  const orders = ordersOf({ cpId: filters.cpId, contractId: filters.contractId, from: filters.from, to: filters.to });
  const pays = paymentsOf({ cpId: filters.cpId, contractId: filters.contractId, from: filters.from, to: filters.to });
  const ordersTotal = orders.reduce((s, o) => s + orderTotal(o), 0);
  const paysTotal = sum(pays);
  const avg = orders.length ? ordersTotal / orders.length : 0;
  const cash = sum(pays.filter((p) => p.method === 'cash'));

  const months = monthRange(d.payments.map((p) => p.date).concat(d.orders.map((o) => o.date)));
  const labels = months.map(fmtMonth);

  /* Оплаты по контрагентам: цвет закреплён за контрагентом по его месту
     в справочнике, а не по текущей сортировке */
  const cpSeries = d.counterparties.map((c, i) => ({
    label: c.name, color: 'var(--s' + ((i % 4) + 1) + ')',
    values: byMonth(d.payments.filter((p) => p.cpId === c.id), 'date', months)
  })).filter((s) => s.values.some((v) => v));

  const orderSeries = [{
    label: 'Сумма заказов', color: 'var(--c2)',
    values: byMonth(d.orders, 'date', months, orderTotal)
  }];

  /* Топ позиций по сумме — по всем заказам выборки */
  const itemAgg = {};
  orders.forEach((o) => o.items.forEach((it) => {
    const key = (it.name || '—').trim();
    if (!itemAgg[key]) itemAgg[key] = { amount: 0, qty: 0, unit: it.unit || '' };
    itemAgg[key].amount += (Number(it.qty) || 0) * (Number(it.price) || 0);
    itemAgg[key].qty += Number(it.qty) || 0;
  }));
  const topItems = Object.keys(itemAgg).map((k) => ({ name: k, data: itemAgg[k] }))
    .sort((a, b) => b.data.amount - a.data.amount).slice(0, 10);
  const itemRows = topItems.map((x) => ({
    label: x.name, parts: [{ label: 'Сумма', color: 'var(--c1)', value: x.data.amount }]
  }));

  /* Итоги по контрагентам — та же выборка числами */
  const cpTotals = d.counterparties.map((c) => {
    const b = balanceOf(c.id);
    const own = d.payments.filter((p) => p.cpId === c.id);
    const ords = d.orders.filter((o) => o.cpId === c.id);
    return { c: c, b: b,
      bank: sum(own.filter((p) => p.method === 'bank')),
      cash: sum(own.filter((p) => p.method === 'cash')),
      orders: ords.length, ordersSum: ords.reduce((s, o) => s + orderTotal(o), 0) };
  }).sort((a, b) => b.b.paid - a.b.paid);

  const totalsTable = '<div class="table-wrap"><table class="tbl"><thead><tr>' +
    '<th>Контрагент</th><th class="num">Договоров</th><th class="num">Заказов</th><th class="num">Сумма заказов</th>' +
    '<th class="num">Выставлено</th><th class="num">Безнал</th><th class="num">Нал</th>' +
    '<th class="num">Оплачено</th><th class="num">Долг</th></tr></thead><tbody>' +
    cpTotals.map((r) => '<tr>' +
      '<td class="nowrap"><button class="btn btn--sm btn--ghost" data-nav="cp" data-cp="' + esc(r.c.id) + '" type="button">' + esc(r.c.name) + '</button></td>' +
      '<td class="num">' + r.c.contracts.length + '</td>' +
      '<td class="num">' + r.orders + '</td>' +
      '<td class="num">' + fmtMoney(r.ordersSum) + '</td>' +
      '<td class="num">' + fmtMoney(r.b.invoiced) + '</td>' +
      '<td class="num">' + fmtMoney(r.bank) + '</td>' +
      '<td class="num">' + fmtMoney(r.cash) + '</td>' +
      '<td class="num">' + fmtMoney(r.b.paid) + '</td>' +
      '<td class="num">' + fmtMoney(r.b.debt) + '</td></tr>').join('') +
    '</tbody><tfoot><tr><td>Итого</td>' +
      '<td class="num">' + cpTotals.reduce((s, r) => s + r.c.contracts.length, 0) + '</td>' +
      '<td class="num">' + cpTotals.reduce((s, r) => s + r.orders, 0) + '</td>' +
      '<td class="num">' + fmtMoney(cpTotals.reduce((s, r) => s + r.ordersSum, 0)) + '</td>' +
      '<td class="num">' + fmtMoney(cpTotals.reduce((s, r) => s + r.b.invoiced, 0)) + '</td>' +
      '<td class="num">' + fmtMoney(cpTotals.reduce((s, r) => s + r.bank, 0)) + '</td>' +
      '<td class="num">' + fmtMoney(cpTotals.reduce((s, r) => s + r.cash, 0)) + '</td>' +
      '<td class="num">' + fmtMoney(cpTotals.reduce((s, r) => s + r.b.paid, 0)) + '</td>' +
      '<td class="num">' + fmtMoney(cpTotals.reduce((s, r) => s + r.b.debt, 0)) + '</td>' +
    '</tr></tfoot></table></div>';

  /* Цепочка по заказам. Каждый заказ — ровно одна строка, сколько бы
     счетов и оплат к нему ни относилось: сумма заказа берётся из его
     позиций, выставленное — только из счетов, оплаченное — из платежей
     по этому заказу. Поэтому частичные оплаты и несколько документов не
     раздувают итог. */
  const chainRows = orders.map((o) => ({ o: o, ch: orderChain(o) }));
  const chainTable = chainRows.length
    ? '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>Заказ</th><th>Контрагент</th><th>Договор</th><th>Статус</th>' +
      '<th class="num">Сумма заказа</th><th class="num">Выставлено</th>' +
      '<th class="num">Оплачено</th><th class="num">Остаток</th><th>Документы</th></tr></thead><tbody>' +
      chainRows.map((r) => {
        const have = {};
        r.ch.docs.forEach((x) => { have[x.type] = true; });
        /* Чего ещё нет — бледным пунктиром: видно одним взглядом, какой
           документ по заказу не выпущен */
        const chips = ['invoice', 'spec', 'upd'].map((t) =>
          '<span class="tag ' + (have[t] ? 'tag--ok' : 'tag--off') + '" title="' +
          (have[t] ? 'есть' : 'не выпущен') + '">' +
          esc(DOC_TYPES[t].replace(' / накладная', '')) + '</span>').join(' ');
        return '<tr>' +
          '<td class="nowrap"><button class="btn btn--sm btn--ghost" data-act="order-open" data-id="' + esc(r.o.id) +
            '" type="button">' + esc(r.o.number || r.o.id.slice(-4)) + '</button></td>' +
          '<td class="nowrap">' + esc(cpName(r.o.cpId)) + '</td>' +
          '<td>' + contractTag(r.o.cpId, r.o.contractId) + '</td>' +
          '<td>' + orderTag(r.o.status) + '</td>' +
          '<td class="num">' + fmtMoney(r.ch.total) + '</td>' +
          '<td class="num">' + (r.ch.invoiced ? fmtMoney(r.ch.invoiced) : '<span class="hint">—</span>') + '</td>' +
          '<td class="num">' + fmtMoney(r.ch.paid) +
            (r.ch.payCount > 1 ? '<div class="hint" style="font-family:var(--sans)">' + r.ch.payCount + ' ' +
              plural(r.ch.payCount, 'платёж', 'платежа', 'платежей') + '</div>' : '') + '</td>' +
          '<td class="num">' + (r.ch.left > 0.5 ? fmtMoney(r.ch.left) : '<span class="hint">закрыт</span>') + '</td>' +
          '<td class="nowrap">' + chips + (r.ch.overpaid ? ' ' + tag('оплачено больше счёта', 'tag--warn') : '') + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody><tfoot><tr><td colspan="4">Итого ' + chainRows.length + ' ' +
        plural(chainRows.length, 'заказ', 'заказа', 'заказов') + '</td>' +
        '<td class="num">' + fmtMoney(chainRows.reduce((a, r) => a + r.ch.total, 0)) + '</td>' +
        '<td class="num">' + fmtMoney(chainRows.reduce((a, r) => a + r.ch.invoiced, 0)) + '</td>' +
        '<td class="num">' + fmtMoney(chainRows.reduce((a, r) => a + r.ch.paid, 0)) + '</td>' +
        '<td class="num">' + fmtMoney(chainRows.reduce((a, r) => a + Math.max(0, r.ch.left), 0)) + '</td>' +
        '<td></td></tr></tfoot></table></div>'
    : emptyBox('Заказов по этому фильтру нет');

  return filtersHTML({ cp: true, contract: true, period: true }) +
    '<div class="kpi-grid">' +
      kpi('Сумма заказов', fmtMoney(ordersTotal), orders.length + ' ' + plural(orders.length, 'заказ', 'заказа', 'заказов')) +
      kpi('Поступления', fmtMoney(paysTotal), ordersTotal ? fmtPct(paysTotal / ordersTotal * 100) + ' от суммы заказов' : '', 'kpi--up') +
      kpi('Средний заказ', fmtMoney(avg), 'по выборке') +
      kpi('Доля нала', paysTotal ? fmtPct(cash / paysTotal * 100) : '—', fmtMoney(cash) + ' налом') +
      kpi('Контрагентов', String(d.counterparties.length),
          allContracts().length + ' ' + plural(allContracts().length, 'договор', 'договора', 'договоров')) +
    '</div>' +
    card('Заказ → счета → оплаты', chainTable, { flush: true,
      note: 'Одна строка на заказ, сколько бы к нему ни было счетов, спецификаций и платежей. ' +
        'Сумма заказа считается по его позициям, выставленное — только по счетам, ' +
        'оплаченное — по платежам этого заказа. Частичная оплата не делит заказ и не задваивает суммы.' }) +
    card('Итоги по контрагентам', totalsTable, { flush: true,
      note: 'Нажмите на название, чтобы открыть вкладку контрагента.' }) +
    card('Поступления по месяцам и контрагентам',
      chartSlot('ch-an-cp', (host) => stackedBars(host, { labels: labels, series: cpSeries }),
        seriesTable(labels, cpSeries)), { tools: tableToggle('ch-an-cp') }) +
    '<div class="grid2">' +
      card('Сумма заказов по месяцам',
        chartSlot('ch-an-ord', (host) => stackedBars(host, { labels: labels, series: orderSeries }),
          seriesTable(labels, orderSeries)), { tools: tableToggle('ch-an-ord') }) +
      card('Топ позиций по сумме', chartSlot('ch-an-items', (host) => hBars(host, itemRows)),
        { note: 'Считается по позициям заказов выборки.' }) +
    '</div>';
}

/* ------------------------------------------------------------------ */
/* Контрагенты: список и добавление                                   */
/* ------------------------------------------------------------------ */
function viewCps() {
  const rows = db().counterparties.map((c, i) => {
    const b = balanceOf(c.id);
    const ords = db().orders.filter((o) => o.cpId === c.id);
    return '<tr>' +
      '<td class="nowrap"><i class="tab__dot" style="background:var(--s' + ((i % 4) + 1) + ')"></i><b>' + esc(c.name) + '</b></td>' +
      '<td>' + esc(c.fullName || '') + '</td>' +
      '<td class="nowrap">' + esc(c.inn || '—') + '</td>' +
      '<td>' + (c.contracts.length ? c.contracts.map((k) => contractTag(c.id, k.id)).join(' ') : '<span class="hint">нет</span>') + '</td>' +
      '<td class="nowrap">' + esc(c.contactPerson || '—') + (c.phone ? '<br><span class="hint">' + esc(c.phone) + '</span>' : '') + '</td>' +
      '<td class="num">' + ords.length + '</td>' +
      '<td class="num">' + fmtMoney(b.paid) + '</td>' +
      '<td class="num">' + fmtMoney(b.debt) + '</td>' +
      '<td><div class="row-actions">' +
        '<button class="btn btn--sm btn--primary" data-nav="cp" data-cp="' + esc(c.id) + '" type="button">Открыть</button>' +
        '<button class="btn btn--sm" data-act="cp-edit" data-id="' + esc(c.id) + '" type="button">Правка</button>' +
      '</div></td></tr>';
  }).join('');

  return card('Контрагенты',
    db().counterparties.length ? '<div class="table-wrap"><table class="tbl"><thead><tr>' +
      '<th>Название</th><th>Полное название</th><th>ИНН</th><th>Договоры</th><th>Контакт</th>' +
      '<th class="num">Заказов</th><th class="num">Оплачено</th><th class="num">Долг</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      : emptyBox('Пока никого нет — добавьте первого контрагента'),
    { flush: db().counterparties.length > 0,
      tools: '<button class="btn btn--primary btn--sm" data-act="cp-new" type="button">+ Новый контрагент</button>',
      note: 'У каждого контрагента появляется своя вкладка в верхнем ряду — вся его история в одном месте.' });
}

/* ------------------------------------------------------------------ */
/* Данные: выгрузка, загрузка, сброс                                  */
/* ------------------------------------------------------------------ */
function viewData() {
  const d = db();
  const fileCount = allFileIds().length;
  const counts = [
    ['Контрагенты', d.counterparties.length],
    ['Договоры', allContracts().length],
    ['Заказы', d.orders.length],
    ['Документы', d.documents.length],
    ['Оплаты', d.payments.length],
    ['Строки графика', d.schedule.length],
    ['Вложенные файлы', fileCount]
  ];
  return card('Что сейчас в базе',
    '<div class="kpi-grid" style="margin:0">' + counts.map((c) => kpi(c[0], String(c[1]), '')).join('') + '</div>') +
    card('Перенос и резервная копия',
      '<p class="hint" style="margin-top:0">Данные лежат в этом браузере на этом устройстве. Чтобы перенести их на другой ' +
      'компьютер или телефон — выгрузите файл и загрузите его там. Файл обычный JSON, его можно хранить в облаке как резервную копию.</p>' +
      '<div class="row-actions" style="margin-top:12px">' +
        '<button class="btn btn--primary" data-act="export" type="button">Выгрузить данные</button>' +
        '<button class="btn" data-act="export-files" type="button">Выгрузить вместе со сканами</button>' +
        '<button class="btn" data-act="import-replace" type="button">Загрузить из файла (заменить)</button>' +
        '<button class="btn" data-act="import-merge" type="button">Загрузить и добавить к текущим</button>' +
        '<button class="btn" data-act="print" type="button">Печать текущего экрана</button>' +
      '</div>' +
      '<p class="hint" style="margin-bottom:0">Обычная выгрузка — только записи, она небольшая. ' +
      'Выгрузка со сканами вкладывает и сами PDF, файл получается во столько же раз тяжелее — ' +
      'это полная копия, которой поднимается работа на другом устройстве. ' +
      'Сейчас в хранилище <b id="files-size">считаем…</b>.</p>' +
      '<input type="file" id="import-file" accept=".json,application/json" hidden>') +
    card('Очистка',
      '<p class="hint" style="margin-top:0">Перед очисткой выгрузите файл — восстановить удалённое иначе не получится.</p>' +
      '<div class="row-actions" style="margin-top:12px">' +
        '<button class="btn" data-act="files-cleanup" type="button">Убрать забытые файлы</button>' +
        '<button class="btn btn--danger" data-act="reset-empty" type="button">Очистить всё и начать с нуля</button>' +
        '<button class="btn btn--danger" data-act="reset-sample" type="button">Вернуть демонстрационный пример</button>' +
      '</div>' +
      '<p class="hint" style="margin-bottom:0">Забытые файлы — это вложения документов, которые удалили в обход ' +
      'платформы, например загрузкой чужой копии данных. Записи они не трогают, только освобождают место.</p>');
}

/* ------------------------------------------------------------------ */
/* Формы создания и правки                                            */
/* ------------------------------------------------------------------ */
function formCounterparty(cpId) {
  const c = cpId ? cpById(cpId) : null;
  openForm({
    title: c ? 'Контрагент: ' + c.name : 'Новый контрагент',
    fields: [
      { name: 'name', label: 'Короткое название', value: c && c.name, required: true, hint: 'Так он будет назван на вкладке' },
      { name: 'fullName', label: 'Полное название', value: c && c.fullName },
      { name: 'inn', label: 'ИНН', value: c && c.inn },
      { name: 'kpp', label: 'КПП', value: c && c.kpp },
      { name: 'city', label: 'Город', value: c && c.city },
      { name: 'address', label: 'Адрес', value: c && c.address, wide: true },
      { name: 'contactPerson', label: 'Контактное лицо', value: c && c.contactPerson },
      { name: 'phone', label: 'Телефон', value: c && c.phone },
      { name: 'email', label: 'Почта', value: c && c.email },
      { name: 'manager', label: 'Ответственный', value: c && c.manager },
      { name: 'note', label: 'Заметки', type: 'textarea', value: c && c.note, wide: true }
    ],
    onSave: (v) => {
      if (c) { upsert('counterparties', Object.assign({}, v, { id: c.id })); }
      else {
        const item = Object.assign({}, v, { contracts: [] });
        upsert('counterparties', item, 'cp');
        /* Новому контрагенту сразу открываем его вкладку: следующий шаг —
           завести договор */
        route = { view: 'cp', cpId: item.id, sub: 'contracts', orderId: '' };
      }
    },
    onDelete: c ? () => { removeCounterparty(c.id); route = { view: 'cps', cpId: '', sub: '', orderId: '' }; } : null
  });
}

function formContract(cpId, contractId) {
  const c = cpById(cpId);
  if (!c) return;
  const k = contractId ? contractById(cpId, contractId) : null;
  openForm({
    title: (k ? 'Договор: ' + k.name : 'Новый договор') + ' — ' + c.name,
    fields: [
      { name: 'name', label: 'Название', value: k ? k.name : 'Основной', required: true,
        hint: 'Например: Основной, Бартерный' },
      { name: 'kind', label: 'Тип', type: 'select', value: k ? k.kind : 'main',
        options: Object.keys(CONTRACT_KINDS).map((x) => [x, CONTRACT_KINDS[x].label]) },
      { name: 'number', label: 'Номер', value: k && k.number },
      { name: 'date', label: 'Дата', type: 'date', value: k ? k.date : today() },
      { name: 'payTerms', label: 'Условия оплаты', value: k && k.payTerms, wide: true },
      { name: 'note', label: 'Комментарий', type: 'textarea', value: k && k.note, wide: true }
    ],
    onSave: (v) => {
      if (k) Object.assign(k, v);
      else c.contracts.push(Object.assign({ id: uid('k') }, v));
      save();
    },
    onDelete: k ? () => removeContract(cpId, contractId) : null
  });
}

function formPayment(payId, preset) {
  const p = payId ? db().payments.find((x) => x.id === payId) : null;
  const cpId = p ? p.cpId : (preset && preset.cpId) || filters.cpId || (db().counterparties[0] || {}).id || '';
  openForm({
    title: p ? 'Оплата от ' + fmtDate(p.date) : 'Новая оплата',
    fields: [
      { name: 'date', label: 'Дата оплаты', type: 'date', value: p ? p.date : today(), required: true },
      { name: 'amount', label: 'Сумма, ₽', type: 'number', value: p ? p.amount : (preset && preset.amount) || '', required: true },
      { name: 'cpId', label: 'Контрагент', type: 'select', value: cpId, options: cpOptions(false), required: true },
      { name: 'contractId', label: 'Договор', type: 'select',
        value: p ? p.contractId : (preset && preset.contractId) || '', options: contractOptions(cpId, false) },
      { name: 'orderId', label: 'Заказ', type: 'select',
        value: p ? p.orderId : (preset && preset.orderId) || '', options: orderOptions(cpId) },
      { name: 'docId', label: 'Счёт', type: 'select',
        value: p ? p.docId : (preset && preset.docId) || '',
        options: invoiceOptions(cpId, (p ? p.orderId : (preset && preset.orderId)) || ''),
        hint: 'Один счёт можно закрыть несколькими оплатами' },
      { name: 'method', label: 'Способ', type: 'select', value: p ? p.method : (preset && preset.method) || 'bank',
        options: Object.keys(PAY_METHODS).map((k) => [k, PAY_METHODS[k].label]) },
      { name: 'note', label: 'Комментарий', type: 'textarea', value: p && p.note, wide: true }
    ],
    validate: (v) => (Number(v.amount) > 0 ? null : 'Сумма оплаты должна быть больше нуля'),
    onSave: (v) => { upsert('payments', p ? Object.assign({}, v, { id: p.id }) : v, 'pay'); },
    onDelete: p ? () => remove('payments', p.id) : null
  });
}

function formSchedule(schedId, preset) {
  const s = schedId ? db().schedule.find((x) => x.id === schedId) : null;
  const cpId = s ? s.cpId : (preset && preset.cpId) || filters.cpId || (db().counterparties[0] || {}).id || '';
  openForm({
    title: s ? 'Плановый платёж на ' + fmtDate(s.dueDate) : 'Новый плановый платёж',
    fields: [
      { name: 'dueDate', label: 'Срок оплаты', type: 'date', value: s ? s.dueDate : (preset && preset.dueDate) || today(), required: true },
      { name: 'amount', label: 'Сумма, ₽', type: 'number', value: s ? s.amount : (preset && preset.amount) || '', required: true },
      { name: 'cpId', label: 'Контрагент', type: 'select', value: cpId, options: cpOptions(false), required: true },
      { name: 'contractId', label: 'Договор', type: 'select',
        value: s ? s.contractId : (preset && preset.contractId) || '', options: contractOptions(cpId, false) },
      { name: 'orderId', label: 'Заказ', type: 'select',
        value: s ? s.orderId : (preset && preset.orderId) || '', options: orderOptions(cpId) },
      { name: 'method', label: 'Способ', type: 'select', value: s ? s.method : (preset && preset.method) || 'bank',
        options: Object.keys(PAY_METHODS).map((k) => [k, PAY_METHODS[k].label]) },
      { name: 'status', label: 'Состояние', type: 'select', value: s ? s.status : 'plan',
        options: [['plan', 'План'], ['paid', 'Закрыто']] },
      { name: 'note', label: 'Комментарий', type: 'textarea', value: s && s.note, wide: true }
    ],
    validate: (v) => (Number(v.amount) > 0 ? null : 'Сумма должна быть больше нуля'),
    onSave: (v) => { upsert('schedule', s ? Object.assign({}, v, { id: s.id }) : v, 'sch'); },
    onDelete: s ? () => remove('schedule', s.id) : null
  });
}

function formDocument(docId, preset) {
  const x = docId ? db().documents.find((y) => y.id === docId) : null;
  const cpId = x ? x.cpId : (preset && preset.cpId) || filters.cpId || (db().counterparties[0] || {}).id || '';
  openForm({
    title: x ? (DOC_TYPES[x.type] || 'Документ') + ' №' + (x.number || '') : 'Новый документ',
    fields: [
      { name: 'type', label: 'Тип', type: 'select', value: x ? x.type : (preset && preset.type) || 'invoice',
        options: Object.keys(DOC_TYPES).map((k) => [k, DOC_TYPES[k]]), required: true },
      { name: 'number', label: 'Номер', value: x ? x.number : (preset && preset.number) || '' },
      { name: 'date', label: 'Дата', type: 'date', value: x ? x.date : today(), required: true },
      { name: 'amount', label: 'Сумма, ₽', type: 'number', value: x ? x.amount : (preset && preset.amount) || '' },
      { name: 'cpId', label: 'Контрагент', type: 'select', value: cpId, options: cpOptions(false), required: true },
      { name: 'contractId', label: 'Договор', type: 'select',
        value: x ? x.contractId : (preset && preset.contractId) || '', options: contractOptions(cpId, false) },
      { name: 'orderId', label: 'Заказ', type: 'select',
        value: x ? x.orderId : (preset && preset.orderId) || '', options: orderOptions(cpId) },
      { name: 'status', label: 'Статус', type: 'select', value: x ? x.status : 'draft',
        options: Object.keys(DOC_STATUSES).map((k) => [k, DOC_STATUSES[k].label]) },
      { name: 'note', label: 'Комментарий', type: 'textarea', value: x && x.note, wide: true }
    ],
    onSave: (v) => {
      /* Вложения остаются при документе: форма их не трогает */
      upsert('documents', x ? Object.assign({}, v, { id: x.id, files: docFiles(x) }) : Object.assign(v, { files: [] }), 'doc');
    },
    onDelete: x ? () => removeDocument(x.id) : null
  });
}

/* Новый заказ создаётся пустым черновиком и сразу открывается на правку:
   позиции добавляются постепенно, ничего заполнять заранее не нужно. */
function newOrder(cpId) {
  const cps = db().counterparties;
  if (!cps.length) { alert('Сначала добавьте контрагента во вкладке «Контрагенты».'); return; }
  const cp = cpById(cpId) || cpById(filters.cpId) || cps[0];
  const nums = db().orders.map((o) => parseInt(o.number, 10)).filter((n) => !isNaN(n));
  const next = nums.length ? Math.max.apply(null, nums) + 1 : 101;
  const order = {
    cpId: cp.id,
    contractId: (cp.contracts[0] || {}).id || '',
    number: String(next), date: today(), status: 'draft', shipDate: '', note: '', items: []
  };
  upsert('orders', order, 'ord');
  route = { view: 'order', cpId: '', sub: '', orderId: order.id };
  render();
}

/* ------------------------------------------------------------------ */
/* Загрузка прайса и подстановка позиций в заказ                      */
/* ------------------------------------------------------------------ */
function addPriceFiles(cpId, fileList) {
  const c = cpById(cpId);
  const files = Array.prototype.slice.call(fileList || []);
  if (!c || !files.length) return;
  const tooBig = files.filter((f) => f.size > MAX_FILE_MB * 1048576);
  if (tooBig.length) {
    alert('Слишком большие файлы (больше ' + MAX_FILE_MB + ' МБ):\n' +
          tooBig.map((f) => f.name).join('\n'));
  }
  const ok = files.filter((f) => f.size <= MAX_FILE_MB * 1048576);
  Promise.all(ok.map((f) => {
    const id = uid('file');
    return filePut(id, f).then(() => {
      priceFiles(c).push({
        id: id, name: f.name, size: f.size, type: f.type || 'application/pdf',
        addedAt: today(), validFrom: '', note: ''
      });
    });
  })).then(() => { save(); render(); })
    .catch((e) => alert('Не удалось сохранить файл: ' + e.message));
}

function bindPriceDrop() {
  const drop = document.getElementById('price-drop');
  const input = document.getElementById('price-file-input');
  if (!drop || !input) return;
  const cpId = drop.getAttribute('data-cp');

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => { addPriceFiles(cpId, input.files); input.value = ''; });

  /* Гасим поведение браузера: иначе он откроет файл поверх страницы */
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.add('drop--over');
  }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.remove('drop--over');
  }));
  drop.addEventListener('drop', (e) => addPriceFiles(cpId, e.dataTransfer && e.dataTransfer.files));
}

/* Набор заказа из прайса: отмечаем позиции и сразу задаём количество.
   Цена подставляется из прайса, но остаётся редактируемой в заказе —
   договорная скидка не должна править сам прайс. */
function openPricePicker(order) {
  const c = cpById(order.cpId);
  const list = c ? priceItems(c) : [];
  if (!list.length) {
    alert('У контрагента «' + (c ? c.name : '') + '» прайс пока пуст.\n\n' +
          'Заведите позиции во вкладке контрагента → «Прайс-лист».');
    return;
  }

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true" aria-label="Позиции из прайса">' +
      '<header class="modal__head"><h2>Из прайса — ' + esc(c.name) + '</h2>' +
        '<button class="btn btn--sm" data-close type="button">Закрыть</button></header>' +
      '<div class="modal__body">' +
        '<p class="hint" style="margin-top:0">Отметьте позиции и укажите количество. ' +
        'Цена подставится из прайса, в заказе её можно поправить.</p>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr>' +
          '<th style="width:42px"></th><th>Артикул</th><th>Позиция</th><th>Ед.</th>' +
          '<th class="num">Цена</th><th style="width:120px" class="num">Кол-во</th>' +
        '</tr></thead><tbody>' +
        list.map((it) => '<tr>' +
          '<td><input type="checkbox" data-pick="' + esc(it.id) + '" style="width:auto"></td>' +
          '<td class="nowrap">' + esc(it.article || '—') + '</td>' +
          '<td>' + esc(it.name || '') + (it.note ? '<div class="hint">' + esc(it.note) + '</div>' : '') + '</td>' +
          '<td class="nowrap">' + esc(it.unit || '') + '</td>' +
          '<td class="num">' + fmtMoney(it.price) + '</td>' +
          '<td><input class="num" type="number" step="any" min="0" inputmode="decimal" ' +
            'data-qty="' + esc(it.id) + '" value="1"></td>' +
        '</tr>').join('') +
        '</tbody></table></div>' +
      '</div>' +
      '<footer class="modal__foot">' +
        '<button class="btn" data-close type="button">Отмена</button>' +
        '<button class="btn btn--primary" data-add type="button">Добавить в заказ</button>' +
      '</footer>' +
    '</div>';

  const close = () => { document.removeEventListener('keydown', onKey); back.remove(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('[data-close]')) { close(); return; }
    if (!e.target.closest('[data-add]')) return;

    const picked = Array.prototype.slice.call(back.querySelectorAll('[data-pick]:checked'));
    if (!picked.length) { alert('Отметьте хотя бы одну позицию.'); return; }
    picked.forEach((box) => {
      const id = box.getAttribute('data-pick');
      const src = list.find((x) => x.id === id);
      if (!src) return;
      const qtyInput = back.querySelector('[data-qty="' + id + '"]');
      const qty = Number(String(qtyInput ? qtyInput.value : '1').replace(',', '.')) || 1;
      /* Если такая позиция в заказе уже есть по той же цене — добавляем
         количество к ней, а не плодим одинаковые строки */
      const same = order.items.find((x) => x.name === src.name && Number(x.price) === Number(src.price));
      if (same) same.qty = (Number(same.qty) || 0) + qty;
      else order.items.push({ id: uid('it'), name: src.name, unit: src.unit || 'шт',
                              qty: qty, price: Number(src.price) || 0 });
    });
    save();
    close();
    render();
  });

  document.body.appendChild(back);
}

/* ------------------------------------------------------------------ */
/* Отрисовка                                                          */
/* ------------------------------------------------------------------ */
function render() {
  chartJobs = [];
  const nav = document.getElementById('tabs');
  const main = document.getElementById('main');

  let html = '';
  if (route.view === 'dash') html = viewDash();
  else if (route.view === 'cp') html = viewCp();
  else if (route.view === 'cps') html = viewCps();
  else if (route.view === 'orders') html = viewOrders();
  else if (route.view === 'order') html = viewOrderEdit();
  else if (route.view === 'payments') html = viewPayments();
  else if (route.view === 'docs') html = viewDocs();
  else if (route.view === 'analytics') html = viewAnalytics();
  else if (route.view === 'data') html = viewData();
  else html = viewDash();

  nav.innerHTML = navHTML();
  main.innerHTML = html;

  chartJobs.forEach((job) => {
    const host = document.getElementById(job.id);
    if (host) job.draw(host);
  });

  /* Зона загрузки прайса живёт прямо на странице, а не в окне, и
     пересобирается вместе с ней — обработчики вешаются после отрисовки */
  bindPriceDrop();

  /* Вес хранилища файлов читается из IndexedDB, то есть не сразу —
     подставляем, когда ответ придёт, и только если экран ещё тот же */
  const sizeBox = document.getElementById('files-size');
  if (sizeBox) {
    filesTotalSize()
      .then((bytes) => { if (sizeBox.isConnected) sizeBox.textContent = fmtSize(bytes); })
      .catch(() => { if (sizeBox.isConnected) sizeBox.textContent = 'нет доступа'; });
  }
}

/* Перерисовка графиков при смене темы: цвета берутся из CSS-переменных,
   но подложка сегментов и подписи заданы в момент рисования */
function rerenderCharts() { render(); }

/* ------------------------------------------------------------------ */
/* Действия                                                           */
/* ------------------------------------------------------------------ */
function downloadFile(name, text, type) {
  const blob = new Blob([text], { type: type || 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = asciiFileName(name, 'export.json');
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function handleAction(act, node) {
  const id = node.getAttribute('data-id') || '';
  const cp = node.getAttribute('data-cp') || '';

  switch (act) {
    case 'filters-reset':
      filters = { cpId: '', contractId: '', method: '', from: '', to: '', status: '', scan: '' };
      render(); return;

    case 'toggle-table': {
      const t = document.getElementById(node.getAttribute('data-target'));
      if (t) { t.hidden = !t.hidden; node.textContent = t.hidden ? 'Таблицей' : 'Скрыть таблицу'; }
      return;
    }

    case 'go-payments': go('payments'); return;

    /* Контрагенты и договоры */
    case 'cp-new': formCounterparty(''); return;
    case 'cp-edit': formCounterparty(id); return;
    case 'cp-del':
      if (confirm('Удалить контрагента вместе со всеми его заказами, документами и оплатами?\n\nДействие нельзя отменить.')) {
        removeCounterparty(id); go('cps');
      }
      return;
    case 'contract-new': formContract(cp, ''); return;
    case 'contract-edit': formContract(cp, id); return;

    /* Оплаты, график, документы */
    case 'pay-new': formPayment('', { cpId: cp }); return;
    case 'pay-edit': formPayment(id); return;
    case 'sched-new': formSchedule('', { cpId: cp }); return;
    case 'sched-edit': formSchedule(id); return;
    case 'sched-pay': {
      const s = db().schedule.find((x) => x.id === id);
      if (!s) return;
      /* Плановую строку закрываем и сразу заводим факт: сумму и способ
         можно поправить в форме до сохранения */
      formPayment('', { cpId: s.cpId, contractId: s.contractId, orderId: s.orderId,
                        amount: s.amount, method: s.method });
      s.status = 'paid';
      save();
      return;
    }
    case 'doc-new': formDocument('', { cpId: cp }); return;
    case 'doc-edit': formDocument(id); return;
    case 'doc-files': openFilesModal(id); return;

    /* Прайс-лист */
    case 'price-add': {
      const c = cpById(cp);
      if (!c) return;
      priceItems(c).push({ id: uid('pi'), article: '', name: '', unit: 'шт', price: 0, note: '' });
      save(); render();
      const inputs = document.querySelectorAll('[data-price][data-field="name"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
      return;
    }
    case 'price-del': {
      const c = cpById(cp);
      if (!c) return;
      c.priceItems = priceItems(c).filter((x) => x.id !== id);
      save(); render(); return;
    }
    case 'price-file-open':
    case 'price-file-save': {
      const c = cpById(cp);
      const meta = c && priceFiles(c).find((x) => x.id === id);
      fileGet(id).then((blob) => {
        if (!blob) { alert('Файл не найден в хранилище — возможно, он был удалён.'); return; }
        openBlob(blob, meta && meta.name, act === 'price-file-save');
      }).catch((e) => alert('Не удалось прочитать файл: ' + e.message));
      return;
    }
    case 'price-file-del': {
      const c = cpById(cp);
      if (!c) return;
      const f = priceFiles(c).find((x) => x.id === id);
      if (!confirm('Удалить файл «' + (f ? f.name : '') + '»?')) return;
      fileDel(id).catch(() => null).then(() => {
        c.priceFiles = priceFiles(c).filter((x) => x.id !== id);
        save(); render();
      });
      return;
    }
    case 'order-price-pick': {
      const o = orderById(route.orderId);
      if (o) openPricePicker(o);
      return;
    }

    /* Заказы */
    case 'order-new': newOrder(cp); return;
    case 'order-open': route = { view: 'order', cpId: '', sub: '', orderId: id }; render(); return;
    case 'order-back': go('orders'); return;
    case 'order-del':
      if (confirm('Удалить заказ? Документы и оплаты, привязанные к нему, останутся, но потеряют ссылку.')) {
        db().documents.forEach((d) => { if (d.orderId === id) d.orderId = ''; });
        db().payments.forEach((p) => { if (p.orderId === id) p.orderId = ''; });
        db().schedule.forEach((s) => { if (s.orderId === id) s.orderId = ''; });
        remove('orders', id);
        go('orders');
      }
      return;

    case 'item-add': {
      const o = orderById(route.orderId);
      if (!o) return;
      o.items.push({ id: uid('it'), name: '', unit: 'шт', qty: 1, price: 0 });
      save(); render();
      /* Курсор — в название новой позиции, чтобы сразу печатать */
      const inputs = document.querySelectorAll('[data-field="name"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
      return;
    }
    case 'item-del': {
      const o = orderById(route.orderId);
      if (!o) return;
      o.items = o.items.filter((it) => it.id !== id);
      save(); render(); return;
    }

    case 'order-make-doc': {
      const o = orderById(route.orderId);
      if (!o) return;
      const type = node.getAttribute('data-type');
      const total = orderTotal(o);
      if (!total) { alert('Сначала добавьте позиции: сумма заказа пока нулевая.'); return; }
      formDocument('', { cpId: o.cpId, contractId: o.contractId, orderId: o.id, type: type,
                         amount: total, number: (type === 'spec' ? 'С-' : '') + (o.number || '') });
      /* Выписали счёт — заказ перестаёт быть черновиком */
      if (o.status === 'draft' || o.status === 'agreed') { o.status = 'documented'; save(); }
      return;
    }
    case 'order-make-sched': {
      const o = orderById(route.orderId);
      if (!o) return;
      const left = Math.max(0, orderTotal(o) - paidByOrder(o.id));
      formSchedule('', { cpId: o.cpId, contractId: o.contractId, orderId: o.id, amount: left || orderTotal(o) });
      return;
    }
    case 'order-make-pay': {
      const o = orderById(route.orderId);
      if (!o) return;
      /* Подставляем первый незакрытый счёт заказа и остаток по нему:
         чаще всего деньги приходят именно по нему, частями */
      const openInv = invoicesOfOrder(o.id).find((x) => Number(x.amount) - paidByDoc(x.id) > 0.5);
      const left = openInv
        ? Number(openInv.amount) - paidByDoc(openInv.id)
        : Math.max(0, orderTotal(o) - paidByOrder(o.id));
      formPayment('', { cpId: o.cpId, contractId: o.contractId, orderId: o.id,
                        docId: openInv ? openInv.id : '', amount: left || orderTotal(o) });
      return;
    }

    /* Данные */
    case 'export': {
      downloadFile('платформа-продаж-' + today() + '.json', exportJSON());
      return;
    }
    case 'export-files': {
      node.disabled = true;
      const was = node.textContent;
      node.textContent = 'Собираем…';
      exportWithFiles().then((text) => {
        downloadFile('платформа-продаж-со-сканами-' + today() + '.json', text);
      }).catch((e) => alert('Не удалось собрать выгрузку: ' + e.message))
        .then(() => { node.disabled = false; node.textContent = was; });
      return;
    }
    case 'files-cleanup': {
      filesCleanup(allFileIds()).then((n) => {
        alert(n ? 'Убрано файлов: ' + n : 'Забытых файлов нет — всё на месте.');
        render();
      }).catch((e) => alert('Не удалось почистить хранилище: ' + e.message));
      return;
    }
    case 'import-replace':
    case 'import-merge': {
      const input = document.getElementById('import-file');
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const done = importJSON(String(reader.result), act === 'import-merge' ? 'merge' : 'replace');
            Promise.resolve(done).then((n) => {
              alert(n ? 'Данные загружены, восстановлено файлов: ' + n : 'Данные загружены.');
              go('dash');
            });
          } catch (e) {
            alert('Не удалось прочитать файл: ' + e.message);
          }
          input.value = '';
        };
        reader.readAsText(file);
      };
      input.click();
      return;
    }
    case 'print': window.print(); return;
    case 'reset-empty':
      if (confirm('Удалить все данные и вложенные файлы без возможности восстановления?')) {
        resetAll(false);
        filesCleanup([]).catch(() => null).then(() => go('dash'));
      }
      return;
    case 'reset-sample':
      if (confirm('Заменить текущие данные демонстрационным примером? Вложенные файлы будут удалены.')) {
        resetAll(true);
        filesCleanup([]).catch(() => null).then(() => go('dash'));
      }
      return;

    default: return;
  }
}

/* ------------------------------------------------------------------ */
/* Запуск                                                             */
/* ------------------------------------------------------------------ */
/* Знак платформы — пара крыльев. Рисуется прямо в разметке, а не берётся
   картинкой: один контур идёт и в значок вкладки, и в шапку. Форма держится
   на двух серпах с острыми концами, поэтому узнаётся и на 16 пикселях.
   Идентификаторы градиента и фильтра уникальны: иначе два экземпляра на
   одной странице подхватили бы чужую заливку. */
function wingsSVG(key, top, bottom, glow) {
  const g = 'wg-' + key;
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<defs>' +
      '<linearGradient id="' + g + '" x1="32" y1="8" x2="32" y2="58" gradientUnits="userSpaceOnUse">' +
        '<stop offset="0" stop-color="' + top + '"/><stop offset="1" stop-color="' + bottom + '"/>' +
      '</linearGradient>' +
      (glow
        ? '<filter id="f-' + g + '" x="-55%" y="-55%" width="210%" height="210%">' +
            '<feGaussianBlur stdDeviation="3.2" result="b"/>' +
            '<feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>' +
          '</filter>'
        : '') +
    '</defs>' +
    '<g fill="url(#' + g + ')"' + (glow ? ' filter="url(#f-' + g + ')"' : '') + '>' +
      '<path d="M33.2 58 C36 34 44 17 61 12.5 C50 24 40 40 33.2 58 Z"/>' +
      '<path d="M30.8 58 C28 34 20 17 3 12.5 C14 24 24 40 30.8 58 Z"/>' +
    '</g></svg>';
}

/* Знак держит основной цвет — синий: на тёмной теме со свечением, на
   светлой плотная заливка без ореола, на светлом фоне он читается грязью. */
function logoFor(theme) {
  return theme === 'light'
    ? wingsSVG('l', '#34506d', '#0a1b2e', false)
    : wingsSVG('d', '#7fd9ff', '#1b6fe0', true);
}

/* Снежинка на кнопке темы. Рисуется, а не берётся эмодзи: эмодзи у каждой
   системы своё, цветное и к палитре не приводится. Шесть лучей с ветками —
   по кругу поворотом одного и того же луча. */
function snowflakeSVG() {
  let arms = '';
  for (let i = 0; i < 6; i++) {
    arms += '<g transform="rotate(' + (i * 60) + ' 12 12)">' +
      '<path d="M12 12V2.6"/>' +
      '<path d="M12 5.6 9.4 3M12 5.6 14.6 3"/>' +
      '<path d="M12 9.2 10.1 7.3M12 9.2 13.9 7.3"/>' +
    '</g>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round">' + arms + '</svg>';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('sales-platform-theme', theme); } catch (e) { /* не критично */ }
  const btn = document.getElementById('btn-theme');
  if (btn) {
    /* Значок один и тот же, меняется только его вид: на тёмной теме
       снежинка горит акцентом, на светлой лежит приглушённым контуром.
       Что именно произойдёт по нажатию, сказано в подсказке и для
       экранного диктора. */
    btn.innerHTML = snowflakeSVG();
    btn.classList.toggle('btn--icon-lit', theme !== 'light');
    const action = theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему';
    btn.title = action;
    btn.setAttribute('aria-label', action);
  }

  /* Вкладка браузера и шапка берут один и тот же контур. */
  const svg = logoFor(theme);
  const logo = document.getElementById('logo');
  if (logo) logo.innerHTML = svg;
  const icon = document.getElementById('favicon');
  if (icon) icon.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(svg));
}

function init() {
  load();

  let theme = 'dark';
  try { theme = localStorage.getItem('sales-platform-theme') || 'dark'; } catch (e) { theme = 'dark'; }
  applyTheme(theme);

  document.getElementById('btn-theme').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    rerenderCharts();
  });

  /* Один обработчик на всю страницу: разметка пересобирается целиком,
     поэтому навешивать слушатели на каждую кнопку бессмысленно */
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const view = nav.getAttribute('data-nav');
      const cpId = nav.getAttribute('data-cp') || '';
      if (view === 'cp') { route = { view: 'cp', cpId: cpId, sub: 'summary', orderId: '' }; window.scrollTo({ top: 0 }); render(); }
      else go(view);
      return;
    }
    const sub = e.target.closest('[data-sub]');
    if (sub && route.view === 'cp') { route.sub = sub.getAttribute('data-sub'); render(); return; }

    const act = e.target.closest('[data-act]');
    if (act) { handleAction(act.getAttribute('data-act'), act); }
  });

  /* Фильтры: смена контрагента сбрасывает выбранный договор, иначе
     остался бы фильтр по договору чужого контрагента */
  document.addEventListener('change', (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) {
      const key = f.getAttribute('data-filter');
      filters[key] = f.value;
      if (key === 'cpId') filters.contractId = '';
      render();
      return;
    }

    /* Списки заказа меняют состав зависимых полей, поэтому здесь нужна
       полная перерисовка: выбор в select виден сразу, терять ввод нечему. */
    const pf = e.target.closest('[data-price-file-date]');
    if (pf) {
      const c = cpById(pf.getAttribute('data-cp'));
      const f = c && priceFiles(c).find((x) => x.id === pf.getAttribute('data-price-file-date'));
      if (f) { f.validFrom = pf.value; save(); }
      return;
    }

    const of = e.target.closest('[data-order-field]');
    if (of && of.tagName === 'SELECT') {
      const o = orderById(route.orderId);
      if (!o) return;
      const key = of.getAttribute('data-order-field');
      o[key] = of.value;
      if (key === 'cpId') o.contractId = '';
      save(); render();
    }
  });

  /* Текстовые поля сохраняются по каждому нажатию клавиши: событие change
     у них приходит только при потере фокуса, и правка отставала бы на одно
     действие, а иногда и пропадала совсем. */
  document.addEventListener('input', (e) => {
    const of = e.target.closest('[data-order-field]');
    if (of && of.tagName !== 'SELECT') {
      const o = orderById(route.orderId);
      if (!o) return;
      o[of.getAttribute('data-order-field')] = of.value;
      save();
      updateOrderLive();
      return;
    }

    /* Позиции прайса сохраняются так же, как позиции заказа: по вводу,
       а не по потере фокуса — иначе правка отставала бы на одно действие */
    const pi = e.target.closest('[data-price]');
    if (pi) {
      const c = cpById(route.cpId);
      if (!c) return;
      const row = priceItems(c).find((x) => x.id === pi.getAttribute('data-price'));
      if (!row) return;
      const field = pi.getAttribute('data-field');
      row[field] = field === 'price' ? (Number(String(pi.value).replace(',', '.')) || 0) : pi.value;
      save();
      return;
    }

    const item = e.target.closest('[data-item]');
    if (item) {
      const o = orderById(route.orderId);
      if (!o) return;
      const it = o.items.find((x) => x.id === item.getAttribute('data-item'));
      if (!it) return;
      const field = item.getAttribute('data-field');
      it[field] = (field === 'qty' || field === 'price')
        ? Number(String(item.value).replace(',', '.')) || 0
        : item.value;
      save();
      updateOrderLive();
    }
  });

  /* Котик у нижнего края страницы — тот же контур, что и в пустых местах */
  const pageCat = document.getElementById('page-cat');
  if (pageCat) pageCat.innerHTML = catSVG();

  /* Ширина графиков считается от контейнера, поэтому при изменении окна
     их надо перерисовать. Ждём, пока размер перестанет меняться. */
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      chartJobs.forEach((job) => {
        const host = document.getElementById(job.id);
        if (host) job.draw(host);
      });
    }, 180);
  });

  render();
}

document.addEventListener('DOMContentLoaded', init);
