/** Dev-only auto sign-in until F02 ships a login page. Never bundled in production builds. */
export async function devSignIn(): Promise<Response> {
  const email = import.meta.env.VITE_DEV_LOGIN_EMAIL || 'superadmin@fms.local';
  const password = import.meta.env.VITE_DEV_LOGIN_PASSWORD || 'Admin@123';
  console.info(`[dev] signing in as ${email}`);
  return fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}
