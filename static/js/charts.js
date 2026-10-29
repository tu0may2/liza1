/* Графики. Чистый inline SVG без библиотек: страница работает из файла,
   без интернета и без сборки.

   Общие правила, одинаковые для всех графиков здесь:
   · одна шкала значений на график — две оси Y не рисуем никогда;
   · цвет закреплён за сущностью, фильтр не перекрашивает уцелевшие серии;
   · между соседними заливками разрыв 2px цветом подложки;
   · верх столбца скруглён на 4px, низ прижат к базовой линии;
   · при двух и более сериях легенда есть всегда, рядом — кнопка «Таблицей»,
     чтобы те же числа читались без цвета;
   · подсказка при наведении — часть графика, а не украшение. */
'use strict';

const SVGNS = 'http://www.w3.org/2000/svg';

function el(name, attrs, parent) {
  const n = document.createElementNS(SVGNS, name);
  if (attrs) Object.keys(attrs).forEach((k) => n.setAttribute(k, attrs[k]));
  if (parent) parent.appendChild(n);
  return n;
}

/* Ширина берётся с контейнера: график рисуется уже вставленным в DOM,
   поэтому размер известен. Фиксированная ширина с масштабированием по CSS
   растягивала бы его и по высоте — на широком мониторе столбцы выходили
   бы в полэкрана. */
function plotWidth(host) {
  const w = host.clientWidth || (host.parentNode && host.parentNode.clientWidth) || 760;
  return Math.max(320, Math.min(1500, Math.round(w)));
}

/* «Красивый» шаг сетки: 1·10^n, 2·10^n или 5·10^n */
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return mult * pow;
}

function axisTicks(max, count) {
  if (!(max > 0)) return { ticks: [0, 1], top: 1 };
  const step = niceStep(max / (count || 4));
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return { ticks: ticks, top: top };
}

/* Путь столбца со скруглённым верхом (r) и прямым низом */
function barPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return 'M' + x + ' ' + (y + h) +
         ' L' + x + ' ' + (y + rr) +
         ' Q' + x + ' ' + y + ' ' + (x + rr) + ' ' + y +
         ' L' + (x + w - rr) + ' ' + y +
         ' Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + rr) +
         ' L' + (x + w) + ' ' + (y + h) + ' Z';
}

function tipBox(host) {
  let tip = host.querySelector('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    host.appendChild(tip);
  }
  return tip;
}

function showTip(host, tip, px, py, html) {
  tip.innerHTML = html;
  tip.style.left = px + 'px';
  tip.style.top = Math.max(26, py) + 'px';
  tip.style.opacity = '1';
}

function hideTip(tip) { tip.style.opacity = '0'; }

function legendHTML(series) {
  if (series.length < 2) return '';
  return '<div class="legend">' + series.map((s) =>
    '<span class="legend__item"><i class="legend__mark" style="background:' + s.color + '"></i>' +
    esc(s.label) + '</span>').join('') + '</div>';
}

/* ------------------------------------------------------------------ */
/* Столбцы с накоплением по периодам                                  */
/* ------------------------------------------------------------------ */
/* opts: { labels: ['окт 25', ...],
           series: [{ label, color, values: [] }],
           total: (i) => строка под подсказкой,
           fmt: функция подписи значений (по умолчанию короткие рубли) } */
