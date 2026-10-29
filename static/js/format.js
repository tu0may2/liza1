/* Форматирование чисел и дат. Везде русская локаль: разряды неразрывными
   пробелами, десятичная запятая. */
'use strict';

const RUB = '₽';
const NBSP = ' ';

function fmtMoney(v, opts) {
  const o = opts || {};
  const n = Number(v) || 0;
  const digits = o.digits == null ? 0 : o.digits;
  const s = n.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return o.bare ? s : s + NBSP + RUB;
}

/* Короткая запись для осей и плиток: 1,2 млн вместо 1 200 000 */
function fmtShort(v) {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + NBSP + 'млрд';
  if (a >= 1e6) return (n / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + NBSP + 'млн';
  if (a >= 1e4) return Math.round(n / 1e3).toLocaleString('ru-RU') + NBSP + 'тыс';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
}

function fmtQty(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

function fmtPct(v, digits) {
  const n = Number(v) || 0;
  return n.toLocaleString('ru-RU', { maximumFractionDigits: digits == null ? 1 : digits }) + NBSP + '%';
}

/* ISO-дата (ГГГГ-ММ-ДД) — единственный формат хранения. */
function today() {
  const d = new Date();
  return iso(d);
}

function iso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function parseISO(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(s) {
  const d = parseISO(s);
  if (!d) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

function monthKey(s) { return String(s || '').slice(0, 7); }

function fmtMonth(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!m) return String(key || '');
  return MONTHS[Number(m[2]) - 1] + NBSP + m[1].slice(2);
}

/* Сдвиг на n месяцев от текущего, в формате ГГГГ-ММ */
function monthShift(n) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/* Разница в днях: положительная — дата в будущем */
function daysFromToday(s) {
  const d = parseISO(s);
  if (!d) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/* Экранирование: всё, что пришло от пользователя, попадает в разметку
   только через эту функцию */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Имя скачиваемого файла.

   Когда страницу открыли прямо из файла, браузер не принимает в имени
   ничего, кроме латиницы: кириллическое имя он молча отбрасывает целиком,
   и файл сохраняется как «download» без расширения. Поэтому для самой
   загрузки имя переводится в латиницу, а на экране остаётся как есть. */
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya'
};

function translit(text) {
  return String(text == null ? '' : text).split('').map((ch) => {
    const lower = ch.toLowerCase();
    const mapped = TRANSLIT[lower];
    if (mapped == null) return ch;
    return ch === lower ? mapped : (mapped.charAt(0).toUpperCase() + mapped.slice(1));
  }).join('');
}

function asciiFileName(name, fallback) {
  const ascii = translit(name)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return ascii || (fallback || 'file');
}

/* Дата и время — для истории правок и отметок о загрузке. На вход идёт
   метка времени от сервера (ISO с часовым поясом). */
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/* «2 минуты назад» — в истории так понятнее, чем точная метка */
function fmtAgo(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'только что';
  const min = Math.round(sec / 60);
  if (min < 60) return min + ' ' + plural(min, 'минуту', 'минуты', 'минут') + ' назад';
  const hours = Math.round(min / 60);
  if (hours < 24) return hours + ' ' + plural(hours, 'час', 'часа', 'часов') + ' назад';
  const days = Math.round(hours / 24);
  if (days < 30) return days + ' ' + plural(days, 'день', 'дня', 'дней') + ' назад';
  return fmtDate(iso.slice(0, 10));
}
