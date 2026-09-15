const { MarkdownView, Plugin } = require("obsidian");

const MAX_PASTE_LENGTH = 100_000;

// These commands provide strong evidence that a paste is LaTeX rather than prose.
const KNOWN_COMMAND_NAMES = [
  "text", "textrm", "textsf", "texttt",
  "frac", "dfrac", "tfrac", "sqrt", "binom",
  "sum", "prod", "int", "iint", "iiint", "oint",
  "mathrm", "mathbf", "mathit", "mathcal", "mathbb", "mathsf", "mathtt",
  "operatorname", "begin", "end",
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
  "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi",
  "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon", "phi",
  "varphi", "chi", "psi", "omega",
  "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi",
  "Psi", "Omega",
  "partial", "nabla", "infty",
  "cdot", "times", "pm", "mp", "leq", "le", "geq", "ge", "neq", "ne",
  "approx", "sim", "simeq", "equiv", "propto",
  "rightarrow", "leftarrow", "Rightarrow", "Leftarrow", "leftrightarrow",
  "Leftrightarrow", "to", "mapsto",
  "in", "notin", "subset", "supset", "subseteq", "supseteq", "cup", "cap",
  "land", "lor", "neg", "forall", "exists",
  "ldots", "cdots", "vdots", "ddots", "quad", "qquad",
  "left", "right", "big", "Big", "bigg", "Bigg",
  "overline", "underline", "hat", "bar", "vec", "dot", "ddot",
  "lim", "min", "max", "log", "ln", "exp", "sin", "cos", "tan",
  "arcsin", "arccos", "arctan", "det", "gcd"
];

const KNOWN_COMMAND_PATTERN = new RegExp(
  `\\\\(?:${KNOWN_COMMAND_NAMES.join("|")})(?![A-Za-z])`
);

const MASKED_ARGUMENT_COMMANDS = new Set([
  "text", "textrm", "textsf", "texttt",
  "mathrm", "mathbf", "mathit", "mathcal", "mathbb", "mathsf", "mathtt",
  "operatorname", "begin", "end"
]);

const ALLOWED_MULTI_LETTER_TOKENS = new Set([
  "sin", "cos", "tan", "log", "ln", "exp", "lim", "min", "max", "det",
  "gcd", "dx", "dy", "dz", "dt", "Re", "Im"
]);

const REQUIRED_BRACED_ARGUMENTS = new Map([
  ["text", 1], ["textrm", 1], ["textsf", 1], ["texttt", 1],
  ["frac", 2], ["dfrac", 2], ["tfrac", 2], ["binom", 2], ["sqrt", 1],
  ["mathrm", 1], ["mathbf", 1], ["mathit", 1], ["mathcal", 1],
  ["mathbb", 1], ["mathsf", 1], ["mathtt", 1], ["operatorname", 1],
  ["begin", 1], ["end", 1]
]);

/** Return true only when the complete trimmed paste already has math delimiters. */
function isAlreadyMathDelimited(text) {
  const value = text.trim();

  if (value.length > 4 && value.startsWith("$$") && value.endsWith("$$")) {
    return true;
  }

  if (
    value.length > 2 &&
    value.startsWith("$") &&
    !value.startsWith("$$") &&
    value.endsWith("$") &&
    !value.endsWith("$$")
  ) {
    return true;
  }

  return (
    (value.length > 4 && value.startsWith("\\(") && value.endsWith("\\)")) ||
    (value.length > 4 && value.startsWith("\\[") && value.endsWith("\\]"))
  );
}

/** Check balanced curly braces while ignoring escaped characters. */
function hasBalancedBraces(text) {
  let depth = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }

    if (text[index] === "{") depth += 1;
    if (text[index] === "}") depth -= 1;
    if (depth < 0) return false;
  }

  return depth === 0;
}

function findBalancedGroupEnd(text, start, openingCharacter, closingCharacter) {
  if (text[start] !== openingCharacter) return -1;

  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "\\") {
      index += 1;
      continue;
    }

    if (text[index] === openingCharacter) depth += 1;
    if (text[index] === closingCharacter) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  return -1;
}

/** Reject incomplete commands such as a prose mention of "\\text". */
function hasRequiredCommandArguments(text) {
  const commandPattern = /\\([A-Za-z]+)/g;
  let match;

  while ((match = commandPattern.exec(text)) !== null) {
    const commandName = match[1];
    const requiredCount = REQUIRED_BRACED_ARGUMENTS.get(commandName);
    if (!requiredCount) continue;

    let index = commandPattern.lastIndex;
    while (/\s/.test(text[index] || "")) index += 1;

    if (commandName === "sqrt" && text[index] === "[") {
      index = findBalancedGroupEnd(text, index, "[", "]");
      if (index === -1) return false;
      while (/\s/.test(text[index] || "")) index += 1;
    }

    for (let argument = 0; argument < requiredCount; argument += 1) {
      index = findBalancedGroupEnd(text, index, "{", "}");
      if (index === -1) return false;
      while (/\s/.test(text[index] || "")) index += 1;
    }
  }

  return true;
}

