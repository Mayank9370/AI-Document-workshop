import { Request, Response, NextFunction } from 'express';
import { verifyToken, AUTH_COOKIE_NAME } from '../modules/auth/auth.utils';
import { User, SafeUser, UserRole } from '../modules/auth/user.model';
import { sendError } from '../utils/response';
import { logger } from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      user?: SafeUser;
    }
  }
}

/**
 * Verifies JWT from HTTP-only cookie (or Authorization Bearer header)
 * and attaches authenticated user profile to req.user.
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // 1. Check HTTP-only cookie first, then Bearer header
    let token: string | undefined = req.cookies?.[AUTH_COOKIE_NAME];

    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      sendError(res, 'Authentication required. Please log in.', 401);
      return;
    }

    // 2. Verify token
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch {
      sendError(res, 'Invalid or expired session. Please log in again.', 401);
      return;
    }

    // 3. Find user in database
    const user = await User.findById(decoded.userId);
    if (!user) {
      sendError(res, 'User account no longer exists.', 401);
      return;
    }

    // 4. Update lastActiveAt using a 5-minute throttle to avoid unnecessary DB writes
    const now = Date.now();
    const lastActive = user.lastActiveAt ? new Date(user.lastActiveAt).getTime() : 0;
    const FIVE_MINUTES_MS = 5 * 60 * 1000;

    if (now - lastActive > FIVE_MINUTES_MS) {
      const activeDate = new Date(now);
      user.lastActiveAt = activeDate;
      User.collection
        .updateOne({ _id: user._id }, { $set: { lastActiveAt: activeDate } })
        .catch((err) => {
          logger.warn(`Failed to update lastActiveAt for user ${user._id}: ${err}`);
        });
    }

    // 5. Attach safe user to request
    req.user = user.toSafeObject();
    next();
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Authentication failed';
    logger.error(`Authentication middleware error: ${msg}`);
    sendError(res, 'Authentication processing failure.', 401);
  }
};

/**
 * Restricts access to specific user roles.
 */
export const authorize = (...allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendError(res, 'Authentication required.', 401);
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      sendError(res, 'Access denied. You do not have permission to perform this action.', 403);
      return;
    }

    next();
  };
};
