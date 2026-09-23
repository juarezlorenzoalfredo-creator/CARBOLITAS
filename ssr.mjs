/** Shim de DOM mínimo para renderizar el catálogo en tiempo de build
 *  reutilizando exactamente el mismo código que usa el navegador. */

const VOID = new Set(['img', 'input', 'hr', 'br', 'meta', 'link', 'source']);

const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');

class SNode {}

class SText extends SNode {
  constructor(text) {
    super();
    this.text = text;
  }
  toHTML() {
    return escText(this.text);
  }
}

class SElement extends SNode {
  constructor(tag) {
    super();
    this.tag = tag.toLowerCase();
    this.attrs = new Map();
    this.children = [];
    this.dataset = {};
  }
  set className(value) {
    if (value) this.attrs.set('class', value);
    else this.attrs.delete('class');
  }
  get className() {
    return this.attrs.get('class') || '';
  }
  set textContent(value) {
    this.children = [new SText(value)];
  }
  set value(v) {
    this.attrs.set('value', v);
  }
  setAttribute(name, value) {
    this.attrs.set(name, value);
  }
  addEventListener() {
    /* la interacción se conecta en el cliente por delegación */
  }
  append(...nodes) {
    for (const node of nodes) this.children.push(node);
  }
  toHTML() {
    const attrs = [];
    for (const [k, v] of this.attrs) attrs.push(v === '' ? k : `${k}="${escAttr(v)}"`);
    for (const [k, v] of Object.entries(this.dataset)) {
      attrs.push(`data-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}="${escAttr(v)}"`);
    }
    const open = `<${this.tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
    if (VOID.has(this.tag)) return open;
    return `${open}${this.children.map((c) => c.toHTML()).join('')}</${this.tag}>`;
  }
}

globalThis.Node = SNode;
globalThis.document = {
  createElement: (tag) => new SElement(tag),
  createTextNode: (text) => new SText(text)
};

export const serialize = (node) => node.toHTML();
export const escapeText = escText;
export const escapeAttr = escAttr;

/** JSON seguro para incrustar dentro de <script>: neutraliza </script> y <!--. */
export const inlineJSON = (value) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
