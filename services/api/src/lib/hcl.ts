/**
 * A deliberately small HCL reader, enough to grade an infrastructure
 * submission and no more.
 *
 * Why parse rather than run: grading has to be deterministic and repeatable,
 * and executing a stranger's code would need a sandbox this architecture
 * does not have and CLAUDE.md's cost guardrails forbid (no ECS, no EC2, no
 * always-on compute). Terraform is declarative, so what a submission
 * *claims* to build can be read straight off the text without building
 * anything. That is the whole reason the graded task is infrastructure code
 * and not, say, an algorithm.
 *
 * This is a scanner, not a regular expression, and that is a security
 * decision. Input here is untrusted text from someone applying for a job;
 * a backtracking regex over adversarial input is a denial-of-service waiting
 * to happen. Every function below advances a cursor and terminates in one
 * pass, and the input is length-bounded before it is ever read.
 *
 * It understands: blocks with labels, `key = value` attributes, nested
 * blocks, strings, numbers, booleans, bare references, and lists. It does
 * NOT understand expressions, interpolation, functions, or heredocs, and it
 * does not pretend to: an attribute it cannot read becomes `unparsed`, which
 * a rubric can treat as "not demonstrated" rather than silently as absent.
 */

export const MAX_SUBMISSION_BYTES = 64 * 1024;

export type HclValue =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'ref'; value: string }
  | { kind: 'list'; items: HclValue[] }
  | { kind: 'unparsed'; raw: string };

export interface HclBlock {
  type: string;
  labels: string[];
  attributes: Record<string, HclValue>;
  blocks: HclBlock[];
}

class Scanner {
  private i = 0;
  constructor(private readonly src: string) {}

  atEnd(): boolean {
    return this.i >= this.src.length;
  }

  peek(): string {
    return this.src[this.i] ?? '';
  }

  next(): string {
    const c = this.src[this.i] ?? '';
    this.i += 1;
    return c;
  }

  /** Whitespace and every comment form Terraform accepts. */
  skipTrivia(): void {
    for (;;) {
      const c = this.peek();
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        this.i += 1;
        continue;
      }
      if (c === '#' || (c === '/' && this.src[this.i + 1] === '/')) {
        while (!this.atEnd() && this.peek() !== '\n') this.i += 1;
        continue;
      }
      if (c === '/' && this.src[this.i + 1] === '*') {
        this.i += 2;
        while (!this.atEnd() && !(this.peek() === '*' && this.src[this.i + 1] === '/')) this.i += 1;
        // Unterminated comment simply runs to the end rather than looping.
        if (!this.atEnd()) this.i += 2;
        continue;
      }
      return;
    }
  }

  readQuoted(): string {
    // Assumes the opening quote has been consumed.
    let out = '';
    while (!this.atEnd()) {
      const c = this.next();
      if (c === '\\') {
        const esc = this.next();
        out += esc === 'n' ? '\n' : esc === 't' ? '\t' : esc;
        continue;
      }
      if (c === '"') return out;
      out += c;
    }
    return out;
  }

  /**
   * Brackets are deliberately NOT in this set.
   *
   * They were, for index syntax, and it meant a bare reference inside a
   * list swallowed the list's closing bracket:
   * `identifiers = [data.aws_caller_identity.current.account_id]` never
   * terminated, and the scanner consumed the rest of the file, so every
   * resource after it vanished from the parse. An indexed reference is an
   * expression this reader does not model anyway, and it is marked
   * unparsed rather than guessed at.
   */
  readBareWord(): string {
    let out = '';
    while (!this.atEnd() && /[A-Za-z0-9_.\-*]/.test(this.peek())) out += this.next();
    return out;
  }

  /** Everything to the end of the line, for values this reader does not model. */
  readToLineEnd(): string {
    let out = '';
    while (!this.atEnd() && this.peek() !== '\n') out += this.next();
    return out.trim();
  }

  /** Spaces and tabs only. Newlines stay significant to the caller. */
  skipSpacesOnly(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.i += 1;
  }

  position(): number {
    return this.i;
  }

  /**
   * Consumes a balanced (), {} or [] run, respecting strings and comments.
   *
   * Needed because real Terraform writes `policy = jsonencode({ ... })`
   * across many lines. Reading only to the end of the line left the rest of
   * the expression to be parsed as block content, and its closing brace then
   * ended the enclosing resource early — so an IAM policy simply vanished
   * from the parse. Found by the grading tests, on the single most common
   * shape in the language.
   */
  readBalanced(open: string, close: string): string {
    let depth = 0;
    let out = '';
    while (!this.atEnd()) {
      const c = this.peek();
      if (c === '"') {
        out += this.next() + this.readQuoted() + '"';
        continue;
      }
      if (c === '#' || (c === '/' && this.src[this.i + 1] === '/')) {
        while (!this.atEnd() && this.peek() !== '\n') out += this.next();
        continue;
      }
      out += this.next();
      if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return out;
  }
}

