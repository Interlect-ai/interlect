// The e-mail interlect.ai/login hands on in the address's # part: "#email=name%40fund.com".
// Read once on the login page, which then removes it from the address bar.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The handed-on e-mail, or null when the # part has none or it does not read as an e-mail. */
export function emailFromHash(hash: string): string | null {
  const raw = new URLSearchParams(hash.replace(/^#/, "")).get("email");
  const email = raw?.trim().toLowerCase() ?? "";
  return email.length <= 320 && EMAIL.test(email) ? email : null;
}
