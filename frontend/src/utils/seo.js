export function setPageMeta({ title, description, canonicalUrl }) {
    if (typeof document === 'undefined') return;

    if (typeof title === 'string' && title.trim()) {
        document.title = title.trim();
        setMetaByName('title', title.trim());
        setMetaByProperty('og:title', title.trim());
        setMetaByProperty('twitter:title', title.trim());
    }

    if (typeof description === 'string' && description.trim()) {
        setMetaByName('description', description.trim());
        setMetaByProperty('og:description', description.trim());
        setMetaByProperty('twitter:description', description.trim());
    }

    if (typeof canonicalUrl === 'string' && canonicalUrl.trim()) {
        setCanonicalLink(canonicalUrl.trim());
        setMetaByProperty('og:url', canonicalUrl.trim());
    }
}

function setMetaByName(name, content) {
    const el = ensureMetaTag({ name });
    el.setAttribute('content', content);
}

function setMetaByProperty(property, content) {
    const el = ensureMetaTag({ property });
    el.setAttribute('content', content);
}

function ensureMetaTag(attrs) {
    const head = document.head;
    const selector = Object.entries(attrs)
        .map(([k, v]) => `meta[${cssEscape(k)}="${cssEscape(v)}"]`)
        .join('');

    const existing = head.querySelector(selector);
    if (existing) return existing;

    const el = document.createElement('meta');
    for (const [k, v] of Object.entries(attrs)) {
        el.setAttribute(k, v);
    }
    head.appendChild(el);
    return el;
}

function setCanonicalLink(href) {
    const head = document.head;
    const existing = head.querySelector('link[rel="canonical"]');
    if (existing) {
        existing.setAttribute('href', href);
        return;
    }

    const el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    el.setAttribute('href', href);
    head.appendChild(el);
}

function cssEscape(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
