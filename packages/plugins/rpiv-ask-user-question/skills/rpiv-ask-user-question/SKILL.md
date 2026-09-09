---
name: rpiv-ask-user-question
description: Ask the user structured clarification questions through the rpiv.ask-user-question run_code plugin method.
---

# Ask User Question

Use this skill when work cannot proceed safely without a concrete user preference, requirement, or implementation decision.

## Calling the plugin

Call the generation-scoped plugin method through `run_code`:

```ts
return await plugin["rpiv.ask-user-question"].ask_user_question({
  questions: [
    {
      question: "Which implementation should we use?",
      header: "Approach",
      options: [
        {
          label: "Minimal change (Recommended)",
          description: "Keep the current architecture and change only the affected path."
        },
        {
          label: "Refactor first",
          description: "Restructure the surrounding code before implementing the feature."
        }
      ]
    }
  ]
});
```

The call pauses until the user submits or cancels the questionnaire. Return or inspect the method's `text` result before continuing.

## Questionnaire rules

1. Ask one to four questions in one call. Group related decisions instead of making back-to-back calls.
2. Give every question a short `header` of at most 16 characters.
3. Provide two to four distinct options. Every option needs a concise `label` and a useful `description`.
4. Do not author options named `Other`, `Type something.`, or `Next`; the UI owns those reserved rows.
5. Set `multiSelect: true` only when several options may be selected together.
6. Put a recommended choice first and suffix its label with `(Recommended)`.
7. Use `preview` only when a side-by-side artifact materially helps the decision, such as a layout, code sample, diagram, or configuration. Do not use previews for ordinary preference questions or multi-select questions.
8. Treat cancellation or a validation error as a user-facing outcome. Do not invent an answer.

## API reference

Read [references/api.md](references/api.md) for the exact method arguments, limits, result envelope, and failure behavior.
