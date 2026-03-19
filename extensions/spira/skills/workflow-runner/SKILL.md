---
name: workflow-runner
description: Run fixed Spira workflows by listing candidates, checking contracts, collecting missing inputs, and calling the spira_workflow tool.
user-invocable: false
---

# Workflow Runner

Use `spira_workflow` for fixed workflow execution.

Rules:

- Never guess a workflow id directly.
- Always call `list` first unless the workflow is already certain.
- Pass `agentId` whenever current agent context is available.
- If multiple workflows match, inspect candidates with `describe`.
- Before `run`, collect only missing required inputs.
- If a workflow is filtered out for this agent, do not bypass that restriction.
