/**
 * Partitions email rows into those with valid gmail_message_id and those without.
 * Rows with null, undefined, or empty string gmail_message_id are separated out
 * so batch Gmail API calls don't fail on invalid IDs.
 */
export function partitionByGmailId<T extends { gmail_message_id: unknown }>(
  rows: T[],
): { valid: T[]; invalid: T[] } {
  const valid: T[] = [];
  const invalid: T[] = [];
  for (const row of rows) {
    if (typeof row.gmail_message_id === 'string' && row.gmail_message_id.length > 0) {
      valid.push(row);
    } else {
      invalid.push(row);
    }
  }
  return { valid, invalid };
}

/**
 * Builds a standardized action result based on Gmail operation outcome and DB sync status.
 * Returns 207 Multi-Status when DB update fails after Gmail succeeds (partial success).
 */
export function buildActionResult(
  action: string,
  gmailResult: { affected: number; failed: number },
  dbError: string | null,
): { status: number; body: { success: boolean; affected: number; failed?: number; warning?: string } } {
  const hasDbError = dbError !== null;
  const status = hasDbError ? 207 : 200;
  const success = !hasDbError;

  const body: { success: boolean; affected: number; failed?: number; warning?: string } = {
    success,
    affected: gmailResult.affected,
  };

  if (gmailResult.failed > 0) {
    body.failed = gmailResult.failed;
  }

  if (hasDbError) {
    body.warning = `Gmail action succeeded but DB sync failed: ${dbError}`;
  }

  return { status, body };
}
