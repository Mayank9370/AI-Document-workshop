import { Request, Response } from 'express';
import { registerSchema, loginSchema } from './auth.validation';
import { User } from './user.model';
import { signToken, setAuthCookie, clearAuthCookie } from './auth.utils';
import { sendSuccess, sendError } from '../../utils/response';
import { logger } from '../../utils/logger';

/**
 * Register a new user with 'user' role.
 * POST /api/auth/register
 */
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => e.message).join(', ');
      sendError(res, errorMsg, 400);
      return;
    }

    const { name, email, password } = parseResult.data;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      sendError(res, 'An account with this email address already exists.', 409);
      return;
    }

    // Role is strictly forced to 'user' for public registration
    const user = new User({
      name,
      email,
      password,
      role: 'user',
    });

    await user.save();

    // Issue JWT and set HTTP-only cookie
    const token = signToken({
      userId: user._id.toString(),
      role: user.role,
    });
    setAuthCookie(res, token);

    logger.info(`New user registered: ${user.email} (Role: ${user.role})`);

    sendSuccess(
      res,
      'User registered successfully.',
      { user: user.toSafeObject() },
      201
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Registration error';
    logger.error(`Registration error: ${msg}`);
    sendError(res, 'Internal server error during registration.', 500);
  }
};

/**
 * Log in an existing user.
 * POST /api/auth/login
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => e.message).join(', ');
      sendError(res, errorMsg, 400);
      return;
    }

    const { email, password } = parseResult.data;

    // Find user by normalized email
    const user = await User.findOne({ email });
    if (!user) {
      sendError(res, 'Invalid email or password.', 401);
      return;
    }

    // Compare password hash
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      sendError(res, 'Invalid email or password.', 401);
      return;
    }

    // Issue JWT and set HTTP-only cookie
    const token = signToken({
      userId: user._id.toString(),
      role: user.role,
    });
    setAuthCookie(res, token);

    // Update lastActiveAt on login
    const loginNow = new Date();
    user.lastActiveAt = loginNow;
    User.collection.updateOne({ _id: user._id }, { $set: { lastActiveAt: loginNow } }).catch(() => {});

    logger.info(`User logged in: ${user.email} (Role: ${user.role})`);

    sendSuccess(
      res,
      'Logged in successfully.',
      { user: user.toSafeObject() },
      200
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Login error';
    logger.error(`Login error: ${msg}`);
    sendError(res, 'Internal server error during login.', 500);
  }
};

/**
 * Retrieve the current authenticated user profile.
 * GET /api/auth/me
 */
export const getCurrentUser = (req: Request, res: Response): void => {
  if (!req.user) {
    sendError(res, 'Unauthenticated.', 401);
    return;
  }

  sendSuccess(res, 'Current user profile retrieved.', { user: req.user });
};

/**
 * Log out and clear the HTTP-only authentication cookie.
 * POST /api/auth/logout
 */
export const logout = (_req: Request, res: Response): void => {
  clearAuthCookie(res);
  sendSuccess(res, 'Logged out successfully.', null, 200);
};

/**
 * Admin-only test endpoint to verify RBAC enforcement.
 * GET /api/auth/admin-test
 */
export const adminTest = (req: Request, res: Response): void => {
  sendSuccess(
    res,
    'Admin access authorization verified successfully.',
    { admin: req.user },
    200
  );
};
