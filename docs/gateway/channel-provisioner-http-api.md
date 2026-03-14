---
summary: "Manage OpenClaw channel accounts over a small REST API"
read_when:
  - Integrating an external business system that manages channel accounts
  - Letting users bind channels before routing them to agents
title: "Channel Provisioner API"
---

# Channel Provisioner API (HTTP)

The `channel-provisioner` plugin exposes a small REST API for managing OpenClaw channel accounts.

Default base path:

- `http://<gateway-host>:<port>/plugins/channel-provisioner/channels`

Endpoints:

- `GET /plugins/channel-provisioner/channels`
- `GET /plugins/channel-provisioner/channels/status`
- `GET /plugins/channel-provisioner/channels/resolve`
- `POST /plugins/channel-provisioner/channels/:channel/accounts`
- `PUT /plugins/channel-provisioner/channels/:channel/accounts/:accountId`
- `DELETE /plugins/channel-provisioner/channels/:channel/accounts/:accountId`

## Authentication

This plugin uses plugin-managed bearer auth.

Send either:

- `Authorization: Bearer <token>`
- `x-openclaw-channel-provisioner-token: <token>`

The token comes from plugin config `authToken` or `OPENCLAW_CHANNEL_PROVISIONER_TOKEN`.

## Request body

`POST` and `PUT` accept this JSON shape:

```json
{
  "accountId": "default",
  "config": {
    "token": "123:abc",
    "botToken": "xoxb-...",
    "appToken": "xapp-...",
    "webhookUrl": "https://example.com/webhook"
  }
}
```

Notes:

- `accountId` is required for `POST` when you want a non-default account.
- `accountId` comes from the URL on `PUT`.
- `config` is provider-specific. Common fields include `token`, `botToken`, `appToken`, `webhookUrl`, `httpUrl`, `accessToken`, and `password`.

## Responses

Common responses:

- `200` success
- `201` created
- `400` invalid request
- `401` unauthorized
- `404` not found
- `405` method not allowed

## cURL examples

Set common environment variables first:

```bash
export OPENCLAW_BASE_URL='http://127.0.0.1:18789'
export OPENCLAW_CHANNEL_PROVISIONER_TOKEN='your-token'
```

### List channels

```bash
curl -sS "$OPENCLAW_BASE_URL/plugins/channel-provisioner/channels" \
  -H "Authorization: Bearer $OPENCLAW_CHANNEL_PROVISIONER_TOKEN"
```

### Get channel status

```bash
curl -sS "$OPENCLAW_BASE_URL/plugins/channel-provisioner/channels/status" \
  -H "Authorization: Bearer $OPENCLAW_CHANNEL_PROVISIONER_TOKEN"
```

### Resolve names to IDs

```bash
curl -sS "$OPENCLAW_BASE_URL/plugins/channel-provisioner/channels/resolve?channel=slack&q=%23general&q=%40jane" \
  -H "Authorization: Bearer $OPENCLAW_CHANNEL_PROVISIONER_TOKEN"
```

### Create a Telegram account

```bash
curl -sS -X POST "$OPENCLAW_BASE_URL/plugins/channel-provisioner/channels/telegram/accounts" \
  -H "Authorization: Bearer $OPENCLAW_CHANNEL_PROVISIONER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "accountId": "default",
    "config": {
      "token": "123:abc"
    }
  }'
```

### Update a Slack account

```bash
curl -sS -X PUT "$OPENCLAW_BASE_URL/plugins/channel-provisioner/channels/slack/accounts/team-a" \
  -H "Authorization: Bearer $OPENCLAW_CHANNEL_PROVISIONER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "config": {
      "botToken": "xoxb-...",
      "appToken": "xapp-..."
    }
  }'
```

### Delete an account

```bash
curl -sS -X DELETE "$OPENCLAW_BASE_URL/plugins/channel-provisioner/channels/telegram/accounts/default" \
  -H "Authorization: Bearer $OPENCLAW_CHANNEL_PROVISIONER_TOKEN"
```

## Notes

- The route path is configurable in plugin config. The examples above use the default path.
- `GET /channels` and `GET /channels/status` currently return the same snapshot-oriented payload.
- This API manages channel accounts only. Route channel ownership to agents through the agent provisioning API.
