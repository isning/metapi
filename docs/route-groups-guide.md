# Route Groups

Route Groups are the operational editor for graph-native routing. They manage
candidate materialization, ordered fallback stages, visibility, filters, and
dispatcher policy references through a command/read facade over Source Graph.
There are no Route Group side tables or parallel source of truth. Saving a
Route Group publishes the updated Source Graph and its compiled runtime; the
proxy executes only that compiled artifact.

## Management Provenance

Automatic groups are created from upstream model discovery. Manual groups are
created by an operator. This distinction affects editing permissions and
discovery lifecycle only.

Both kinds are projections of the same graph shape:

```text
route_product endpoint
  + candidate_selector macro
  + ordered fallback stages
  + supply endpoints or route-product members
```

The compiled graph and proxy have no automatic/manual branch.

## Source Selection

A manual Route Group has one source-selection mode. The management API uses a
discriminated `sourceSelection` object; the two modes cannot be combined.

| Mode          | Graph representation                    | Use case                                                                             |
| ------------- | --------------------------------------- | ------------------------------------------------------------------------------------ |
| Explicit      | `route_endpoints` or `graph_references` | Select concrete execution endpoints or another Route Group                           |
| Model pattern | `model_pattern`                         | Resolve the currently available supply endpoints by exact, glob, or `re:` regex rule |

Examples:

```json
{ "kind": "explicit", "sources": [{ "kind": "execution_target", "sourceRef": "67d54dd0-45c8-4d98-b7b9-7ac550192ec7" }] }
```

```json
{ "kind": "model_pattern", "pattern": "re:^deepseek-v[34]-flash$" }
```

Pattern sources are compiled from the Source Graph. The browser preview is
informational; it does not persist a client-computed endpoint list. A generated
pattern stage cannot accept explicit candidate mutations. Switch the Route
Group to explicit source mode, or add and edit primitive Graph stages when the
route requires mixed resolver behavior.

## Fallback Stages

A group starts with one stage. Add stages when the route needs an explicit
primary/backup chain.

```text
Primary
  - Supply A
  - Supply B

Backup
  - Supply C

Unavailable
  - Synthetic 503
```

Stage order is the fallback order. Dragging a candidate within a stage changes
that stage's member order. Dragging it to another stage changes its fallback
assignment. These operations write `stageId` and `sortOrder`; no priority value
is inferred or stored.

## Selection Within A Stage

Each stage may inherit the group policy or override it with another native
dispatcher policy.

| Policy                | Behavior                                                          |
| --------------------- | ----------------------------------------------------------------- |
| Inherit default       | Use the platform default policy                                   |
| Registry policy       | Reference a named policy from Settings                            |
| Built-in weighted     | Choose by member weight                                           |
| Built-in round robin  | Rotate eligible members                                           |
| Built-in stable first | Prefer the earliest eligible member                               |
| Inline CEL policy     | Evaluate the stage-local members against request/runtime metadata |

Weights only apply inside the stage currently being evaluated. They do not
define the fallback order.

## Candidate Types

| Candidate          | Meaning                                                         |
| ------------------ | --------------------------------------------------------------- |
| Supply endpoint    | A concrete upstream model, account, credential, and API surface |
| Route product      | Another reusable graph route result                             |
| Synthetic response | A configured terminal such as an unavailable response           |

Avoid adding a supply endpoint directly and through a route product in the
same stage unless the duplicate execution path is intentional.

## Visibility And Overrides

Automatic groups keep their discovered model identity. Operators can still
override their enabled state, public/internal visibility, display icon,
filters, and dispatcher policy. Manual groups additionally own their display
name and graph composition.

An override is management configuration. The generated graph contains generic
endpoint, macro, and stage data, not an automatic/manual marker.

## Filters

Group filters are request transformations scoped to that group. Common uses:

- rewrite an exposed model to the upstream model;
- set a payload default or override;
- remove unsupported payload fields;
- set or remove a header;
- prefer a compatible API surface.

Use a separate graph `filter` node only when the transformation is intentionally
shared across multiple graph paths.

## Safe Operations

| Operation                              | Result                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Disable group                          | Its macro no longer contributes an executable public path                                                  |
| Disable candidate                      | Keeps the candidate but removes it from eligibility                                                        |
| Move candidate                         | Changes its stage and/or stage-local order                                                                 |
| Restore candidate automatic management | Returns one generated candidate to the generated primary stage and resets its weight and enabled state     |
| Restore all automatic management       | Resets every adjusted generated candidate and removes the custom fallback stages from that automatic group |
| Delete candidate                       | Removes the management binding from the group                                                              |
| Clear endpoint failure state           | Clears the runtime failure overlay for that endpoint                                                       |
| Add stage                              | Adds a later fallback stage                                                                                |
| Disable stage                          | Skips all candidates in that stage                                                                         |

After a Route Group mutation, Metapi publishes a new Source Graph version and
compiled runtime artifact in the same control-plane operation. Validation
failures are returned as graph diagnostics rather than silently falling back
to an older routing model.

Automatic-management restore is available only for automatic groups. Manual
groups are operator-owned by definition and do not display the adjusted badge.
After restoration, later discovery rebuilds continue to manage the restored
candidate from generated defaults; they preserve only candidates that remain
explicitly marked as adjusted.
