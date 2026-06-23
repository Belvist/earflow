/**
 * Tests for MusicUploader Validators
 * 
 * Запуск: npm test -- --testPathPattern=MusicUploader
 * 
 * @jest-environment jsdom
 */

import { validateFile, quickValidate, sanitizeFilename } from '../validators';
import { ErrorType } from '../constants';

describe('MusicUploader Validators', () => {
    // =========================================================================
    // quickValidate tests
    // =========================================================================

    describe('quickValidate', () => {
        it('should accept valid MP3 file', () => {
            const file = new File(['test'], 'song.mp3', { type: 'audio/mpeg' });
            Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 }); // 5MB

            const result = quickValidate(file);
            expect(result.valid).toBe(true);
        });

        it('should accept valid FLAC file', () => {
            const file = new File(['test'], 'song.flac', { type: 'audio/flac' });
            Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 }); // 20MB

            const result = quickValidate(file);
            expect(result.valid).toBe(true);
        });

        it('should reject file too large', () => {
            const file = new File(['test'], 'song.mp3', { type: 'audio/mpeg' });
            Object.defineProperty(file, 'size', { value: 200 * 1024 * 1024 }); // 200MB

            const result = quickValidate(file);
            expect(result.valid).toBe(false);
            expect(result.errorType).toBe(ErrorType.FILE_TOO_LARGE);
        });

        it('should reject file too small', () => {
            const file = new File([''], 'song.mp3', { type: 'audio/mpeg' });
            Object.defineProperty(file, 'size', { value: 100 }); // 100 bytes

            const result = quickValidate(file);
            expect(result.valid).toBe(false);
            expect(result.errorType).toBe(ErrorType.FILE_TOO_SMALL);
        });

        it('should reject invalid file type', () => {
            const file = new File(['test'], 'virus.exe', { type: 'application/x-executable' });
            Object.defineProperty(file, 'size', { value: 1024 * 1024 });

            const result = quickValidate(file);
            expect(result.valid).toBe(false);
            expect(result.errorType).toBe(ErrorType.INVALID_TYPE);
        });

        it('should accept file with valid extension but no MIME type', () => {
            const file = new File(['test'], 'song.mp3', { type: '' });
            Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 });

            const result = quickValidate(file);
            expect(result.valid).toBe(true);
        });

        it('should reject null/undefined input', () => {
            expect(quickValidate(null).valid).toBe(false);
            expect(quickValidate(undefined).valid).toBe(false);
            expect(quickValidate({}).valid).toBe(false);
        });
    });

    // =========================================================================
    // sanitizeFilename tests
    // =========================================================================

    describe('sanitizeFilename', () => {
        it('should keep valid filename unchanged', () => {
            expect(sanitizeFilename('my_song.mp3')).toBe('my_song.mp3');
            expect(sanitizeFilename('Artist - Track.flac')).toBe('Artist - Track.flac');
        });

        it('should remove path traversal attempts', () => {
            expect(sanitizeFilename('../../../etc/passwd')).not.toContain('..');
            expect(sanitizeFilename('..\\..\\windows\\system32')).not.toContain('..');
        });

        it('should remove dangerous characters', () => {
            const result = sanitizeFilename('file<script>alert(1)</script>.mp3');
            expect(result).not.toContain('<');
            expect(result).not.toContain('>');
        });

        it('should handle empty input', () => {
            const result = sanitizeFilename('');
            expect(result).toMatch(/^upload_\d+\.mp3$/);
        });

        it('should handle null input', () => {
            const result = sanitizeFilename(null);
            expect(result).toMatch(/^upload_\d+\.mp3$/);
        });

        it('should truncate long filenames', () => {
            const longName = 'a'.repeat(300) + '.mp3';
            const result = sanitizeFilename(longName);
            expect(result.length).toBeLessThanOrEqual(255);
            expect(result).toEndWith('.mp3');
        });

        it('should remove Windows reserved names', () => {
            // These should not cause issues as filenames
            expect(sanitizeFilename('CON.mp3')).toBeDefined();
            expect(sanitizeFilename('PRN.mp3')).toBeDefined();
        });
    });

    // =========================================================================
    // validateFile tests (async)
    // =========================================================================

    describe('validateFile', () => {
        it('should validate file asynchronously', async () => {
            // Create a mock MP3 file with valid header
            const mp3Header = new Uint8Array([0x49, 0x44, 0x33]); // ID3
            const file = new File([mp3Header], 'song.mp3', { type: 'audio/mpeg' });
            Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 });

            const result = await validateFile(file);
            expect(result.valid).toBe(true);
        });

        it('should reject file with mismatched magic bytes', async () => {
            // Create an MP3 with wrong header (looks like executable)
            const exeHeader = new Uint8Array([0x4D, 0x5A]); // MZ header
            const file = new File([exeHeader], 'fake.mp3', { type: 'audio/mpeg' });
            Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 });

            const result = await validateFile(file);
            // Should fail because magic bytes don't match
            expect(result.valid).toBe(false);
        });
    });
});

// =========================================================================
// Custom Jest matchers
// =========================================================================

expect.extend({
    toEndWith(received, suffix) {
        const pass = received.endsWith(suffix);
        return {
            pass,
            message: () => `expected ${received} to end with ${suffix}`,
        };
    },
});
