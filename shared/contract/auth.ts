import { z } from 'zod';
import { roleSchema, userSchema } from './access.ts';
import { epochMsSchema } from './common.ts';
import { passwordSchema } from './password-policy.ts';
import { permissionSchema } from './permissions.ts';

export const SESSION_COOKIE = 'fms_sid';

export const loginSchema = z.object({ email: z.string(), password: z.string() });
export type LoginRequest = z.infer<typeof loginSchema>;

export const meSchema = z.object({
  user: userSchema,
  role: roleSchema,
  permissions: z.array(permissionSchema),
  fleetIds: z.array(z.string()),
});
export type Me = z.infer<typeof meSchema>;

export const forgotPasswordSchema = z.object({ email: z.email() });
export const resetPasswordSchema = z.object({ token: z.string().min(1), password: passwordSchema });
export const inviteInfoSchema = z.object({ email: z.string(), expiresAt: epochMsSchema });
export const acceptInviteSchema = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(1),
  password: passwordSchema,
});
