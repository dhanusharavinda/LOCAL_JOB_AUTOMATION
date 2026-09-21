/**
 * Turns Supabase auth errors into something a person can act on.
 *
 * Supabase's raw strings leak its own infrastructure at the user: "Email
 * rate limit exceeded" tells someone trying to sign in nothing about what
 * they should do, and reads like the site is broken. These are the ones
 * that actually reach users, mapped to plain instructions.
 */
export function friendlyAuthError(err: any): string {
  const raw = String(err?.message || err || "").trim();
  const code = String(err?.code || "").trim();
  const lower = raw.toLowerCase();

  // The project's email quota is spent. Nothing the user does will help,
  // so say so plainly rather than making them retry into a wall.
  if (code === "over_email_send_rate_limit" || lower.includes("email rate limit")) {
    return "We have hit our email limit for the moment, so the confirmation email could not go out. Your account is fine. Wait a few minutes and sign in, or message Dhanush and he will sort it straight away.";
  }

  // Too many attempts from one address.
  if (code === "over_request_rate_limit" || (lower.includes("rate limit") && !lower.includes("email"))) {
    return "Too many attempts in a short time. Wait about a minute, then try again.";
  }

  if (lower.includes("email not confirmed")) {
    return "This account still needs its email confirmed. Check your inbox and spam folder for the link, or message Dhanush to have it activated.";
  }

  if (lower.includes("invalid login credentials")) {
    return "That email and password do not match an account. Check the password, or use 'Forgot password' to set a new one.";
  }

  if (lower.includes("user already registered") || lower.includes("already been registered")) {
    return "There is already an account with this email. Sign in instead, or use 'Forgot password' if you cannot remember it.";
  }

  if (lower.includes("password should be at least")) {
    return "Password is too short. Use at least 6 characters.";
  }

  if (lower.includes("failed to fetch") || lower.includes("networkerror")) {
    return "Could not reach the server. Check your connection and try again.";
  }

  return raw || "Authentication failed. Please try again.";
}
