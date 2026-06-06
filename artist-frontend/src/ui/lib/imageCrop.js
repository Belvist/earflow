async function loadImageFromUrl(url) {
    return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('IMAGE_LOAD_FAILED'));
        img.crossOrigin = 'anonymous';
        img.src = url;
    });
}

function clampNumber(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

export async function cropImageToBlob({
    imageSrc,
    cropPixels,
    mimeType,
    quality,
    maxWidth,
    maxHeight,
}) {
    const img = await loadImageFromUrl(imageSrc);

    const crop = cropPixels && typeof cropPixels === 'object' ? cropPixels : null;
    const sx = clampNumber(crop?.x, 0, img.naturalWidth);
    const sy = clampNumber(crop?.y, 0, img.naturalHeight);
    const sw = clampNumber(crop?.width, 1, img.naturalWidth - sx);
    const sh = clampNumber(crop?.height, 1, img.naturalHeight - sy);

    let targetW = sw;
    let targetH = sh;

    const mw = Number(maxWidth);
    const mh = Number(maxHeight);
    if ((Number.isFinite(mw) && mw > 0) || (Number.isFinite(mh) && mh > 0)) {
        const wLimit = Number.isFinite(mw) && mw > 0 ? mw : targetW;
        const hLimit = Number.isFinite(mh) && mh > 0 ? mh : targetH;
        const ratio = Math.min(wLimit / targetW, hLimit / targetH, 1);
        targetW = Math.max(1, Math.round(targetW * ratio));
        targetH = Math.max(1, Math.round(targetH * ratio));
    }

    const canvas = document.createElement('canvas');
    const dpr = clampNumber((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1, 3);
    canvas.width = Math.max(1, Math.round(targetW * dpr));
    canvas.height = Math.max(1, Math.round(targetH * dpr));

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('CANVAS_CONTEXT_FAILED');

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);

    const outType = typeof mimeType === 'string' && mimeType ? mimeType : 'image/jpeg';
    const q = clampNumber(quality ?? 0.92, 0.5, 0.98);

    return await new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (!blob) {
                    reject(new Error('CANVAS_TO_BLOB_FAILED'));
                    return;
                }
                resolve(blob);
            },
            outType,
            outType === 'image/png' || outType === 'image/webp' || outType === 'image/jpeg' ? q : undefined,
        );
    });
}

export async function cropImageFile({
    file,
    cropPixels,
    kind,
}) {
    if (!(file instanceof File)) throw new Error('INVALID_FILE');

    const url = URL.createObjectURL(file);
    try {
        const config = (() => {
            const k = String(kind || '').toLowerCase();
            if (k === 'avatar') {
                return { mimeType: 'image/jpeg', quality: 0.92, maxWidth: 1600, maxHeight: 2000 };
            }
            return { mimeType: 'image/jpeg', quality: 0.9, maxWidth: 2400, maxHeight: 1400 };
        })();

        const blob = await cropImageToBlob({
            imageSrc: url,
            cropPixels,
            ...config,
        });

        const base = (file.name || 'image').replace(/\.[^.]+$/, '');
        const outName = `${base}.jpg`;
        return new File([blob], outName, { type: 'image/jpeg', lastModified: Date.now() });
    } finally {
        try {
            URL.revokeObjectURL(url);
        } catch {
        }
    }
}
