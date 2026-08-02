# Story Arc portfolio controls

The Story portfolio is deterministic and admits no more than three active-family major
arcs, six active-family minor arcs, six core characters per major arc, or two major-arc
memberships for one Accepted Event. Emerging, Resolved, and Archived arcs do not consume
active capacity.

Overflow must produce one explicit decision: reject the candidate, downgrade a major arc
when minor capacity remains, or merge it into a valid active-family target. Every result
retains the candidate's source Event IDs; portfolio control never deletes or rewrites Canon.

The homepage selector considers published active-family arcs only and returns one safe
summary. Major tier precedes minor tier, then numeric priority, heat, latest world day, and
stable Arc ID determine ordering. No LLM selects homepage priority.
