const rendered = new WeakMap<Element, string>();

export function patchHtml(root: HTMLElement, html: string): void {
  if (rendered.get(root) === html) return;
  const template = document.createElement("template");
  template.innerHTML = html;
  const scroll = [root, ...root.querySelectorAll<HTMLElement>("*")]
    .filter((node) => node.scrollTop !== 0 || node.scrollLeft !== 0)
    .map((node) => ({ node, top: node.scrollTop, left: node.scrollLeft }));
  patchChildren(root, template.content);
  for (const { node, top, left } of scroll) {
    node.scrollTo({ top, left, behavior: "instant" });
  }
  rendered.set(root, html);
}

function nodeKey(node: Node): string | null {
  if (!(node instanceof Element)) return null;
  return node.id || node.getAttribute("data-key") ||
    (node.hasAttribute("data-select-key")
      ? `${node.getAttribute("data-select-kind")}:${node.getAttribute("data-select-key")}`
      : null);
}

function compatible(current: Node, next: Node): boolean {
  return current.nodeType === next.nodeType && current.nodeName === next.nodeName &&
    nodeKey(current) === nodeKey(next);
}

function patchChildren(parent: Node, next: Node): void {
  const keyed = new Map<string, Node>();
  for (const child of parent.childNodes) {
    const key = nodeKey(child);
    if (key !== null) keyed.set(key, child);
  }
  let cursor = parent.firstChild;
  for (const desired of Array.from(next.childNodes)) {
    const key = nodeKey(desired);
    const candidate = key === null ? cursor : keyed.get(key) ?? null;
    if (candidate && compatible(candidate, desired)) {
      if (candidate !== cursor) parent.insertBefore(candidate, cursor);
      patchNode(candidate, desired);
      cursor = candidate.nextSibling;
    } else {
      parent.insertBefore(desired.cloneNode(true), cursor);
    }
  }
  while (cursor) {
    const following = cursor.nextSibling;
    parent.removeChild(cursor);
    cursor = following;
  }
}

function patchNode(current: Node, next: Node): void {
  if (!(current instanceof Element) || !(next instanceof Element)) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  for (const attribute of Array.from(current.attributes)) {
    if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of next.attributes) {
    if (current.getAttribute(attribute.name) !== attribute.value) {
      current.setAttribute(attribute.name, attribute.value);
    }
  }
  if (current instanceof HTMLTextAreaElement && next instanceof HTMLTextAreaElement) {
    if (current.value !== next.value) current.value = next.value;
    return;
  }
  patchChildren(current, next);
}
