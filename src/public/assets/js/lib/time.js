// Horários e dias da semana. `minutesToLabel` existia duas vezes dentro do
// mesmo arquivo (routines.js), uma delas chamada minutesToTime.

export const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
export const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
// Nomes curtos para descrever a rotina em texto: 'DSTQQSS' tem dois S e dois Q
// indistinguíveis, o que serve num botão de 1 caractere mas não numa frase.
export const WEEKDAYS_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

// Minutos desde a meia-noite -> "06:40". Sem valor vira travessão.
export function minutesToLabel(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) return '—';
  const total = ((Math.trunc(Number(minutes)) % 1440) + 1440) % 1440;
  const h = String(Math.floor(total / 60)).padStart(2, '0');
  const m = String(total % 60).padStart(2, '0');
  return `${h}:${m}`;
}

// "06:40" -> 400
export function timeToMinutes(value) {
  const [h, m] = String(value || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Conjunto de dias -> "seg ter qua", com atalhos para os casos comuns.
export function describeDays(days) {
  const list = [...(days || [])].sort();
  if (!list.length || list.length === 7) return 'todos os dias';
  if (list.length === 5 && list.every((d) => d >= 1 && d <= 5)) return 'dias de semana';
  if (list.length === 2 && list.includes(0) && list.includes(6)) return 'fim de semana';
  return list.map((d) => WEEKDAYS_SHORT[d]).join(' ');
}
