import { visit } from "unist-util-visit";

// Separators recognized in a table's top-left header cell to request a diagonal
// split. `\` is the primary (Obsidian-friendly) token; `↘` is the safe token
// that never collides with markdown escaping. A markdown `\\` collapses to a
// single `\` before this rehype pass runs, so it is supported automatically.
const SEPARATORS = ["↘", "\\"];

// Concatenate the visible text of a hast node subtree.
function textOf(node: any): string {
  if (!node) return "";
  if (node.type === "text") return typeof node.value === "string" ? node.value : "";
  if (Array.isArray(node.children)) return node.children.map(textOf).join("");
  return "";
}

// The top-left cell = first <th>/<td> of the first <tr> in document order.
function firstRowFirstCell(table: any): any | null {
  let firstRow: any = null;
  visit(table, "element", (n: any) => {
    if (!firstRow && n.tagName === "tr") firstRow = n;
  });
  if (!firstRow || !Array.isArray(firstRow.children)) return null;
  return (
    firstRow.children.find(
      (c: any) =>
        c && c.type === "element" && (c.tagName === "th" || c.tagName === "td")
    ) || null
  );
}

/**
 * Turn a table's top-left header cell into a diagonal split cell when it
 * contains a separator (`\` or `↘`). The text left of the separator is the
 * column attribute (rendered in the upper-right triangle); the text on the
 * right is the row attribute (rendered in the lower-left triangle). Styling of
 * the diagonal line and the two labels lives in global.css (.diagonal-header).
 */
export default function rehypeTableDiagonal() {
  return function transformer(tree: any) {
    visit(tree, "element", (node: any) => {
      if (node.tagName !== "table") return;

      const cell = firstRowFirstCell(node);
      if (!cell) return;

      const text = textOf(cell).trim();
      if (!text) return;

      // Find the earliest separator present.
      let sepIndex = -1;
      let sepLen = 0;
      for (const sep of SEPARATORS) {
        const i = text.indexOf(sep);
        if (i !== -1 && (sepIndex === -1 || i < sepIndex)) {
          sepIndex = i;
          sepLen = sep.length;
        }
      }
      if (sepIndex === -1) return;

      const colLabel = text.slice(0, sepIndex).trim(); // left  -> column (upper-right)
      const rowLabel = text.slice(sepIndex + sepLen).trim(); // right -> row (lower-left)

      const existing = cell.properties?.className;
      const classes = Array.isArray(existing)
        ? existing.slice()
        : existing
          ? [existing]
          : [];
      if (!classes.includes("diagonal-header")) classes.push("diagonal-header");

      cell.properties = { ...(cell.properties || {}), className: classes };
      cell.children = [
        {
          type: "element",
          tagName: "span",
          properties: { className: ["diag-col"] },
          children: [{ type: "text", value: colLabel }],
        },
        {
          type: "element",
          tagName: "span",
          properties: { className: ["diag-row"] },
          children: [{ type: "text", value: rowLabel }],
        },
      ];
    });
  };
}
