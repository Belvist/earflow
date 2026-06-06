/**
 * @param {unknown} err
 * @returns {string}
 */
export default function formatPartyError(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;

  const message =
    typeof err.message === 'string' && err.message.trim() ? err.message.trim() : 'Ошибка соединения';
  const parts = [];

  if (typeof err.code === 'string' && err.code.trim()) parts.push(err.code.trim());
  if (typeof err.closeCode === 'number') parts.push(`close=${err.closeCode}`);
  if (typeof err.closeReason === 'string' && err.closeReason.trim()) parts.push(err.closeReason.trim());
  if (typeof err.wsUrl === 'string' && err.wsUrl.trim()) parts.push(err.wsUrl.trim());

  if (parts.length === 0) return message;
  return `${message} (${parts.join(', ')})`;
}
