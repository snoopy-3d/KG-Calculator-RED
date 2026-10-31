// Только подтверждённые владельцем данные. Пустой список намеренный.
// Запись: { level: положительное целое, power: целое >= 0,
// verified: true, evidence: непустое описание проверки, verifiedAt: YYYY-MM-DD }
export const thresholds = [];
export function verifiedThreshold(level, rows = thresholds) {
  const matches = rows.filter(r => r.level === level);
  if (matches.length !== 1) return null;
  const r = matches[0];
  return r.verified === true && Number.isSafeInteger(r.power) && r.power >= 0
    && typeof r.evidence === 'string' && r.evidence.trim()
    && /^\d{4}-\d{2}-\d{2}$/.test(r.verifiedAt ?? '') ? r.power : null;
}