function stackedBars(host, opts) {
  const labels = opts.labels || [];
  const series = (opts.series || []).filter((s) => s.values.some((v) => v));
  const fmt = opts.fmt || fmtShort;
  host.innerHTML = '';
  if (!labels.length || !series.length) {
    host.innerHTML = '<p class="empty">Нет данных за выбранный период</p>';
    return;
  }

  const sums = labels.map((_, i) => series.reduce((s, ser) => s + (Number(ser.values[i]) || 0), 0));
  const { ticks, top } = axisTicks(Math.max.apply(null, sums), 4);

  const W = plotWidth(host), H = 230, padL = 54, padR = 12, padT = 12, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / labels.length;
  const barW = Math.min(46, slot * 0.62);
  const yOf = (v) => padT + plotH - (v / top) * plotH;

  const legend = document.createElement('div');
  legend.innerHTML = legendHTML(series);
  if (legend.firstChild) host.appendChild(legend.firstChild);

  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img',
    'aria-label': opts.aria || 'Столбчатая диаграмма по периодам' }, host);

  ticks.forEach((t) => {
    el('line', { class: 'grid-line', x1: padL, x2: W - padR, y1: yOf(t), y2: yOf(t) }, svg);
    const tx = el('text', { x: padL - 8, y: yOf(t) + 4, 'text-anchor': 'end' }, svg);
    tx.textContent = fmt(t);
  });
  el('line', { class: 'axis-line', x1: padL, x2: W - padR, y1: yOf(0), y2: yOf(0) }, svg);

  const tip = tipBox(host);

  labels.forEach((lab, i) => {
    const cx = padL + slot * i + slot / 2;
    const x = cx - barW / 2;
    let acc = 0;
    /* Рисуем снизу вверх, скругление — только у верхнего непустого сегмента */
    const nonEmpty = series.map((s, si) => ({ si: si, v: Number(s.values[i]) || 0 })).filter((o) => o.v > 0);
    nonEmpty.forEach((o, k) => {
      const s = series[o.si];
      const h = (o.v / top) * plotH;
      const y = yOf(acc + o.v);
      const isTop = k === nonEmpty.length - 1;
      el('path', { class: 'seg', d: barPath(x, y, barW, h, isTop ? 4 : 0), fill: s.color }, svg);
      acc += o.v;
    });

    const tl = el('text', { x: cx, y: H - padB + 17, 'text-anchor': 'middle' }, svg);
    tl.textContent = lab;

    /* Подпись итога столбца — прямая метка вместо числа на каждом сегменте */
    if (sums[i] > 0) {
      const vl = el('text', { class: 'val-label', x: cx, y: yOf(sums[i]) - 6, 'text-anchor': 'middle' }, svg);
      vl.textContent = fmt(sums[i]);
    }

    /* Зона наведения шире столбца — попасть легче, чем в саму марку */
    const hit = el('rect', { class: 'hit', x: padL + slot * i, y: padT, width: slot, height: plotH,
      tabindex: '0', role: 'button', 'aria-label': lab + ': ' + fmt(sums[i]) }, svg);
    const html = '<div><b>' + esc(lab) + '</b></div>' +
      series.map((s) => {
        const v = Number(s.values[i]) || 0;
        if (!v) return '';
        return '<div class="chart-tip__row"><i class="legend__mark" style="background:' + s.color + '"></i>' +
          esc(s.label) + ' — <b>' + fmtMoney(v) + '</b></div>';
      }).join('') +
      (series.length > 1 ? '<div class="chart-tip__row" style="margin-top:3px;color:var(--text-mute)">Итого <b>' + fmtMoney(sums[i]) + '</b></div>' : '');
    const show = () => showTip(host, tip, cx, yOf(sums[i]) - 6, html);
    hit.addEventListener('mouseenter', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('mouseleave', () => hideTip(tip));
    hit.addEventListener('blur', () => hideTip(tip));
  });
}

/* ------------------------------------------------------------------ */
/* Линии по периодам (план против факта, накопление)                  */
/* ------------------------------------------------------------------ */
function lineChart(host, opts) {
  const labels = opts.labels || [];
  const series = (opts.series || []).filter((s) => s.values.some((v) => v != null));
  const fmt = opts.fmt || fmtShort;
  host.innerHTML = '';
  if (!labels.length || !series.length) {
    host.innerHTML = '<p class="empty">Нет данных за выбранный период</p>';
    return;
  }

  let max = 0;
  series.forEach((s) => s.values.forEach((v) => { if (v > max) max = v; }));
  const { ticks, top } = axisTicks(max, 4);

  const W = plotWidth(host), H = 230, padL = 54, padR = 14, padT = 12, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const xOf = (i) => labels.length === 1 ? padL + plotW / 2 : padL + (plotW * i) / (labels.length - 1);
  const yOf = (v) => padT + plotH - (v / top) * plotH;

  const legend = document.createElement('div');
  legend.innerHTML = legendHTML(series);
  if (legend.firstChild) host.appendChild(legend.firstChild);

  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img',
    'aria-label': opts.aria || 'Линейный график по периодам' }, host);

  ticks.forEach((t) => {
    el('line', { class: 'grid-line', x1: padL, x2: W - padR, y1: yOf(t), y2: yOf(t) }, svg);
    const tx = el('text', { x: padL - 8, y: yOf(t) + 4, 'text-anchor': 'end' }, svg);
    tx.textContent = fmt(t);
  });
  el('line', { class: 'axis-line', x1: padL, x2: W - padR, y1: yOf(0), y2: yOf(0) }, svg);

  const cross = el('line', { class: 'crosshair', y1: padT, y2: padT + plotH, x1: padL, x2: padL }, svg);

  series.forEach((s) => {
    const d = s.values.map((v, i) => (i ? 'L' : 'M') + xOf(i) + ' ' + yOf(Number(v) || 0)).join(' ');
    el('path', { class: 'line', d: d, stroke: s.color, 'stroke-dasharray': s.dashed ? '5 4' : '' }, svg);
    s.values.forEach((v, i) => {
      el('circle', { class: 'dot', cx: xOf(i), cy: yOf(Number(v) || 0), r: 4.5, fill: s.color }, svg);
    });
  });

  labels.forEach((lab, i) => {
    /* Подписи оси X разрежаем, если точек много: иначе они наезжают */
    const everyN = Math.ceil(labels.length / 12);
    if (i % everyN === 0 || i === labels.length - 1) {
      const tl = el('text', { x: xOf(i), y: H - padB + 17, 'text-anchor': 'middle' }, svg);
      tl.textContent = lab;
    }
  });

  const tip = tipBox(host);
  const slot = labels.length > 1 ? plotW / (labels.length - 1) : plotW;
  labels.forEach((lab, i) => {
    const hit = el('rect', { class: 'hit', x: xOf(i) - slot / 2, y: padT, width: slot, height: plotH,
      tabindex: '0', role: 'button', 'aria-label': lab }, svg);
    const html = '<div><b>' + esc(lab) + '</b></div>' + series.map((s) =>
      '<div class="chart-tip__row"><i class="legend__mark" style="background:' + s.color + '"></i>' +
      esc(s.label) + ' — <b>' + fmtMoney(Number(s.values[i]) || 0) + '</b></div>').join('');
    const show = () => {
      cross.setAttribute('x1', xOf(i)); cross.setAttribute('x2', xOf(i));
      cross.style.opacity = '1';
      showTip(host, tip, xOf(i), 34, html);
    };
    hit.addEventListener('mouseenter', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('mouseleave', () => { hideTip(tip); cross.style.opacity = '0'; });
    hit.addEventListener('blur', () => { hideTip(tip); cross.style.opacity = '0'; });
  });
}

