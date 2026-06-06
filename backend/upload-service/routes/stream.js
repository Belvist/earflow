const express = require('express');

function createStreamRouter({ authenticateUser }) {
    void authenticateUser;
    return express.Router();
}

/**
 * Transform MinIO presigned URL to public Nginx URL
 * 
 * Security: Never exposes internal MinIO endpoint on error.
 * 
 * @param {string} presignedUrl - Original MinIO presigned URL
 * @param {string} publicOrigin - Public origin (e.g., https://earflow.ru)
 * @returns {string|null} Public URL for client, null on error
 */
function transformToPublicUrl(presignedUrl, publicOrigin) {
    try {
        if (!presignedUrl || typeof presignedUrl !== 'string') {
            return null;
        }

        const urlObj = new URL(presignedUrl);

        // Validate URL has required AWS parameters
        const hasSignature = urlObj.searchParams.has('X-Amz-Signature');
        if (!hasSignature) {
            return null;
        }

        // urlObj.pathname is /<bucket>/<key>
        // We need /media/<bucket>/<key>
        const publicPath = `/media${urlObj.pathname}`;

        // Preserve all query params (AWS signature parameters)
        return `${publicOrigin}${publicPath}${urlObj.search}`;
    } catch {
        // SECURITY: Never return original URL (contains internal endpoint)
        return null;
    }
}

module.exports = createStreamRouter;
