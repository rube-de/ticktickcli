# Authentication

TickTick CLI is headless by design. It consumes credentials supplied by the user or an agent
harness; it does not sign in with a password, launch a browser, or mint OAuth tokens.

## Credential modes

The two API families use independent credentials:

| Mode | Credential | Coverage |
|---|---|---|
| v1 | Personal API token or user-bound OAuth bearer | Documented and official-client v1 operations |
| v2 | TickTick session token or cookie | Verified unofficial v2 operations for the selected host |
| hybrid | Both credentials | The union of verified v1 and v2 capabilities |
| none | No credential | Local help, configuration, and cached operations that do not need the network |

A v1 bearer is not a v2 session credential. Supplying one does not make the other capability
available. A command checks only the credential needed for its declared capability.

## Environment and secret-file inputs

For the selected profile, credential precedence is direct environment value, environment-named
secret file, then a saved profile credential.

| Environment variable | Meaning |
|---|---|
| `TT_ACCESS_TOKEN` | v1 bearer token |
| `TT_ACCESS_TOKEN_FILE` | File containing only the v1 bearer token |
| `TT_SESSION_TOKEN` | Value of the v2 `t` session cookie |
| `TT_SESSION_TOKEN_FILE` | File containing only the v2 session token |
| `TT_SESSION_COOKIE` | Full cookie header for a capability proven to require it |
| `TT_SESSION_COOKIE_FILE` | File containing the full cookie header |
| `TT_PROFILE` | Profile to select |
| `TT_HOST` | `ticktick.com` or `dida365.com` |

Do not set both the direct value and its file variant unless deliberately testing precedence.
Leading and trailing line endings are removed from secret-file values; the file must not contain
shell syntax or an `export` statement.

Examples:

```sh
TT_ACCESS_TOKEN_FILE=/run/secrets/ticktick-token \
  tt auth status --verify --json --no-input

TT_SESSION_TOKEN_FILE=/run/secrets/ticktick-session \
  tt search "quarterly report" --json --no-input
```

Environment credentials are ephemeral and never need an `auth` write command.

## Saving a credential

Pipe the secret over stdin so it does not appear in shell history or the process list:

```sh
read -r -s TT_TOKEN
printf '%s' "$TT_TOKEN" | tt auth token --stdin
unset TT_TOKEN
```

For a verified v2 session:

```sh
printf '%s' "$TT_SESSION" | tt auth session --stdin
```

The CLI validates a session's host and account before saving it. Credential files are separate
from `config.json` and are created atomically with restrictive permissions on supported systems.

Never pass secrets as positional values or ordinary flags. Never include them in bug reports,
fixtures, screenshots, verbose logs, or recorded terminal sessions.

## Status and account alignment

```sh
tt auth status --verify --json --no-input
tt doctor --json --no-input
```

Status reports `mode` as `v1`, `v2`, `hybrid`, or `none`, plus `fullCoverage` and an account match
state of `verified`, `unknown`, `mismatch`, or `not_applicable`. A detectable mismatch blocks
mixed-API and mixed-cache operations. `unknown` means the APIs did not expose enough overlapping
identity to prove alignment; it is not silently promoted to a match.

The doctor recognizes the observed client-credentials trap: a token can be minted successfully
yet fail every user data call with `500 unknown_exception`. This is reported as
`token_not_user_bound`, not as a generic transient server error.

## Logging out

```sh
tt auth logout --v1
tt auth logout --session
tt auth logout --all
```

Logout removes only the selected saved credential. Cached account data remains until an explicit
`tt cache clear` operation. Environment credentials cannot be removed by the CLI; unset them in
the calling environment or secret manager.

## Obtaining a v1 token

The preferred setup is the personal API token exposed by TickTick web settings. Copy it directly
to a secure secret file or secret manager, then verify it with `tt auth status --verify`.

Token lifetime is not assumed. Verification, rather than a hard-coded expiry interval, determines
whether the token is still usable.

## Optional OAuth recipe outside the CLI

OAuth is optional and remains outside the CLI. Register your own TickTick application and use its
client ID, client secret, and exact registered redirect URI. Never reuse another application's
client ID.

First, create a high-entropy state value and open this URL in a browser yourself, replacing the
placeholders and URL-encoding parameter values:

```text
https://ticktick.com/oauth/authorize?scope=tasks%3Aread%20tasks%3Awrite&client_id=YOUR_CLIENT_ID&state=YOUR_RANDOM_STATE&redirect_uri=YOUR_REDIRECT_URI&response_type=code
```

Confirm that the callback's `state` is identical to the value you created. Then exchange the
short-lived authorization code using HTTP Basic authentication:

```sh
curl --fail-with-body \
  --user "$TICKTICK_CLIENT_ID:$TICKTICK_CLIENT_SECRET" \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'code=AUTHORIZATION_CODE' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode 'scope=tasks:read tasks:write' \
  --data-urlencode 'redirect_uri=YOUR_REDIRECT_URI' \
  https://ticktick.com/oauth/token
```

Store only the returned user access token for the CLI. Do not use `grant_type=client_credentials`:
although TickTick has been observed to return a token, it is app-bound and cannot access user
data.

## v2 caution

Unofficial v2 access is opt-in, compatibility-dependent, and host-specific. Session credentials
are equivalent to an authenticated web session and must receive the same protection as a
password. Stable help exposes only live-verified operations for the selected host. A v2 command
without an eligible session returns `capability_missing` with exit code 3.