/* ------------------------------------------------------------------ */
/* Горизонтальные полосы: доли по контрагентам, договорам, позициям    */
/* ------------------------------------------------------------------ */
/* rows: [{ label, parts: [{ label, value, color }] }] */
function hBars(host, rows, opts) {
  const o = opts || {};
  host.innerHTML = '';
  const totals = rows.map((r) => r.parts.reduce((s, p) => s + (Number(p.value) || 0), 0));
  const max = Math.max.apply(null, totals.concat([0]));
  if (!rows.length || !max) {
    host.innerHTML = '<p class="empty">Нет данных</p>';
    return;
  }
  const legendSeries = [];
  rows.forEach((r) => r.parts.forEach((p) => {
    if (p.value && !legendSeries.some((x) => x.label === p.label)) legendSeries.push({ label: p.label, color: p.color });
  }));
  if (legendSeries.length > 1) {
    const lg = document.createElement('div');
    lg.innerHTML = legendHTML(legendSeries);
    host.appendChild(lg.firstChild);
  }
  rows.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'bar-row';
    const parts = r.parts.filter((p) => Number(p.value) > 0);
    row.innerHTML =
      '<span title="' + esc(r.label) + '">' + esc(r.label) + '</span>' +
      '<span class="bar-track">' + parts.map((p) =>
        '<i class="bar-fill" style="width:' + (totals[i] ? (p.value / max * 100) : 0) + '%;background:' + p.color +
        '" title="' + esc(p.label) + ': ' + fmtMoney(p.value) + '"></i>').join('') + '</span>' +
      '<span class="bar-val">' + (o.fmt ? o.fmt(totals[i]) : fmtMoney(totals[i])) + '</span>';
    host.appendChild(row);
  });
}

/* Та же выборка таблицей — чтобы числа читались без цвета */
function seriesTable(labels, series, fmt) {
  const f = fmt || ((v) => fmtMoney(v));
  const sums = labels.map((_, i) => series.reduce((s, ser) => s + (Number(ser.values[i]) || 0), 0));
  return '<div class="table-wrap"><table class="tbl tbl--mini"><thead><tr><th>Период</th>' +
    series.map((s) => '<th class="num"><span class="swatch" style="background:' + s.color + '"></span> ' + esc(s.label) + '</th>').join('') +
    (series.length > 1 ? '<th class="num">Итого</th>' : '') + '</tr></thead><tbody>' +
    labels.map((lab, i) => '<tr><td class="nowrap">' + esc(lab) + '</td>' +
      series.map((s) => '<td class="num">' + f(Number(s.values[i]) || 0) + '</td>').join('') +
      (series.length > 1 ? '<td class="num">' + f(sums[i]) + '</td>' : '') + '</tr>').join('') +
    '</tbody></table></div>';
}
