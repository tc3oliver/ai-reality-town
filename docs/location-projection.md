# Location and occupancy projection

World import snapshots contain every validated location definition: identity, name,
description, type, positive capacity, directed connections, active state, and provenance.
Later changes use the typed `location_state_changed` proposal and take effect only through
an Accepted Event.

The deterministic reducer derives sorted occupancy from `characterLocations` before each
event, then updates both views together for every accepted movement. Canon rejects unknown
or inactive destinations, disconnected movement, capacity overflow, unknown connections,
duplicate location changes, occupied-location deactivation, and capacity below occupancy.
Snapshots deep-clone connection and occupancy arrays, so full and snapshot replay agree.
