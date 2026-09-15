# Auto LaTeX Paste

An Obsidian plugin that automatically detects bare LaTeX when pasting and adds the appropriate math delimiters.

It is designed for users who frequently copy mathematical expressions from ChatGPT, Claude, academic notes, or other sources into Obsidian.

## Why?

When copying LaTeX from AI assistants or other sources, mathematical expressions may arrive without Markdown math delimiters.

For example, you may copy:

```latex
\text{Scientific Evidence}
+
\text{Collaboration}
+
\text{Conflict}
+
\text{Verification}
+
\text{Uncertainty}
```

Normally, Obsidian will display this as plain text instead of rendering it as mathematics.

Auto LaTeX Paste detects likely LaTeX expressions during paste and automatically adds the required math delimiters.

The result becomes:

```latex
$$
\text{Scientific Evidence}
+
\text{Collaboration}
+
\text{Conflict}
+
\text{Verification}
+
\text{Uncertainty}
$$
```

and can be rendered directly by Obsidian.

## Features

- Automatically detects likely bare LaTeX during paste
- Adds inline math delimiters for single-line expressions
- Adds display math delimiters for multi-line expressions
- Detects LaTeX inside mixed natural-language content
- Supports common LaTeX commands and mathematical symbols
- Avoids wrapping expressions that already contain math delimiters
- Avoids modifying fenced code blocks and inline code
- Ignores pasted files and non-text clipboard content
- Uses conservative detection to reduce accidental conversion of normal prose

## Examples

### Inline formula

Before:

```text
E = mc^2
```

After pasting:

```text
$E = mc^2$
```

### LaTeX command

Before:

```latex
\frac{a+b}{c}
```

After pasting:

```latex
$\frac{a+b}{c}$
```

### Multi-line formula

Before:

```latex
\text{Scientific Evidence}
+
\text{Collaboration}
+
\text{Verification}
```

After pasting:

```latex
$$
\text{Scientific Evidence}
+
\text{Collaboration}
+
\text{Verification}
$$
```

### Mixed text

The plugin can also detect reliable LaTeX spans inside otherwise normal text while leaving the surrounding prose unchanged.

## Installation

### Manual installation

1. Download `main.js` and `manifest.json` from this repository.
2. Open your Obsidian vault.
3. Navigate to:

```text
<Vault>/.obsidian/plugins/
```

4. Create a folder named:

```text
auto-latex-paste
```

5. Place `main.js` and `manifest.json` inside the folder.
6. Restart Obsidian or reload the app.
7. Open **Settings → Community plugins**.
8. Enable **Auto LaTeX Paste**.

The final directory should look like:

```text
<Vault>/
└── .obsidian/
    └── plugins/
        └── auto-latex-paste/
            ├── main.js
            └── manifest.json
```

## Usage

Once enabled, no additional configuration is required.

Simply copy a LaTeX expression and paste it into the Obsidian Markdown editor.

If the pasted content is confidently recognized as LaTeX, the plugin automatically inserts the appropriate math delimiters.

Normal text is left unchanged.

## Detection Strategy

Auto LaTeX Paste uses conservative heuristic detection rather than wrapping every string that resembles mathematics.

The detector considers signals such as:

- Known LaTeX commands
- Subscripts and superscripts
- Mathematical operators
- Function expressions
- Balanced braces
- Required command arguments
- Existing Markdown and math delimiters
- Natural-language patterns

This approach is intended to minimize false positives while still handling common LaTeX copied from AI assistants and scientific documents.

## Limitations

LaTeX detection is heuristic and intentionally conservative.

Some ambiguous expressions may therefore remain unchanged rather than being automatically wrapped. This behavior is preferred over incorrectly converting ordinary text into mathematics.

If you encounter a reproducible case that should be detected but is not, please open an issue with the original pasted text.

## Compatibility

- Obsidian 1.5.0 or later
- Desktop only

## Contributing

Issues, bug reports, test cases, and pull requests are welcome.

When reporting a detection problem, please include:

- The original clipboard text
- The expected result
- The actual result
- Your Obsidian version

## License

This project is licensed under the MIT License.
