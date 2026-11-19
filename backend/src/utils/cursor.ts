/**
 * Composite Cursor-Based Pagination Utilities (Phase 9)
 *
 * Provides:
 * - Deterministic, opaque Base64URL encoding/decoding of (createdAt, _id)
 * - Safe validation against malformed strings, corrupted dates, and invalid ObjectIds
 * - Stable compound comparison filters for MongoDB queries
 */

import { Types } from 'mongoose';

export interface CursorPayload {
  createdAt: Date;
  id: Types.ObjectId;
}

export interface EncodedCursorPayload {
  createdAt: string;
  id: string;
}

export interface PaginationMeta {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
  total?: number;
}

/**
 * Encode (createdAt, id) into an opaque Base64URL cursor.
 */
export function encodeCursor(
  createdAt: Date | string,
  id: string | Types.ObjectId
): string {
  const dateStr = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  const idStr = id.toString();

  const payload: EncodedCursorPayload = {
    createdAt: dateStr,
    id: idStr,
  };

  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode a Base64URL cursor string into validated Date and ObjectId.
 * Returns null if the cursor is malformed, not valid JSON, or contains an invalid date/ObjectId.
 */
export function decodeCursor(cursor: string): CursorPayload | null {
  if (!cursor || typeof cursor !== 'string') {
    return null;
  }

  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const { createdAt, id } = parsed as Record<string, unknown>;

    if (typeof createdAt !== 'string' || typeof id !== 'string') {
      return null;
    }

    const date = new Date(createdAt);
    if (isNaN(date.getTime())) {
      return null;
    }

    if (!Types.ObjectId.isValid(id)) {
      return null;
    }

    return {
      createdAt: date,
      id: new Types.ObjectId(id),
    };
  } catch {
    return null;
  }
}

/**
 * Build compound MongoDB comparison filter for descending pagination:
 * (createdAt < cursorDate) OR (createdAt == cursorDate AND _id < cursorId)
 */
export function buildDescendingCursorFilter(cursor: CursorPayload): {
  $or: Array<Record<string, unknown>>;
} {
  return {
    $or: [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ],
  };
}
