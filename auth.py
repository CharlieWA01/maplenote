"""A single password in front of the whole app, for when it's reachable online.

Until Cognito login exists, a hosted Maplenote asks for one password on its
own sign-in page (/login). A correct password earns a session cookie, which
the browser then sends with every request (page, scripts and API calls
alike) for 30 days, or until "/logout". The connection is HTTPS, so the
password and the cookie are encrypted on the way.

Why a page and not the browser's built-in sign-in box (HTTP Basic): AWS
Lambda function URLs drop the reply header that makes the browser show that
box, so on AWS the browser just showed an error. Basic authentication still
works for scripts (`curl -u any:password`).

The cookie holds the time it was issued and a signature made with the
password hash as the key (HMAC-SHA256). It can't be forged without the
hash, and changing the password signs everyone out.

The server is given only a *hash* of the password (MAPLENOTE_PASSWORD_HASH),
never the password itself, so the AWS console, Terraform state and logs
never contain it. Make a hash with:

    python auth.py

For Basic authentication the username is ignored; only the password counts.
Locally the setting is empty and nothing changes.
"""
import base64
import getpass
import hashlib
import hmac
import time

from werkzeug.security import check_password_hash, generate_password_hash

# Checking a password against its hash is deliberately slow (that's what makes
# a stolen hash hard to crack), and the browser sends the password with every
# request. So the last header that matched is remembered, and an identical
# one is accepted without redoing the slow check.
_last_accepted = None


SESSION_COOKIE = "maplenote_session"
SESSION_SECONDS = 30 * 24 * 60 * 60  # 30 days


def _signature(issued, password_hash):
    message = f"maplenote-session:{issued}".encode()
    return hmac.new(password_hash.encode(), message, hashlib.sha256).hexdigest()


def new_session(password_hash, now=None):
    """A session cookie value: "<issued time>.<signature>"."""
    issued = int(time.time() if now is None else now)
    return f"{issued}.{_signature(issued, password_hash)}"


def session_is_valid(value, password_hash, now=None):
    """True for a cookie this server issued, with the current password, under 30 days ago."""
    issued, _, signature = (value or "").partition(".")
    if not issued.isdigit():
        return False
    now = time.time() if now is None else now
    if not 0 <= now - int(issued) < SESSION_SECONDS:
        return False
    return hmac.compare_digest(signature, _signature(int(issued), password_hash))


def password_is_right(password, password_hash):
    return check_password_hash(password_hash, password)


def password_from_header(header):
    """The password in an "Authorization: Basic <base64 of user:password>" header, or None."""
    scheme, _, encoded = (header or "").partition(" ")
    if scheme.lower() != "basic":
        return None
    try:
        decoded = base64.b64decode(encoded.strip(), validate=True).decode("utf-8")
    except ValueError:  # not base64, or not UTF-8
        return None
    _user, colon, password = decoded.partition(":")
    return password if colon else None


def is_allowed(header, password_hash):
    """True if the request's Authorization header carries the right password."""
    global _last_accepted
    # compare_digest takes the same time whether or not the start matches, so
    # timing can't be used to guess the header one character at a time.
    if _last_accepted is not None and header and hmac.compare_digest(header, _last_accepted):
        return True
    password = password_from_header(header)
    if password is None or not check_password_hash(password_hash, password):
        return False
    _last_accepted = header
    return True


if __name__ == "__main__":
    first = getpass.getpass("New Maplenote password: ")
    if len(first) < 12:
        raise SystemExit("Use at least 12 characters (a passphrase of a few words is fine).")
    if getpass.getpass("Same again: ") != first:
        raise SystemExit("The two didn't match. Nothing was made.")
    print("\nMAPLENOTE_PASSWORD_HASH (safe to store; it can't be turned back into the password):\n")
    print(generate_password_hash(first))
