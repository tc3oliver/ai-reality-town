# Pre-generation safety

Every world, prompt, and retrieved context fragment must pass the versioned FR-L001
pre-generation gate before a generative provider is called. Allowed requests also carry
a non-user-editable provider safety instruction. Rejected requests throw a structured
`PreGenerationSafetyError` containing a stable category and reason, but never echo the
sensitive source text.

Version 1 blocks sexual content involving minors, explicit sexual content, hate or
dehumanization, extreme violence detail, self-harm encouragement, real-person
impersonation, personal data, and instructions facilitating real-world crime. The gate
permits non-explicit adult relationships, non-graphic consequences, recovery/help
narratives, and fictional wrongdoing that provides no actionable instruction.

The deterministic rules are a minimum local control, not a claim that keyword matching
can classify every paraphrase. Provider policies and post-generation classification
remain mandatory defense layers. Additions must preserve stable codes, avoid logging
matched source text, test both prohibited and allowed boundaries, and keep the provider
callback behind `callWithPreGenerationSafety`.
