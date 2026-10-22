// The SHA-256 fingerprint of a request's body, as hex, for the
// x-amz-content-sha256 header. In production Maplenote sits behind CloudFront,
// which signs every request it passes to the Lambda function (origin access
// control, so nothing can reach the function except through CloudFront). AWS
// can only check that signature for a PUT or POST if the page sends its body's
// hash (cloud-homelab DECISIONS.md, 2026-10-20). Elsewhere the header is
// simply ignored.
//
// Used by app.js (saves and other API calls) and login.js (signing in).
// Returns null where the browser offers no hashing: plain-HTTP addresses such
// as penguin.linux.test, which are never behind CloudFront anyway.
async function bodyHash(text) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Headers to add to a request that sends `text` as its body.
async function bodyHashHeaders(text) {
  const hash = await bodyHash(text);
  return hash ? { "x-amz-content-sha256": hash } : {};
}
