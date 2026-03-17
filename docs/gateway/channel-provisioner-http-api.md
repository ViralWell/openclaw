---
summary: "Manage OpenClaw channel accounts over a small REST API"
read_when:
  - Integrating an external business system that manages channel accounts
  - Letting users bind channels before routing them to agents
title: "Channel Provisioner API"
---

# Channel Provisioner API (HTTP)

The bundled `channel-provisioner` plugin exposes a small REST API for managing OpenClaw channel accounts.

This plugin is bundled and enabled by default.

Default base path:

- `http://<gateway-host>:<port>/plugins/channel-provisioner/channels`

Endpoints:

- `GET /plugins/channel-provisioner/channels`
- `GET /plugins/channel-provisioner/channels/status`
- `GET /plugins/channel-provisioner/channels/resolve`
- `POST /plugins/channel-provisioner/channels/accounts`
- `PUT /plugins/channel-provisioner/channels/accounts/:accountId`
- `DELETE /plugins/channel-provisioner/channels/accounts/:accountId?channel=<channel>`

## Authentication

This plugin uses the current Gateway HTTP auth.

Send the same credentials you use for other Gateway HTTP APIs:

- `Authorization: Bearer <token>`

Auth source:

- token mode: `gateway.auth.token` or `OPENCLAW_GATEWAY_TOKEN`
- password mode: `gateway.auth.password` or `OPENCLAW_GATEWAY_PASSWORD`

See [Gateway Authentication](/gateway/authentication).

## Behavior

- `POST /channels/accounts` creates an account and returns `201`.
- `PUT /channels/accounts/:accountId` is an upsert. It returns `201` when the account did not exist yet, or `200` when it updated an existing account.
- `DELETE /channels/accounts/:accountId` removes the account from config.
- `GET /channels` and `GET /channels/status` currently return the same snapshot-oriented payload.
- `channel` is mandatory for account mutation requests and must be sent explicitly.

## Request body

`POST` and `PUT` accept this JSON shape:

```json
{
  "channel": "telegram",
  "accountId": "default",
  "config": {
    "token": "123:abc",
    "botToken": "xoxb-...",
    "appToken": "xapp-...",
    "dmPolicy": "open",
    "webhookUrl": "https://example.com/webhook"
  }
}
```

Notes:

- `channel` is required on `POST` and `PUT`, and required as a query parameter on `DELETE`.
- `accountId` is optional for `POST`. When omitted, the plugin uses the channel's default account id.
- `accountId` comes from the URL on `PUT` and `DELETE`.
- `channel` for `DELETE` is sent as a query parameter.
- `config` is provider-specific. The plugin currently recognizes fields such as `dmPolicy`, `token`, `tokenFile`, `botToken`, `appToken`, `signalNumber`, `cliPath`, `dbPath`, `service`, `region`, `authDir`, `httpUrl`, `httpHost`, `httpPort`, `webhookPath`, `webhookUrl`, `audienceType`, `audience`, `useEnv`, `homeserver`, `userId`, `accessToken`, `password`, `deviceName`, `initialSyncLimit`, `ship`, `url`, `code`, `groupChannels`, `dmAllowlist`, and `autoDiscoverChannels`.
- `POST` defaults `config.dmPolicy` to `open` when omitted, so newly provisioned channel bindings do not start in pairing mode by default.
- `PUT` leaves the existing DM policy unchanged unless `config.dmPolicy` is explicitly provided.

## Resolve endpoint

`GET /plugins/channel-provisioner/channels/resolve` resolves user or group names into channel-native ids for channels that implement a resolver.

Supported query parameters:

- `channel`: required channel id such as `slack` or `discord`
- `account`: optional account id for multi-account channels
- `q`, `entry`, or repeated `entries`: one or more values to resolve
- `kind`: optional `auto`, `user`, or `group`

When `kind=auto` or omitted, the plugin infers whether each value looks like a user or group target before resolving it.

## Responses

Common responses:

- `200` success
- `201` created
- `400` invalid request
- `401` unauthorized
- `404` not found
- `405` method not allowed
- `GET /channels` and `GET /channels/status` return `{ ok: true, channels: [...] }`
- `GET /channels/resolve` returns `{ ok: true, results: [...] }`
- `POST` and `PUT` return `{ ok: true, created, updated, account: {...} }`
- `DELETE` returns `{ ok: true, deleted: true, channel: "<channel>", accountId: "<accountId>" }`

## cURL examples

Set common environment variables first:

```bash
export OPENCLAW_BASE_URL='http://127.0.0.1:18789'
export OPENCLAW_GATEWAY_TOKEN='your-token'
```

### List channels

```bash
curl -sS "$OPENCLAW_BASE_URL/plugins/channel-provisioner/channels" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN"
```

### Get channel status

```bash
curl -sS "$OPENCLAW_BASE_URL/plugins/channel-provisioner/channels/status" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN"
```

### Resolve names to IDs

```bash
curl -sS "$OPENCLAW_BASE_URL/plugins/channel-provisioner/channels/resolve?channel=slack&account=team-a&kind=auto&q=%23general&q=%40jane" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN"
```

### Create a channel account

```bash
curl -sS -X POST "$OPENCLAW_BASE_URL/plugins/channel-provisioner/channels/accounts" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": "telegram",
    "accountId": "default",
    "config": {
      "token": "123:abc"
    }
  }'
```

### Update a channel account

```bash
curl -sS -X PUT "$OPENCLAW_BASE_URL/plugins/channel-provisioner/channels/accounts/team-a" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "channel": "slack",
    "config": {
      "botToken": "xoxb-...",
      "appToken": "xapp-..."
    }
  }'
```

### Delete an account

```bash
curl -sS -X DELETE "$OPENCLAW_BASE_URL/plugins/channel-provisioner/channels/accounts/default?channel=telegram" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN"
```

## Notes

- This API manages channel accounts only. Route channel ownership to agents through the agent provisioning API.
- Some channels do not implement account upsert, delete, or resolve. In those cases the plugin returns `400` with a descriptive error.
- Telegram account token changes also reset the stored update offset so polling restarts cleanly on the next run.
