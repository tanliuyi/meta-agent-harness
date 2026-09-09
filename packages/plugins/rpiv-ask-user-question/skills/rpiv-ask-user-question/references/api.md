# Ask User Question plugin API

Canonical plugin ID: `rpiv.ask-user-question`

## ask_user_question

Present one structured questionnaire and wait for the user's response.

```ts
const result = await plugin["rpiv.ask-user-question"].ask_user_question({
  questions: [
    {
      question: "Which library should we use?",
      header: "Library",
      options: [
        { label: "Existing library (Recommended)", description: "Reuse the dependency already in the project." },
        { label: "New library", description: "Add a new dependency with the required feature set." }
      ],
      multiSelect: false
    }
  ]
});
```

### Arguments

- `questions`: required array containing 1-4 questions
- `questions[].question`: required full question text
- `questions[].header`: required short label, maximum 16 characters
- `questions[].options`: required array containing 2-4 options
- `questions[].options[].label`: required concise label, maximum 60 characters
- `questions[].options[].description`: required explanation of the option and its trade-offs
- `questions[].options[].preview`: optional markdown shown beside single-select options
- `questions[].multiSelect`: optional boolean; set to `true` when multiple choices may be selected

The option labels `Other`, `Type something.`, and `Next` are reserved and rejected. The UI appends its own custom-answer row to every question.

### Preview example

```ts
return await plugin["rpiv.ask-user-question"].ask_user_question({
  questions: [
    {
      question: "Which layout should we implement?",
      header: "Layout",
      options: [
        {
          label: "Sidebar (Recommended)",
          description: "Keep navigation visible beside the main content.",
          preview: "```text\n| Nav | Content |\n|     |         |\n```"
        },
        {
          label: "Top navigation",
          description: "Use the full page width below a horizontal header.",
          preview: "```text\n| Navigation    |\n| Content       |\n```"
        }
      ]
    }
  ]
});
```

### Result

The run_code method returns:

- `text`: the user-answer envelope, `User declined to answer questions`, or a validation/UI error message

On success, `text` includes each answered question and the selected label or custom response. The method is serial and remains pending while Desktop waits for user input. Cancellation is returned as text rather than guessed around. Runtime failures may throw and are reported by `run_code` with the plugin ID and method name.
