---
name: publish-social
description: Publish or schedule content through the spira_publish tool.
user-invocable: false
---

# Publish Social

Use `spira_publish` for:

- immediate publish
- scheduled publish
- checking publish status

Rules:

- Treat this skill as a thin wrapper over the publish tool.
- Pass `agentId` when available.
- Keep behavior minimal in v1 and avoid inventing platform-specific logic in the skill.