/**
 * Hide text-like command arguments before looking for prose. For example,
 * words inside \text{Scientific Evidence} are valid LaTeX content, while words
 * outside that command are treated conservatively as possible natural language.
 */
function maskProtectedCommandArguments(text) {
  const output = Array.from(text);
  const commandPattern = /\\([A-Za-z]+)\s*\{/g;
  let match;

  while ((match = commandPattern.exec(text)) !== null) {
    const commandName = match[1];
    if (!MASKED_ARGUMENT_COMMANDS.has(commandName)) continue;

    const openingBrace = commandPattern.lastIndex - 1;
    let depth = 0;
    let closingBrace = -1;

    for (let index = openingBrace; index < text.length; index += 1) {
      if (text[index] === "\\") {
        index += 1;
        continue;
      }

      if (text[index] === "{") depth += 1;
      if (text[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          closingBrace = index;
          break;
        }
      }
    }

    if (closingBrace === -1) continue;

    for (let index = match.index; index <= closingBrace; index += 1) {
      output[index] = " ";
    }
    commandPattern.lastIndex = closingBrace + 1;
  }

  return output.join("");
}

/**
 * Conservative LaTeX detector. It requires clear mathematical evidence and
 * rejects sentence-like words outside text/font commands.
 */
function isLikelyPureLatex(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_PASTE_LENGTH) {
    return false;
  }

  const value = text.replace(/\r\n?/g, "\n").trim();
  if (!value || value.includes("\0") || isAlreadyMathDelimited(value)) return false;

  // Do not reinterpret partial/mixed math markup or Markdown structures.
  if (value.includes("$") || /\\(?:\(|\)|\[|\])/.test(value)) return false;
  if (/^\s*(?:#{1,6}\s|>\s|[-*]\s+|\d+\.\s+|```|~~~)/m.test(value)) return false;
  if (/https?:\/\/|www\.|\b[^\s@]+@[^\s@]+\b/i.test(value)) return false;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(value)) return false;
  if (!hasBalancedBraces(value)) return false;
  if (!hasRequiredCommandArguments(value)) return false;

  const hasKnownCommand = KNOWN_COMMAND_PATTERN.test(value);
  const hasSubscriptOrSuperscript = /[A-Za-z0-9)}\]]\s*[_^]\s*(?:\{[^{}\n]+\}|\\[A-Za-z]+|[A-Za-z0-9])/.test(value);
  const hasSymbolicOperation = /[A-Za-z0-9)}\]]\s*(?:[=+*/<>]|-)\s*[A-Za-z0-9({\[]/.test(value);
  const hasFunctionCall = /\b(?:sin|cos|tan|log|ln|exp|lim|max|min|det)\s*\(/.test(value);

  if (!hasKnownCommand && !hasSubscriptOrSuperscript && !hasSymbolicOperation && !hasFunctionCall) {
    return false;
  }

  let outsideCommands = maskProtectedCommandArguments(value);

  // Remove commands and common TeX spacing escapes before examining identifiers.
  outsideCommands = outsideCommands
    .replace(/\\[A-Za-z]+/g, " ")
    .replace(/\\[^A-Za-z\s]/g, " ")
    .replace(/\\\s/g, " ");

  // Sub/superscript groups such as _i, ^2, and _{ij} are formula structure.
  let previous;
  do {
    previous = outsideCommands;
    outsideCommands = outsideCommands.replace(
      /[_^]\s*(?:\{[^{}\n]{1,80}\}|\\[A-Za-z]+|[A-Za-z0-9])/g,
      " "
    );
  } while (outsideCommands !== previous);

  const words = outsideCommands.match(/[A-Za-z]+/g) || [];
  if (words.some((word) => word.length > 1 && !ALLOWED_MULTI_LETTER_TOKENS.has(word))) {
    return false;
  }

  // Reject remaining characters typical of prose or Markdown rather than math.
  const residue = outsideCommands
    .replace(/[A-Za-z0-9\s{}()[\],.;:!?&|_+\-*/=<>^']/g, "");

  return residue.length === 0;
}

function isInsideInlineCode(line, character) {
  const backtickRuns = /`+/g;
  let openingRun = null;
  let match;

  while ((match = backtickRuns.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    if (!openingRun) {
      if (character >= start && character <= end) return true;
      openingRun = { length: match[0].length, end };
      continue;
    }

    if (match[0].length === openingRun.length) {
      if (character >= openingRun.end && character <= start) return true;
      openingRun = null;
    }
  }

  return Boolean(openingRun && character >= openingRun.end);
}

/** Detect fenced code blocks and inline code at the active cursor. */
function isInsideCode(editor, eventTarget) {
  if (
    eventTarget &&
    typeof eventTarget.closest === "function" &&
    eventTarget.closest("code, pre, .cm-inline-code, .HyperMD-codeblock")
  ) {
    return true;
  }

  const cursor = editor.getCursor();
  const currentLine = editor.getLine(cursor.line) || "";
  if (isInsideInlineCode(currentLine, cursor.ch)) return true;

  let fence = null;
  for (let lineNumber = 0; lineNumber <= cursor.line; lineNumber += 1) {
    const line = editor.getLine(lineNumber) || "";
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!fenceMatch) continue;

    const marker = fenceMatch[1];
    if (!fence) {
      fence = { character: marker[0], length: marker.length };
      if (lineNumber === cursor.line) return true;
      continue;
    }

    const isClosingFence =
      marker[0] === fence.character &&
      marker.length >= fence.length &&
      fenceMatch[2].trim() === "";

    if (isClosingFence) {
      if (lineNumber === cursor.line) return true;
      fence = null;
    }
  }

  return fence !== null;
}

/** Add inline delimiters for one line and display delimiters for multiple lines. */
function wrapLatex(text) {
  const value = text.replace(/\r\n?/g, "\n").trim();
  return value.includes("\n") ? `$$\n${value}\n$$` : `$${value}$`;
}

function getInlineCandidateStarts(line) {
  const starts = new Set();
  const commandPattern = new RegExp(
    `\\\\(?:${KNOWN_COMMAND_NAMES.join("|")})(?![A-Za-z])`,
    "g"
  );
  let match;

  while ((match = commandPattern.exec(line)) !== null) {
    starts.add(match.index);
  }

  // Bare sub/superscript expressions are safe enough to identify in prose.
  const structuralPattern = /\b[A-Za-z](?:\s*[_^]\s*(?:\{[^{}\n]+\}|\\[A-Za-z]+|[A-Za-z0-9]))+/g;
  while ((match = structuralPattern.exec(line)) !== null) {
    starts.add(match.index);
  }

  return Array.from(starts).sort((left, right) => left - right);
}

function expandCandidateStart(line, commandStart) {
  const before = line.slice(0, commandStart);
  const leftSide = before.match(
    /[A-Za-z](?:\s*[_^]\s*(?:\{[^{}\n]+\}|[A-Za-z0-9]))?\s*=\s*$/
  );

  if (!leftSide) return commandStart;

  const start = before.length - leftSide[0].length;
  const precedingCharacter = line[start - 1] || "";
  return /[A-Za-z0-9_]/.test(precedingCharacter) ? commandStart : start;
}

function findInlineCandidateEnd(line, start) {
  const endpoints = new Set([line.length]);
  const sentencePunctuation = /[.,;:!?，。；：！？]/;

  for (let index = start + 1; index < line.length; index += 1) {
    const character = line[index];
    const previousCharacter = line[index - 1];

    if (/\s/.test(previousCharacter) && !/\s/.test(character)) endpoints.add(index);
    if (sentencePunctuation.test(character)) endpoints.add(index);
    if (character.charCodeAt(0) > 127) endpoints.add(index);
  }

  const orderedEndpoints = Array.from(endpoints).sort((left, right) => right - left);
  for (const endpoint of orderedEndpoints) {
    let end = endpoint;
    while (end > start && /\s/.test(line[end - 1])) end -= 1;
    while (end > start && sentencePunctuation.test(line[end - 1])) end -= 1;
    while (end > start && /\s/.test(line[end - 1])) end -= 1;

    if (end <= start) continue;

    const candidate = line.slice(start, end);
    if (isLikelyPureLatex(candidate)) return end;
  }

  return -1;
}

/** Wrap only reliable formula spans inside a natural-language line. */
function wrapInlineLatexInMixedLine(line) {
  if (
    line.length > 10_000 ||
    line.includes("$") ||
    line.includes("`") ||
    /\\(?:\(|\)|\[|\])/.test(line)
  ) {
    return line;
  }

  let result = "";
  let cursor = 0;

  while (cursor < line.length) {
    const nextStart = getInlineCandidateStarts(line)
      .find((start) => start >= cursor);
    if (nextStart === undefined) break;

    const start = expandCandidateStart(line, nextStart);
    const end = findInlineCandidateEnd(line, start);
    if (end === -1) {
      cursor = nextStart + 1;
      continue;
    }

    result += line.slice(result ? cursor : 0, start);
    result += `$${line.slice(start, end)}$`;
    cursor = end;
  }

  if (!result) return line;
  return result + line.slice(cursor);
}

function getProtectedPasteLines(lines) {
  const protectedLines = Array(lines.length).fill(false);
  let fence = null;
  let displayMathEnd = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (fence) {
      protectedLines[index] = true;
      const closingFence = trimmed.match(/^(`{3,}|~{3,})\s*$/);
      if (
        closingFence &&
        closingFence[1][0] === fence.character &&
        closingFence[1].length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }

    const openingFence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (openingFence) {
      protectedLines[index] = true;
      fence = {
        character: openingFence[1][0],
        length: openingFence[1].length
      };
      continue;
    }

    if (displayMathEnd) {
      protectedLines[index] = true;
      if (trimmed === displayMathEnd) displayMathEnd = null;
      continue;
    }

    if (trimmed === "$$") {
      protectedLines[index] = true;
      displayMathEnd = "$$";
      continue;
    }

    if (trimmed === "\\[") {
      protectedLines[index] = true;
      displayMathEnd = "\\]";
      continue;
    }

    if (line.includes("$") || line.includes("`") || /\\(?:\(|\)|\[|\])/.test(line)) {
      protectedLines[index] = true;
    }
  }

  return protectedLines;
}

function isLatexContinuationLine(line) {
  return Boolean(
    line.trim() &&
    /^[\s+*=<>/&|,;:()[\]{}\-]+$/.test(line)
  );
}

/**
 * Transform a full paste. Pure formulas are wrapped as before; mixed pastes
 * receive delimiters only around confidently identified LaTeX spans/blocks.
 */
function transformPastedText(text) {
  if (typeof text !== "string" || !text || text.length > MAX_PASTE_LENGTH) return null;
  if (isAlreadyMathDelimited(text)) return null;

  const normalized = text.replace(/\r\n?/g, "\n");
  if (isLikelyPureLatex(normalized)) return wrapLatex(normalized);

  const lines = normalized.split("\n");
  const protectedLines = getProtectedPasteLines(lines);
  const statuses = lines.map((line, index) => {
    if (protectedLines[index]) return "normal";
    if (isLikelyPureLatex(line)) return "latex";
    if (isLatexContinuationLine(line)) return "continuation";
    return "normal";
  });

  const output = [];
  let changed = false;
  let index = 0;

  while (index < lines.length) {
    if (statuses[index] === "latex") {
      let runEnd = index + 1;
      while (
        runEnd < lines.length &&
        (statuses[runEnd] === "latex" || statuses[runEnd] === "continuation")
      ) {
        runEnd += 1;
      }

      while (runEnd > index && statuses[runEnd - 1] === "continuation") {
        runEnd -= 1;
      }

      const formulaBlock = lines.slice(index, runEnd).join("\n");
      output.push(wrapLatex(formulaBlock));
      changed = true;
      index = runEnd;
      continue;
    }

    const transformedLine = protectedLines[index]
      ? lines[index]
      : wrapInlineLatexInMixedLine(lines[index]);
    output.push(transformedLine);
    if (transformedLine !== lines[index]) changed = true;
    index += 1;
  }

  return changed ? output.join("\n") : null;
}

class AutoLatexPastePlugin extends Plugin {
  onload() {
    this.handlePaste = this.handlePaste.bind(this);
    // Capture the event before CodeMirror handles the native paste operation.
    this.registerDomEvent(document, "paste", this.handlePaste, { capture: true });
  }

  isEditorPasteTarget(target, view) {
    if (!target || typeof target.closest !== "function") return false;

    const editable = target.closest(".markdown-source-view .cm-content, .CodeMirror-code");

    return Boolean(editable && view.containerEl.contains(editable));
  }

  handlePaste(event) {
    if (!event.clipboardData) return;

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || !this.isEditorPasteTarget(event.target, view)) return;

    const clipboard = event.clipboardData;
    const hasFile =
      clipboard.files.length > 0 ||
      Array.from(clipboard.items || []).some((item) => item.kind === "file");
    if (hasFile) return;

    const text = clipboard.getData("text/plain");
    if (!text || text.length > MAX_PASTE_LENGTH) return;
    if (isInsideCode(view.editor, event.target)) return;

    const replacement = transformPastedText(text);
    if (replacement === null) return;
    event.preventDefault();
    event.stopPropagation();
    view.editor.replaceSelection(replacement);
  }
}

module.exports = AutoLatexPastePlugin;
