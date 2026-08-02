# Story Arc event classification

The Story layer classifies only Accepted Events. A versioned classification can attach one
event to at most six arcs and mark at most two as primary. Each membership records an
importance score, one of seven narrative roles, and explicit core-character changes.

A new arc is created atomically with its emerging lifecycle and complete projection only
when its membership is an `inciting_incident` with importance of at least 0.6. Title,
premise, current question, and valid core characters are mandatory. Low-importance events
may advance an existing arc but cannot create one. Classification is idempotent by Accepted
Event and available only through internal Story functions.
