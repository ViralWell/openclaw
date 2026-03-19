# Spira Plugin V1 Spec

## Summary

`extensions/spira/` is the first bundled Spira plugin for OpenClaw.

This version focuses on:

- fixed workflow execution
- basic media generation and transformation
- a publish scaffold for future work

This version does **not** include a top-level orchestrator skill yet. The plugin currently provides execution-facing tools plus internal skills that future orchestration layers can rely on.

This document is intentionally written in two layers:

- product and architecture view: why the plugin exists, what role it plays, and what boundaries it enforces
- engineering view: how the code is currently organized, what contracts exist, and how the current test coverage works

## Product and Architecture View

### Product intent

The Spira plugin is meant to expose a small set of reliable business capabilities to OpenClaw agents instead of exposing an open-ended workflow engine.

From the product perspective, the desired user experience is:

- the user describes a content task
- the system routes that task into a fixed workflow or media capability
- the system returns a structured result that can be used by later pipeline steps

In other words, Spira is intended to behave like a capability layer, not like a general-purpose workflow editor.

### Why there is no orchestrator yet

V1 deliberately omits a top-level orchestrator because the current priority is to stabilize the execution substrate first:

- a workflow tool with fixed contracts
- a media tool with provider routing
- a reserved publish boundary
- internal skills that describe correct tool usage

This reduces the number of moving parts while the lower-level contracts are still being shaped.

### User-facing model

The intended long-term user model is:

- users ask for business outcomes
- the system chooses from fixed capabilities
- internal skill and tool boundaries remain mostly hidden

V1 does not fully implement that UX because there is no orchestrator yet, but the current design is already biased toward that future:

- workflow ids are not supposed to be invented by the model
- media provider names are not supposed to become primary user concepts
- publish is represented as a tool boundary, not a collection of platform-specific prompt habits

### Architectural role inside OpenClaw

Within OpenClaw, `extensions/spira/` is a bundled plugin that contributes:

- runtime tools
- internal skills
- plugin configuration

It does not currently own:

- the top-level user conversation flow
- a dedicated UI surface
- a custom channel, route family, or service process

That makes it a focused capability plugin rather than a full vertical subsystem.

## Goals

- Integrate Spira-backed workflow and media capabilities into OpenClaw as a bundled plugin
- Keep the user-facing capability model narrow and structured
- Avoid exposing free-form workflow editing to the model or end users
- Leave a stable extension point for agent-specific workflow filtering
- Keep publish wiring lightweight for now while reserving the final tool boundary

## Non-goals

- No top-level `spira-orchestrator` in v1
- No free-form workflow builder or workflow editor surface
- No full publish platform implementation in v1
- No agent-specific media or publish gating in v1

## Engineering View

### Current code layout

The plugin is intentionally organized by capability domain:

- `index.ts`
- `openclaw.plugin.json`
- `package.json`
- `skills/`
- `src/config.ts`
- `src/shared/`
- `src/workflows/`
- `src/media/`
- `src/publish/`

This keeps workflow, media, and publish logic separate in code even though they are shipped as one plugin.

## Plugin Shape

The plugin lives under `extensions/spira/` and is bundled into the repo.

It currently registers three tools:

- `spira_workflow`
- `spira_media`
- `spira_publish`

It also ships three internal skills:

- `workflow-runner`
- `media-basic`
- `publish-social`

All three skills are marked `user-invocable: false`.

## Design Principles

### 1. Fixed capability catalog

Spira workflows are treated as a fixed capability catalog, not an open-ended workflow composition surface.

The model should:

- choose from predefined workflows
- validate structured inputs
- run workflows through stable tool actions

The model should not:

- invent workflow ids
- invent workflow fields
- treat the backend as a free-form execution engine

### 2. Skill decides, tool executes

The split is intentional:

- skills explain when and how to use a capability
- tools perform validated execution

This keeps prompt guidance thin and keeps contracts enforceable in code.

### 3. One plugin, multiple capability domains

Workflow, media, and publish live in one `spira` plugin because they are part of one product domain and are likely to be used together.

The code is still organized by subdomain:

- `src/workflows/`
- `src/media/`
- `src/publish/`
- `src/shared/`

### 4. Stable tool boundary first, richer orchestration later

The implementation strategy is to stabilize tool contracts before adding a richer top-level planner or orchestrator.

This has two practical consequences:

- internal skills are thin and execution-oriented
- tests focus on contract correctness and prompt-to-skill/tool routing instead of full end-to-end orchestration

### 5. Normalize at the plugin edge

The plugin is responsible for converting backend behavior into OpenClaw-friendly contracts.

Examples:

- workflow catalogs are normalized before filtering and summarization
- media providers are hidden behind one `spira_media` tool
- HTTP failures are translated into clearer tool-facing errors

This keeps backend variation out of the prompt layer as much as possible.

## Workflow Capability

### Tool

`spira_workflow` exposes four actions:

- `list`
- `describe`
- `run`
- `status`

### Expected behavior

- `list(context, agentId?)`
  returns the current shortlist of workflows after context filtering and agent filtering
- `describe(workflowId, agentId?)`
  returns the detailed workflow contract for an allowed workflow
- `run(workflowId, inputs, agentId?)`
  validates inputs and starts a workflow run
- `status(runId)`
  reads current run state from the backend

### Catalog model

The OpenClaw side keeps a normalized workflow catalog entry with:

- `id`
- `title`
- `summary`
- `requiredInputs`
- `inputSchema`
- `outputSchema`
- `attributes`
- `enabled`
- `version`

