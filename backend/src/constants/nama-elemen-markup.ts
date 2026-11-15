/**
 * Nama elemen HTML, SVG, dan MathML (huruf kecil) yang dikenali penyaring
 * masukan sebagai markup. Kata lain di antara '<' dan '>' (mis. "<nama>",
 * "<Lampiran 1>") adalah teks biasa.
 */

// HTML, termasuk elemen usang yang masih diurai khusus oleh peramban.
const HTML = [
    'a', 'abbr', 'acronym', 'address', 'applet', 'area', 'article', 'aside', 'audio',
    'b', 'base', 'basefont', 'bdi', 'bdo', 'bgsound', 'big', 'blink', 'blockquote', 'body', 'br', 'button',
    'canvas', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'command', 'content',
    'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'dir', 'div', 'dl', 'dt',
    'element', 'em', 'embed',
    'fieldset', 'figcaption', 'figure', 'font', 'footer', 'form', 'frame', 'frameset',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html',
    'i', 'iframe', 'image', 'img', 'input', 'ins', 'isindex',
    'kbd', 'keygen',
    'label', 'legend', 'li', 'link', 'listing',
    'main', 'map', 'mark', 'marquee', 'menu', 'menuitem', 'meta', 'meter', 'multicol',
    'nav', 'nextid', 'nobr', 'noembed', 'noframes', 'noscript',
    'object', 'ol', 'optgroup', 'option', 'output',
    'p', 'param', 'picture', 'plaintext', 'portal', 'pre', 'progress',
    'q',
    'rb', 'rp', 'rt', 'rtc', 'ruby',
    's', 'samp', 'script', 'search', 'section', 'select', 'selectedcontent', 'shadow', 'slot', 'small',
    'source', 'spacer', 'span', 'strike', 'strong', 'style', 'sub', 'summary', 'sup',
    'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track', 'tt',
    'u', 'ul',
    'var', 'video',
    'wbr',
    'xmp',
];

const SVG = [
    'svg', 'altglyph', 'altglyphdef', 'altglyphitem', 'animate', 'animatecolor', 'animatemotion',
    'animatetransform', 'circle', 'clippath', 'color-profile', 'cursor', 'defs', 'desc', 'discard', 'ellipse',
    'feblend', 'fecolormatrix', 'fecomponenttransfer', 'fecomposite', 'feconvolvematrix', 'fediffuselighting',
    'fedisplacementmap', 'fedistantlight', 'fedropshadow', 'feflood', 'fefunca', 'fefuncb', 'fefuncg', 'fefuncr',
    'fegaussianblur', 'feimage', 'femerge', 'femergenode', 'femorphology', 'feoffset', 'fepointlight',
    'fespecularlighting', 'fespotlight', 'fetile', 'feturbulence', 'filter', 'font-face', 'font-face-format',
    'font-face-name', 'font-face-src', 'font-face-uri', 'foreignobject', 'g', 'glyph', 'glyphref', 'hatch',
    'hatchpath', 'hkern', 'line', 'lineargradient', 'marker', 'mask', 'mesh', 'meshgradient', 'meshpatch',
    'meshrow', 'metadata', 'missing-glyph', 'mpath', 'path', 'pattern', 'polygon', 'polyline', 'radialgradient',
    'rect', 'set', 'solidcolor', 'stop', 'switch', 'symbol', 'text', 'textpath', 'tref', 'tspan', 'use', 'view',
    'vkern',
];

// MathML presentasi (MathML Core dan MathML 3) beserta elemen anotasinya.
const MATHML = [
    'math', 'maction', 'maligngroup', 'malignmark', 'menclose', 'merror', 'mfenced', 'mfrac', 'mglyph', 'mi',
    'mlabeledtr', 'mlongdiv', 'mmultiscripts', 'mn', 'mo', 'mover', 'mpadded', 'mphantom', 'mprescripts', 'mroot',
    'mrow', 'ms', 'mscarries', 'mscarry', 'msgroup', 'msline', 'mspace', 'msqrt', 'msrow', 'mstack', 'mstyle',
    'msub', 'msubsup', 'msup', 'mtable', 'mtd', 'mtext', 'mtr', 'munder', 'munderover', 'none', 'semantics',
    'annotation', 'annotation-xml',
];

export const NAMA_ELEMEN_MARKUP: ReadonlySet<string> = new Set([...HTML, ...SVG, ...MATHML]);
