import jwt from 'jsonwebtoken';
import { Response } from 'express';
import { config } from '../../config/env';
import { UserRole } from './user.model';

export const AUTH_COOKIE_NAME = 'token';

export interface JwtPayload {
  userId: string;
  role: UserRole;
}

/**
 * Signs a JWT with user id and role.
 */
export const signToken = (payload: JwtPayload): string => {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
};

/**
 * Verifies a JWT and extracts payload.
 */
export const verifyToken = (token: string): JwtPayload => {
  return jwt.verify(token, config.JWT_SECRET) as JwtPayload;
};

/**
 * Sets secure HTTP-only authentication cookie.
 */
export const setAuthCookie = (res: Response, token: string): void => {
  const isProduction = config.NODE_ENV === 'production';

  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    path: '/',
  });
};

/**
 * Clears authentication cookie.
 */
export const clearAuthCookie = (res: Response): void => {
  const isProduction = config.NODE_ENV === 'production';

  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  });
};
