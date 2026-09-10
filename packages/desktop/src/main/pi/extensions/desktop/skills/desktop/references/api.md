# desktop API

These schemas are generated from the plugin's registered Pi tools.

## cdp_events

Read up to 100 buffered Desktop CDP events after a cursor. Buffer retains 200 events, each at most 8 KiB. Enable desired domains with cdp_send first. Reports dropped events.

```json
{
  "parameters": {
    "type": "object",
    "properties": {
      "windowId": {
        "type": "integer",
        "minimum": 1
      },
      "after": {
        "type": "integer",
        "minimum": 0
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 100
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## cdp_send

Send a CDP command to the Desktop renderer through Electron debugger. Target/Browser domains and external navigation are forbidden; no remote debugging port is opened.

```json
{
  "parameters": {
    "type": "object",
    "required": [
      "method"
    ],
    "properties": {
      "windowId": {
        "type": "integer",
        "minimum": 1
      },
      "method": {
        "type": "string",
        "pattern": "^[A-Za-z]+\\.[A-Za-z]+$",
        "maxLength": 128
      },
      "paramsJson": {
        "type": "string",
        "maxLength": 32768,
        "description": "JSON object containing CDP parameters; defaults to {}"
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## evaluate

Evaluate JavaScript in the Desktop renderer, await its promise and return a value. Has access to Desktop UI data and can cause side effects.

```json
{
  "parameters": {
    "type": "object",
    "required": [
      "expression"
    ],
    "properties": {
      "windowId": {
        "type": "integer",
        "minimum": 1
      },
      "expression": {
        "type": "string",
        "minLength": 1,
        "maxLength": 32768
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## get_main_agent

Read one complete profile, or a byte-bounded serialized JSON chunk when large. Join chunk strings until nextOffset=null, then JSON.parse. Offset counts UTF-16 code units. Pass expectedRevision on subsequent reads; conflict returns the new store revision.

```json
{
  "parameters": {
    "type": "object",
    "required": [
      "id"
    ],
    "properties": {
      "id": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "offset": {
        "type": "integer",
        "minimum": 0
      },
      "expectedRevision": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## get_settings

Read Desktop message display/profile settings and their revision (not provider credentials).

```json
{
  "parameters": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## inspect

Inspect the Desktop runtime version, platform and main application window. Does not inspect browser guest tabs.

```json
{
  "parameters": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## load_local_plugin

Open the existing host file/directory approval dialog at path, then approve the user's selected local extension. Requires Developer Mode. Returns persisted approval; schedule reload separately.

```json
{
  "parameters": {
    "type": "object",
    "required": [
      "requestId",
      "expectedRevision",
      "path"
    ],
    "properties": {
      "requestId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "expectedRevision": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "path": {
        "type": "string",
        "minLength": 1,
        "maxLength": 4096
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## main_agents

List bounded main-agent profile summaries/default, store revision, tool/plugin catalog and configuration schema. Use nextOffset for more summaries and get_main_agent for complete profiles.

```json
{
  "parameters": {
    "type": "object",
    "properties": {
      "offset": {
        "type": "integer",
        "minimum": 0
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 20
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## navigate

Navigate the Desktop SPA to a listed route or /projects/{projectId}/session/{threadId}. Returns observed router state; refuses dirty settings editors.

```json
{
  "parameters": {
    "type": "object",
    "required": [
      "path"
    ],
    "properties": {
      "windowId": {
        "type": "integer",
        "minimum": 1
      },
      "path": {
        "type": "string",
        "minLength": 1,
        "maxLength": 2048
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## navigation_state

Read the Desktop SPA router location and loading state.

```json
{
  "parameters": {
    "type": "object",
    "properties": {
      "windowId": {
        "type": "integer",
        "minimum": 1
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## plugin_configuration

Read validated plugin configuration schema, non-secret values and secret-presence flags. Use development:<id> for local approvals or canonical marketplace ID.

```json
{
  "parameters": {
    "type": "object",
    "required": [
      "pluginId"
    ],
    "properties": {
      "pluginId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## plugin_runtime

Inspect actual loaded extensions, captured methods/catalog, native tools, skills and diagnostics of the calling worker. Optional pluginId filters method details. Does not return secret config.

```json
{
  "parameters": {
    "type": "object",
    "properties": {
      "pluginId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## plugins

Read persisted extension approvals/Developer Mode and current worker generation, reloadRequired and diagnostics. Persisted settings do not prove loaded state.

```json
{
  "parameters": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## reload_plugins

Schedule a reload of the calling worker after the agent has settled, commands completed and metadata persisted. Returns scheduled, never applied. Optional continuation prompts the reloaded agent to verify runtime; end this turn to reach the safe point.

```json
{
  "parameters": {
    "type": "object",
    "required": [
      "requestId"
    ],
    "properties": {
      "requestId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "continuation": {
        "type": "string",
        "minLength": 1,
        "maxLength": 2000
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## reload_status

Read a reload request's scheduled/applying/applied/failed status and worker generation. Requests are retained for the application lifetime (bounded history).

```json
{
  "parameters": {
    "type": "object",
    "required": [
      "requestId"
    ],
    "properties": {
      "requestId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## save_main_agent

Create/update a main-agent profile or set the default through the main-agent configuration service. Uses expectedRevision. Returns bounded saved status, store revision and affected profile identity; conflict returns status and current store revision. Configuration applies to new sessions.

```json
{
  "parameters": {
    "type": "object",
    "required": [
      "mutation"
    ],
    "properties": {
      "mutation": {
        "anyOf": [
          {
            "type": "object",
            "required": [
              "action",
              "expectedRevision",
              "profile"
            ],
            "properties": {
              "action": {
                "type": "string",
                "const": "create"
              },
              "expectedRevision": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              },
              "profile": {
                "type": "object",
                "required": [
                  "name",
                  "description",
                  "configuration"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 80
                  },
                  "description": {
                    "type": "string",
                    "maxLength": 500
                  },
                  "configuration": {
                    "type": "object",
                    "required": [
                      "prompt",
                      "tools",
                      "builtinPluginIds"
                    ],
                    "properties": {
                      "prompt": {
                        "type": "object",
                        "required": [
                          "mode",
                          "text",
                          "includeGlobalRules",
                          "includeProjectRules",
                          "includeSkills"
                        ],
                        "properties": {
                          "mode": {
                            "anyOf": [
                              {
                                "type": "string",
                                "const": "default"
                              },
                              {
                                "type": "string",
                                "const": "append"
                              },
                              {
                                "type": "string",
                                "const": "replace"
                              }
                            ]
                          },
                          "text": {
                            "type": "string",
                            "maxLength": 32768
                          },
                          "includeGlobalRules": {
                            "type": "boolean"
                          },
                          "includeProjectRules": {
                            "type": "boolean"
                          },
                          "includeSkills": {
                            "type": "boolean"
                          }
                        },
                        "additionalProperties": false
                      },
                      "tools": {
                        "anyOf": [
                          {
                            "type": "null"
                          },
                          {
                            "type": "array",
                            "items": {
                              "type": "string",
                              "minLength": 1,
                              "maxLength": 200
                            },
                            "maxItems": 64,
                            "uniqueItems": true
                          }
                        ]
                      },
                      "builtinPluginIds": {
                        "anyOf": [
                          {
                            "type": "null"
                          },
                          {
                            "type": "array",
                            "items": {
                              "type": "string",
                              "minLength": 1,
                              "maxLength": 200
                            },
                            "maxItems": 64,
                            "uniqueItems": true
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          },
          {
            "type": "object",
            "required": [
              "action",
              "expectedRevision",
              "profile"
            ],
            "properties": {
              "action": {
                "type": "string",
                "const": "update"
              },
              "expectedRevision": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              },
              "profile": {
                "type": "object",
                "required": [
                  "name",
                  "description",
                  "configuration",
                  "id",
                  "revision",
                  "builtin"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 80
                  },
                  "description": {
                    "type": "string",
                    "maxLength": 500
                  },
                  "configuration": {
                    "type": "object",
                    "required": [
                      "prompt",
                      "tools",
                      "builtinPluginIds"
                    ],
                    "properties": {
                      "prompt": {
                        "type": "object",
                        "required": [
                          "mode",
                          "text",
                          "includeGlobalRules",
                          "includeProjectRules",
                          "includeSkills"
                        ],
                        "properties": {
                          "mode": {
                            "anyOf": [
                              {
                                "type": "string",
                                "const": "default"
                              },
                              {
                                "type": "string",
                                "const": "append"
                              },
                              {
                                "type": "string",
                                "const": "replace"
                              }
                            ]
                          },
                          "text": {
                            "type": "string",
                            "maxLength": 32768
                          },
                          "includeGlobalRules": {
                            "type": "boolean"
                          },
                          "includeProjectRules": {
                            "type": "boolean"
                          },
                          "includeSkills": {
                            "type": "boolean"
                          }
                        },
                        "additionalProperties": false
                      },
                      "tools": {
                        "anyOf": [
                          {
                            "type": "null"
                          },
                          {
                            "type": "array",
                            "items": {
                              "type": "string",
                              "minLength": 1,
                              "maxLength": 200
                            },
                            "maxItems": 64,
                            "uniqueItems": true
                          }
                        ]
                      },
                      "builtinPluginIds": {
                        "anyOf": [
                          {
                            "type": "null"
                          },
                          {
                            "type": "array",
                            "items": {
                              "type": "string",
                              "minLength": 1,
                              "maxLength": 200
                            },
                            "maxItems": 64,
                            "uniqueItems": true
                          }
                        ]
                      }
                    },
                    "additionalProperties": false
                  },
                  "id": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 200
                  },
                  "revision": {
                    "type": "integer",
                    "minimum": 1
                  },
                  "builtin": {
                    "type": "boolean"
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          },
          {
            "type": "object",
            "required": [
              "action",
              "expectedRevision",
              "id"
            ],
            "properties": {
              "action": {
                "type": "string",
                "const": "set-default"
              },
              "expectedRevision": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              },
              "id": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            },
            "additionalProperties": false
          }
        ]
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## save_plugin_configuration

Validate/save plugin configuration through the existing service. valuesJson contains non-secret scalars; optional secretValuesJson contains secret strings encrypted by the host. Return invalid/conflict/saved, then schedule reload to apply.

```json
{
  "parameters": {
    "type": "object",
    "required": [
      "requestId",
      "expectedRevision",
      "pluginId",
      "valuesJson"
    ],
    "properties": {
      "requestId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "expectedRevision": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "pluginId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "valuesJson": {
        "type": "string",
        "maxLength": 32768
      },
      "secretValuesJson": {
        "type": "string",
        "maxLength": 32768
      },
      "clearSecrets": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "maxItems": 64,
        "uniqueItems": true
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## screenshot

Capture the Desktop renderer viewport as a PNG data URL. Returns an error when the image exceeds 4 MiB.

```json
{
  "parameters": {
    "type": "object",
    "properties": {
      "windowId": {
        "type": "integer",
        "minimum": 1
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## set_developer_mode

Enable/disable Developer Mode; persists through existing extension settings service.

```json
{
  "parameters": {
    "type": "object",
    "required": [
      "requestId",
      "expectedRevision",
      "enabled"
    ],
    "properties": {
      "requestId": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "expectedRevision": {
        "type": "string",
        "minLength": 1,
        "maxLength": 200
      },
      "enabled": {
        "type": "boolean"
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## update_settings

Patch Desktop settings using the revision returned by get_settings. Returns saved or conflict; uses the existing settings service.

```json
{
  "parameters": {
    "type": "object",
    "required": [
      "expectedRevision",
      "patch"
    ],
    "properties": {
      "expectedRevision": {
        "type": "string",
        "minLength": 1,
        "maxLength": 128
      },
      "patch": {
        "type": "object",
        "properties": {
          "showThinking": {
            "type": "boolean"
          },
          "autoExpandRunning": {
            "type": "boolean"
          },
          "showAvatars": {
            "type": "boolean"
          },
          "messageWidth": {
            "anyOf": [
              {
                "type": "number"
              },
              {
                "type": "null"
              }
            ]
          },
          "userName": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "userAvatarPath": {
            "anyOf": [
              {
                "type": "string",
                "maxLength": 4096
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "additionalProperties": false,
        "minProperties": 1
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## validate_main_agent

Validate a main-agent profile without saving, using the persistent service normalizer. Returns valid and normalized name without echoing large configuration.

```json
{
  "parameters": {
    "type": "object",
    "required": [
      "profile"
    ],
    "properties": {
      "profile": {
        "type": "object",
        "required": [
          "name",
          "description",
          "configuration"
        ],
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 80
          },
          "description": {
            "type": "string",
            "maxLength": 500
          },
          "configuration": {
            "type": "object",
            "required": [
              "prompt",
              "tools",
              "builtinPluginIds"
            ],
            "properties": {
              "prompt": {
                "type": "object",
                "required": [
                  "mode",
                  "text",
                  "includeGlobalRules",
                  "includeProjectRules",
                  "includeSkills"
                ],
                "properties": {
                  "mode": {
                    "anyOf": [
                      {
                        "type": "string",
                        "const": "default"
                      },
                      {
                        "type": "string",
                        "const": "append"
                      },
                      {
                        "type": "string",
                        "const": "replace"
                      }
                    ]
                  },
                  "text": {
                    "type": "string",
                    "maxLength": 32768
                  },
                  "includeGlobalRules": {
                    "type": "boolean"
                  },
                  "includeProjectRules": {
                    "type": "boolean"
                  },
                  "includeSkills": {
                    "type": "boolean"
                  }
                },
                "additionalProperties": false
              },
              "tools": {
                "anyOf": [
                  {
                    "type": "null"
                  },
                  {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 200
                    },
                    "maxItems": 64,
                    "uniqueItems": true
                  }
                ]
              },
              "builtinPluginIds": {
                "anyOf": [
                  {
                    "type": "null"
                  },
                  {
                    "type": "array",
                    "items": {
                      "type": "string",
                      "minLength": 1,
                      "maxLength": 200
                    },
                    "maxItems": 64,
                    "uniqueItems": true
                  }
                ]
              }
            },
            "additionalProperties": false
          }
        },
        "additionalProperties": false
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```

## window_action

Show, focus, minimize, maximize, restore or resize the Desktop window. Bounds are in screen pixels.

```json
{
  "parameters": {
    "type": "object",
    "required": [
      "action"
    ],
    "properties": {
      "windowId": {
        "type": "integer",
        "minimum": 1
      },
      "action": {
        "anyOf": [
          {
            "type": "string",
            "const": "show"
          },
          {
            "type": "string",
            "const": "focus"
          },
          {
            "type": "string",
            "const": "minimize"
          },
          {
            "type": "string",
            "const": "maximize"
          },
          {
            "type": "string",
            "const": "restore"
          },
          {
            "type": "string",
            "const": "set_bounds"
          }
        ]
      },
      "bounds": {
        "type": "object",
        "required": [
          "width",
          "height"
        ],
        "properties": {
          "x": {
            "type": "integer",
            "minimum": -32768,
            "maximum": 32768
          },
          "y": {
            "type": "integer",
            "minimum": -32768,
            "maximum": 32768
          },
          "width": {
            "type": "integer",
            "minimum": 400,
            "maximum": 8192
          },
          "height": {
            "type": "integer",
            "minimum": 300,
            "maximum": 8192
          }
        },
        "additionalProperties": false
      }
    },
    "additionalProperties": false
  },
  "result": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string"
      }
    },
    "required": [
      "text"
    ],
    "additionalProperties": false
  },
  "concurrency": "serial"
}
```