function readValue(sc: Scanner): HclValue {
  sc.skipTrivia();
  const c = sc.peek();

  if (c === '"') {
    sc.next();
    return { kind: 'string', value: sc.readQuoted() };
  }

  if (c === '[') {
    sc.next();
    const items: HclValue[] = [];
    for (;;) {
      sc.skipTrivia();
      if (sc.atEnd()) break;
      if (sc.peek() === ']') {
        sc.next();
        break;
      }
      if (sc.peek() === ',') {
        sc.next();
        continue;
      }
      const before = sc.position();
      items.push(readValue(sc));
      // A value this reader cannot advance past would otherwise spin here.
      if (sc.position() === before) {
        sc.next();
      }
    }
    return { kind: 'list', items };
  }

  // An object literal, e.g. `tags = { Name = "x" }`. Consumed whole so its
  // closing brace cannot be mistaken for the end of the enclosing block.
  if (c === '{') return { kind: 'unparsed', raw: sc.readBalanced('{', '}') };

  const word = sc.readBareWord();
  if (word === '') return { kind: 'unparsed', raw: sc.readToLineEnd() };

  // A function call, overwhelmingly `jsonencode(...)`. Same reasoning.
  // Checked WITHOUT skipping trivia first: a call has its paren against the
  // name, and skipping newlines here swallowed the line after a plain
  // reference like `bucket = aws_s3_bucket.b.id`.
  if (sc.peek() === '(') return { kind: 'unparsed', raw: word + sc.readBalanced('(', ')') };
  if (word === 'true' || word === 'false') return { kind: 'bool', value: word === 'true' };
  if (/^-?\d+(\.\d+)?$/.test(word)) return { kind: 'number', value: Number(word) };

  // A bare word followed by more on the line is an expression, not a plain
  // reference. Marked unparsed rather than guessed at.
  //
  // What follows is peeked at rather than consumed, because reading to the
  // end of the line ate the closing brace of a single-line block:
  // `resource "x" "y" { name = a.b.c }` left the block open, and every
  // resource after it was parsed as nested inside, so top-level lookups
  // simply lost them. Found by grading a realistically-formatted submission,
  // not by a fixture, because the fixtures were all multi-line.
  sc.skipSpacesOnly();
  const terminator = sc.peek();
  if (
    terminator === '' ||
    terminator === '}' ||
    terminator === ',' ||
    terminator === ']' ||
    terminator === '\n' ||
    terminator === '\r' ||
    terminator === '#'
  ) {
    return { kind: 'ref', value: word };
  }

  const rest = sc.readToLineEnd();
  return { kind: 'unparsed', raw: `${word} ${rest}`.trim() };
}

function readBody(sc: Scanner): { attributes: Record<string, HclValue>; blocks: HclBlock[] } {
  const attributes: Record<string, HclValue> = {};
  const blocks: HclBlock[] = [];

  for (;;) {
    sc.skipTrivia();
    if (sc.atEnd()) break;
    if (sc.peek() === '}') {
      sc.next();
      break;
    }

    const before = sc.position();
    const name = sc.readBareWord();
    if (name === '') {
      // Something this reader does not model. Skip the character rather than
      // stall, so a malformed submission still produces a partial parse and
      // a useful explanation instead of a hang.
      sc.next();
      continue;
    }

    sc.skipTrivia();
    const after = sc.peek();

    if (after === '=') {
      sc.next();
      attributes[name] = readValue(sc);
    } else if (after === '{') {
      sc.next();
      const inner = readBody(sc);
      blocks.push({ type: name, labels: [], ...inner });
    } else if (after === '"') {
      const labels: string[] = [];
      while (sc.peek() === '"') {
        sc.next();
        labels.push(sc.readQuoted());
        sc.skipTrivia();
      }
      if (sc.peek() === '{') {
        sc.next();
        const inner = readBody(sc);
        blocks.push({ type: name, labels, ...inner });
      }
    } else {
      sc.readToLineEnd();
    }

    if (sc.position() === before) sc.next();
  }

  return { attributes, blocks };
}

