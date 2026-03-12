import { describe, it, expect } from 'vitest';
import { partitionByGmailId, buildActionResult } from '@/lib/email-utils';

describe('partitionByGmailId', () => {
  it('separates rows with valid gmail_message_id from rows with null', () => {
    const rows = [
      { id: '1', gmail_message_id: 'abc123', label_ids: ['INBOX'] },
      { id: '2', gmail_message_id: null, label_ids: ['INBOX'] },
      { id: '3', gmail_message_id: 'def456', label_ids: ['INBOX'] },
    ];

    const { valid, invalid } = partitionByGmailId(rows);

    expect(valid).toHaveLength(2);
    expect(valid.map((r) => r.id)).toEqual(['1', '3']);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].id).toBe('2');
  });

  it('treats undefined and empty string gmail_message_id as invalid', () => {
    const rows = [
      { id: '1', gmail_message_id: undefined },
      { id: '2', gmail_message_id: '' },
      { id: '3', gmail_message_id: 'valid-id' },
    ];

    const { valid, invalid } = partitionByGmailId(rows);

    expect(valid).toHaveLength(1);
    expect(valid[0].id).toBe('3');
    expect(invalid).toHaveLength(2);
  });

  it('returns empty arrays for empty input', () => {
    const { valid, invalid } = partitionByGmailId([]);

    expect(valid).toEqual([]);
    expect(invalid).toEqual([]);
  });

  it('preserves all original row properties on valid rows', () => {
    const rows = [
      { id: '1', gmail_message_id: 'abc', label_ids: ['INBOX'], is_read: false },
    ];

    const { valid } = partitionByGmailId(rows);

    expect(valid[0]).toEqual({
      id: '1',
      gmail_message_id: 'abc',
      label_ids: ['INBOX'],
      is_read: false,
    });
  });
});

describe('buildActionResult', () => {
  it('returns success when Gmail succeeds and DB has no errors', () => {
    const result = buildActionResult('trash', { affected: 3, failed: 0 }, null);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.affected).toBe(3);
  });

  it('returns 207 partial success when Gmail succeeds but DB update fails', () => {
    const result = buildActionResult('trash', { affected: 3, failed: 0 }, 'DB update failed');

    expect(result.status).toBe(207);
    expect(result.body.success).toBe(false);
    expect(result.body.warning).toContain('DB');
    expect(result.body.affected).toBe(3);
  });

  it('returns success with failed count when some Gmail operations fail', () => {
    const result = buildActionResult('archive', { affected: 2, failed: 1 }, null);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.affected).toBe(2);
    expect(result.body.failed).toBe(1);
  });

  it('returns 207 when both Gmail has failures and DB has errors', () => {
    const result = buildActionResult('archive', { affected: 2, failed: 1 }, 'connection reset');

    expect(result.status).toBe(207);
    expect(result.body.success).toBe(false);
    expect(result.body.affected).toBe(2);
    expect(result.body.failed).toBe(1);
  });
});
