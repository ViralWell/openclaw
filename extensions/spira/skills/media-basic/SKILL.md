---
name: media-basic
description: Handle basic image and video generation or transformation tasks through the spira_media tool.
user-invocable: false
---

# Media Basic

Use `spira_media` for:

- text to image
- image to video
- video frame extraction
- captioning and other basic media transforms

Rules:

- Map user intent to a media action, not a backend name.
- Pass `agentId` when available.
- Ask only for the smallest missing input set.
- Return normalized media outputs from the tool result.
