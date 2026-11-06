/** Data local no formato yyyy-mm-dd (para inputs type=date). */
export function todayIso(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}
