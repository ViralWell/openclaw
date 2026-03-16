---
summary: "Sync external agent records into OpenClaw over a small REST API"
read_when:
  - Integrating an external business system that owns agent records
  - Syncing agent identity, model, and channel bindings into OpenClaw
title: "Agent Provisioner API"
---

# Agent Provisioner API (HTTP)

The `agent-provisioner` plugin exposes a small REST API for syncing agents from an external system into OpenClaw.

Default base path:

- `http://<gateway-host>:<port>/plugins/agent-provisioner/agents`

The plugin registers a prefix route, so the full endpoints are:

- `GET /plugins/agent-provisioner/agents`
- `GET /plugins/agent-provisioner/agents/:id`
- `POST /plugins/agent-provisioner/agents`
- `PUT /plugins/agent-provisioner/agents/:id`
- `DELETE /plugins/agent-provisioner/agents/:id`

## Authentication

This plugin uses the current Gateway HTTP auth.

Send the same credentials you use for other Gateway HTTP APIs:

- `Authorization: Bearer <token>`

Auth source:

- token mode: `gateway.auth.token` or `OPENCLAW_GATEWAY_TOKEN`
- password mode: `gateway.auth.password` or `OPENCLAW_GATEWAY_PASSWORD`

See [Gateway Authentication](/gateway/authentication).

## Request body

`POST` and `PUT` accept this JSON body:

```json
{
  "id": "ops-bot",
  "name": "Ops Bot",
  "emoji": "🤖",
  "avatar": "https://example.com/avatar.png",
  "workspace": "~/.openclaw/workspace-ops-bot",
  "agentDir": "~/.openclaw/agents/ops-bot/agent",
  "model": "openai/gpt-5",
  "bindings": ["telegram", "slack:team-a"]
}
```

Fields:

- `id`: required for `POST`; ignored from body on `PUT` because the path `:id` is authoritative.
- `name`: optional display name.
- `emoji`: optional identity emoji.
- `avatar`: optional identity avatar.
- `workspace`: optional workspace override.
- `agentDir`: optional agent state directory override.
- `model`: optional model override.
- `bindings`: optional full binding list for this agent. Each entry uses `channel` or `channel:accountId`.

`PUT` semantics:

- creates the agent if it does not exist
- updates the agent if it already exists
- replaces this agent's route bindings when `bindings` is provided

## Responses

Common responses:

- `200` success
- `201` created
- `400` invalid request
- `401` unauthorized
- `404` agent not found
- `405` method not allowed

Success responses use JSON. Example `POST` or `PUT` response:

```json
{
  "ok": true,
  "created": true,
  "updated": false,
  "agent": {
    "id": "ops-bot",
    "name": "Ops Bot",
    "workspace": "/Users/example/.openclaw/workspace-ops-bot",
    "agentDir": "/Users/example/.openclaw/agents/ops-bot/agent",
    "model": "openai/gpt-5",
    "emoji": "🤖",
    "avatar": "https://example.com/avatar.png",
    "bindings": ["telegram", "slack accountId=team-a"]
  }
}
```

## cURL examples

Set common environment variables first:

```bash
export OPENCLAW_BASE_URL='http://127.0.0.1:18789'
export OPENCLAW_GATEWAY_TOKEN='your-token'
```

### List agents

```bash
curl -sS "$OPENCLAW_BASE_URL/plugins/agent-provisioner/agents" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN"
```

### Get one agent

```bash
curl -sS "$OPENCLAW_BASE_URL/plugins/agent-provisioner/agents/ops-bot" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN"
```

### Create an agent

```bash
curl -sS -X POST "$OPENCLAW_BASE_URL/plugins/agent-provisioner/agents" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "ops-bot",
    "name": "Ops Bot",
    "emoji": "🤖",
    "avatar": "https://example.com/avatar.png",
    "model": "openai/gpt-5",
    "bindings": ["telegram", "slack:team-a"]
  }'
```

### Upsert an agent

```bash
curl -sS -X PUT "$OPENCLAW_BASE_URL/plugins/agent-provisioner/agents/ops-bot" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Ops Bot",
    "emoji": "🤖",
    "model": "openai/gpt-5",
    "bindings": ["telegram", "slack:team-a"]
  }'
```

### Delete an agent

```bash
curl -sS -X DELETE "$OPENCLAW_BASE_URL/plugins/agent-provisioner/agents/ops-bot" \
  -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN"
```

## Notes

- The route path is configurable in plugin config. The examples above use the default path.
- `PUT` is the main sync endpoint when your external system is the source of truth.
- When `bindings` is omitted, the plugin keeps the agent's existing route bindings unchanged.