export interface ParseResult {
  blocks: HclBlock[];
  /** Set when the submission was refused before parsing, e.g. for size. */
  refused?: string;
}

export function parseHcl(source: string): ParseResult {
  if (source.length > MAX_SUBMISSION_BYTES) {
    return {
      blocks: [],
      refused: `Submission is larger than ${Math.floor(MAX_SUBMISSION_BYTES / 1024)}KB.`,
    };
  }
  const sc = new Scanner(source);
  const body = readBody(sc);
  return { blocks: body.blocks };
}

// --- Reading a parsed tree ------------------------------------------------

export function findResources(blocks: HclBlock[], resourceType: string): HclBlock[] {
  return blocks.filter((b) => b.type === 'resource' && b.labels[0] === resourceType);
}

/**
 * Data sources of a given type, e.g. `data "aws_iam_policy_document" "x"`.
 *
 * `findResources` filters on `type === 'resource'`, so a data block is
 * invisible to it. That is correct for what it does and was quietly wrong for
 * the graded-task rubrics that read policy text: a policy written with an
 * `aws_iam_policy_document` data source, which is what the provider docs
 * recommend and what this repository's own IAM uses, left the resource
 * holding nothing but a `.json` reference.
 */
export function findDataSources(blocks: HclBlock[], dataType: string): HclBlock[] {
  return blocks.filter((b) => b.type === 'data' && b.labels[0] === dataType);
}

/** Depth-first search for a nested block by type, at any depth. */
export function findNested(block: HclBlock, type: string): HclBlock[] {
  const out: HclBlock[] = [];
  const walk = (b: HclBlock) => {
    for (const child of b.blocks) {
      if (child.type === type) out.push(child);
      walk(child);
    }
  };
  walk(block);
  return out;
}

/**
 * Every string and unparsed expression in a subtree, concatenated.
 *
 * Rubric checks need to look inside `jsonencode(...)` bodies, which this
 * reader deliberately does not evaluate. JSON.stringify was used for that at
 * first and quietly broke the checks: it escapes quotes, so a pattern
 * looking for "s3:*" never matched \"s3:*\". This returns the raw text.
 */
export function rawText(blocks: HclBlock[]): string {
  const parts: string[] = [];
  const walk = (b: HclBlock) => {
    parts.push(b.type, ...b.labels);
    for (const [key, v] of Object.entries(b.attributes)) {
      parts.push(key);
      collect(v);
    }
    b.blocks.forEach(walk);
  };
  const collect = (v: HclValue) => {
    if (v.kind === 'string' || v.kind === 'ref') parts.push(v.value);
    else if (v.kind === 'unparsed') parts.push(v.raw);
    else if (v.kind === 'list') v.items.forEach(collect);
    else parts.push(String(v.value));
  };
  blocks.forEach(walk);
  return parts.join(' ');
}

export function stringAttr(block: HclBlock, name: string): string | null {
  const v = block.attributes[name];
  return v && v.kind === 'string' ? v.value : null;
}

export function boolAttr(block: HclBlock, name: string): boolean | null {
  const v = block.attributes[name];
  return v && v.kind === 'bool' ? v.value : null;
}

/** Any attribute at any depth, for checks that do not care where it sits. */
export function attrAnywhere(block: HclBlock, name: string): HclValue | null {
  if (block.attributes[name]) return block.attributes[name];
  for (const child of block.blocks) {
    const found = attrAnywhere(child, name);
    if (found) return found;
  }
  return null;
}
