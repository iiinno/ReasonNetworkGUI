import { escapeHtml } from "./format";

export function agentHue(address: string): number {
  let hash = 2166136261;
  for (const character of address) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16777619);
  }
  return (hash >>> 0) % 360;
}

export function agentStyle(address: string): string {
  return `--agent-hue: ${agentHue(address)}`;
}

export function agentLabel(address: string, name = address): string {
  return `<span class="agent-label" style="${agentStyle(address)}" title="${escapeHtml(address)}">${escapeHtml(name)}</span>`;
}

export function colorAgentMentions(text: string, addresses: string[]): string {
  const known = [...new Set(addresses)].filter(Boolean).sort((a, b) => b.length - a.length)
    .map((address) => address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_.@/-])(?:${[
    ...known, "[\\p{L}\\p{N}_.@-]+/[\\p{L}\\p{N}_.@-]+(?:/[\\p{L}\\p{N}_.@-]+)?",
  ].join("|")})(?![\\p{L}\\p{N}_.@/-])`, "gu");
  let result = "";
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    result += escapeHtml(text.slice(offset, match.index)) + agentLabel(match[0]);
    offset = match.index + match[0].length;
  }
  return result + escapeHtml(text.slice(offset));
}
