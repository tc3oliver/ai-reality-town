# Organization and membership projection

World import snapshots contain each validated organization definition with identity, name,
description, type, nullable headquarters, active state, and provenance. Later organization
state changes use `organization_state_changed` and take effect only as Accepted Events.

Accepted character `organization_memberships` changes update the character state and
reverse `organizationMembers` view together, then append added/removed membership history
with reason, Event ID, sequence, world day, and time slot. Canon rejects unknown or inactive
memberships, duplicate IDs, repeated same-event changes, invalid headquarters, and
deactivation while members remain. Snapshot and replay deep-clone all membership arrays.
