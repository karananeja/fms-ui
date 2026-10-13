import { z } from 'zod';

/** All times are epoch milliseconds (UTC). */
export const epochMsSchema = z.number().int().nonnegative();

export const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
