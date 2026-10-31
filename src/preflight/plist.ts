/**
 * A reader for XML property lists, enough for Info.plist and PrivacyInfo.xcprivacy.
 * Written here rather than added as a dependency: an ESM-only dependency has
 * already broken this package's startup on Node 18 once. Throws on anything it
 * cannot read, and the caller turns that into an "unknown" result.
 */
export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

interface Cursor {
  text: string;
  pos: number;
}

function nextTag(c: Cursor): { name: string; closing: boolean; selfClosing: boolean } {
  const open = c.text.indexOf("<", c.pos);
  if (open < 0) throw new Error("plist ended early");
  const close = c.text.indexOf(">", open);
  if (close < 0) throw new Error("plist tag not closed");
  const inner = c.text.slice(open + 1, close);
  c.pos = close + 1;
  const name = inner.replace(/^\//, "").replace(/\/$/, "").trim().split(/\s+/)[0];
  return { name, closing: inner.startsWith("/"), selfClosing: inner.endsWith("/") };
}

function readText(c: Cursor, name: string): string {
  const end = c.text.indexOf(`</${name}>`, c.pos);
  if (end < 0) throw new Error(`<${name}> not closed`);
  const raw = c.text.slice(c.pos, end);
  c.pos = end + name.length + 3;
  return decode(raw);
}

function readValue(c: Cursor, tag: { name: string; selfClosing: boolean }): PlistValue {
  switch (tag.name) {
    case "true":
    case "false":
      // Usually <true/>, and some generators write <true></true>.
      if (!tag.selfClosing) c.pos = c.text.indexOf(">", c.pos) + 1;
      return tag.name === "true";
    case "string":
      return tag.selfClosing ? "" : readText(c, "string");
    case "integer":
    case "real":
      return Number(readText(c, tag.name));
    case "date":
    case "data":
      return readText(c, tag.name);
    case "array": {
      const items: PlistValue[] = [];
      if (tag.selfClosing) return items;
      for (;;) {
        const t = nextTag(c);
        if (t.closing && t.name === "array") return items;
        items.push(readValue(c, t));
      }
    }
    case "dict": {
      const dict: { [key: string]: PlistValue } = {};
      if (tag.selfClosing) return dict;
      for (;;) {
        const t = nextTag(c);
        if (t.closing && t.name === "dict") return dict;
        if (t.name !== "key") throw new Error(`expected <key>, saw <${t.name}>`);
        const key = readText(c, "key").trim();
        dict[key] = readValue(c, nextTag(c));
      }
    }
    default:
      throw new Error(`unexpected <${tag.name}>`);
  }
}

export function parsePlist(xml: string): PlistValue {
  if (xml.startsWith("bplist")) throw new Error("binary plist");
  const c: Cursor = { text: xml.replace(/<!--[\s\S]*?-->/g, ""), pos: 0 };
  const start = c.text.indexOf("<plist");
  if (start < 0) throw new Error("no <plist> element");
  c.pos = c.text.indexOf(">", start) + 1;
  return readValue(c, nextTag(c));
}

const asStrings = (v: PlistValue | undefined): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** The two facts preflight wants from a privacy manifest. */
export function readManifest(xml: string): { accessed: Record<string, string[]>; collectedDataTypes: string[] } {
  const root = parsePlist(xml);
  if (typeof root !== "object" || root === null || Array.isArray(root)) throw new Error("the top level is not a dictionary");
  const accessed: Record<string, string[]> = {};
  const accessedList = root.NSPrivacyAccessedAPITypes;
  if (Array.isArray(accessedList)) {
    for (const entry of accessedList) {
      if (typeof entry !== "object" || Array.isArray(entry)) continue;
      const type = entry.NSPrivacyAccessedAPIType;
      if (typeof type === "string") accessed[type] = [...(accessed[type] ?? []), ...asStrings(entry.NSPrivacyAccessedAPITypeReasons)];
    }
  }
  const collected = root.NSPrivacyCollectedDataTypes;
  const collectedDataTypes = Array.isArray(collected)
    ? collected.flatMap((e) => (typeof e === "object" && !Array.isArray(e) && typeof e.NSPrivacyCollectedDataType === "string" ? [e.NSPrivacyCollectedDataType] : []))
    : [];
  return { accessed, collectedDataTypes };
}