The backend remains the source of truth for real workflow behavior and schemas. OpenClaw mainly normalizes, filters, validates, and executes against that source.

### Agent filtering

V1 keeps a local filtering hook in `src/workflows/policy.ts`.

Current behavior:

- default allow-all
- filtering point exists in `list`, `describe`, and `run`

Expected future behavior:

- use agent-specific requirements to constrain which workflows are visible or runnable
- support attribute-based filtering instead of only workflow-id blocklists

### Engineering notes

Workflow execution currently spans these modules:

- `src/workflows/catalog.ts`
- `src/workflows/client.ts`
- `src/workflows/policy.ts`
- `src/workflows/tool.ts`
- `src/workflows/validation.ts`

Responsibility split:

- `catalog.ts` handles normalized workflow shape and context filtering
- `client.ts` talks to the backend
- `policy.ts` provides the agent-aware filtering seam
- `tool.ts` exposes the public tool contract
- `validation.ts` enforces input constraints before remote execution

## Media Capability

### Tool

`spira_media` currently exposes:

- `text_to_image`
- `image_to_video`
- `video_frames`
- `caption_video`

### Expected behavior

- expose one media capability surface to the model
- hide backend selection by default
- select a provider internally
- return a normalized result shape

### Provider routing

V1 allows two backends:

- Spira workflow mappings
- `viral-well-tools`

The default routing strategy is:

1. respect explicit provider override if provided
2. otherwise use configured provider order
3. fall back when the preferred provider is unsupported or errors

### Engineering notes

Media execution currently spans:

- `src/media/types.ts`
- `src/media/router.ts`
- `src/media/tool.ts`

Responsibility split:

- `types.ts` defines the stable media action vocabulary
- `router.ts` chooses and executes providers
- `tool.ts` validates and forwards the model-facing request

The current routing model is intentionally simple and can be tightened later without changing the external tool name.

## Publish Capability

### Tool

`spira_publish` currently exposes:

- `publish_now`
- `schedule`
- `status`

### Current status

This is a scaffold only.

The v1 goal is to reserve:

- the tool name
- action structure
- future integration boundary

The implementation intentionally returns a clear `not_implemented` result instead of pretending to support full publish behavior.

### Engineering notes

`src/publish/tool.ts` exists mainly to reserve the final tool boundary and action vocabulary. It is intentionally thin and should remain honest about its current implementation status.

## Skills

### `workflow-runner`

Purpose:

- guide the model to use `spira_workflow`
- emphasize `list` before `describe` or `run`
- forward `agentId`
- avoid bypassing workflow filtering

### `media-basic`

Purpose:

- guide the model to use `spira_media`
- map user intent to a media action
- keep backend names out of normal prompting

### `publish-social`

Purpose:

- establish the future publish tool boundary
- keep behavior intentionally thin in v1

### Skill design notes

All three skills are internal and marked `user-invocable: false` because they are meant to support future orchestration rather than act as direct user commands.

At the moment they primarily serve two purposes:

- give the model stable usage guidance for each tool
- keep domain-specific instructions out of generic system prompt text

## Testing Strategy

V1 uses three layers of coverage:

### 1. Unit tests for workflow and media tools

Examples:

- workflow context filtering
- workflow validation failures
- media provider fallback
- HTTP error handling

### 2. Config-state coverage

The plugin is bundled-enabled by default, and this is covered in plugin config tests.

### 3. Prompt-routing integration test

`src/agents/spira-skills.integration.test.ts` covers an agent-side integration path:

- build skills prompt from the bundled plugin skills
- inject the skills prompt into the system prompt
- parse available skill entries from the prompt
- select the best matching skill for a representative user prompt
- read the selected `SKILL.md`
- infer the intended tool
- execute the real tool against a mocked backend

Current representative prompts:

- workflow-style prompt:
  `Use a fixed workflow to create a TikTok product brief about AI founder tips for startup operators.`
- media-style prompt:
  `Generate a clean cover image for a TikTok post about AI founder tips and make it look polished.`

This is not a full gateway e2e, but it is stronger than a simple unit test because it validates the actual skill-prompt and skill-selection shape used by the agent runtime.

### What the integration test is actually proving

The current integration test is intended to validate this chain:

1. bundled plugin skills are loaded into the runtime prompt
2. the system prompt exposes the expected available skill entries
3. a representative prompt maps to the correct skill
4. the selected skill points to the expected tool
5. the real tool executes successfully against a mocked backend

This is still not a full live model loop, but it covers the important boundary between prompt-space skill availability and executable tool behavior.

## Current Limitations

- No top-level orchestrator flow
- No real publish implementation
- No full model-loop or gateway-level end-to-end test yet
- Agent filtering is still a local default-allow hook
- Media result normalization is intentionally lightweight in v1

## Next Steps

Recommended follow-up work:

1. Add a top-level orchestrator capability that dominates the UX flow
2. Expand workflow filtering to use real agent requirements and workflow attributes
3. Tighten workflow contract handling around backend response shapes
4. Extend media coverage to more provider-specific actions and richer outputs
5. Flesh out `spira_publish`
6. Add a fuller mocked model-loop test once the orchestration layer stabilizes

## Recommended Reader Paths

If the reader is thinking about product direction first, read in this order:

1. Summary
2. Product and Architecture View
3. Goals and Non-goals
4. Current Limitations
5. Next Steps

If the reader is implementing or refactoring code, read in this order:

1. Engineering View
2. Plugin Shape
3. Workflow Capability
4. Media Capability
5. Publish Capability
6. Skills
7. Testing Strategy
