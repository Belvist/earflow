function parseRgbFromCss(color) {
  if (!color) return null;
  const s = String(color).trim();
  const rgba = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgba) {
    return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]) };
  }
  const hex = s.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  return null;
}

/** Light icon on dark bar; dark icon on light bar (photo 2). */
export function miniPlayIconColor(backgroundCss) {
  const rgb = parseRgbFromCss(backgroundCss);
  if (!rgb) return 'rgba(255, 255, 255, 0.94)';
  const lum = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  return lum > 0.62 ? 'rgba(18, 18, 18, 0.92)' : 'rgba(255, 255, 255, 0.94)';
}
