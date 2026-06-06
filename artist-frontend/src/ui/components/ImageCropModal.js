import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import Cropper from 'react-easy-crop';

import Card from './Card';
import Button from './Button';
import { cropImageFile } from '../lib/imageCrop';

const clampNumber = (v, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
};

export default function ImageCropModal({
    open,
    file,
    kind,
    aspect,
    aspectOptions,
    title,
    onClose,
    onConfirm,
}) {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [cropPixels, setCropPixels] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    const imageUrl = useMemo(() => {
        if (!open) return '';
        if (!(file instanceof File)) return '';
        try {
            return URL.createObjectURL(file);
        } catch {
            return '';
        }
    }, [open, file]);

    useEffect(() => {
        return () => {
            if (!imageUrl) return;
            try {
                URL.revokeObjectURL(imageUrl);
            } catch {
            }
        };
    }, [imageUrl]);

    useEffect(() => {
        if (!open) return;
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCropPixels(null);
        setSubmitting(false);
    }, [open]);

    const ratio = useMemo(() => {
        const n = Number(aspect);
        if (!Number.isFinite(n) || n <= 0) return 1;
        return clampNumber(n, 0.2, 5);
    }, [aspect]);

    const onCropComplete = useCallback((_area, areaPixels) => {
        setCropPixels(areaPixels);
    }, []);

    const submit = useCallback(async () => {
        if (!(file instanceof File)) return;
        if (!cropPixels) return;
        setSubmitting(true);
        try {
            const cropped = await cropImageFile({ file, cropPixels, kind });
            if (typeof onConfirm === 'function') onConfirm(cropped);
        } finally {
            setSubmitting(false);
        }
    }, [cropPixels, file, kind, onConfirm]);

    if (!open) return null;

    const opts = Array.isArray(aspectOptions) ? aspectOptions : [];

    return (
        <Overlay>
            <Modal>
                <Card>
                    <Head>
                        <Title>{title || 'Обрезка изображения'}</Title>
                        <CloseButton type="button" onClick={onClose} disabled={submitting}>×</CloseButton>
                    </Head>

                    <Body>
                        <CropArea>
                            {imageUrl ? (
                                <Cropper
                                    image={imageUrl}
                                    crop={crop}
                                    zoom={zoom}
                                    aspect={ratio}
                                    onCropChange={setCrop}
                                    onZoomChange={setZoom}
                                    onCropComplete={onCropComplete}
                                    restrictPosition
                                    showGrid={false}
                                />
                            ) : null}
                        </CropArea>

                        <Controls>
                            <ZoomRow>
                                <ZoomLabel>Масштаб</ZoomLabel>
                                <Zoom
                                    type="range"
                                    min="1"
                                    max="3"
                                    step="0.01"
                                    value={zoom}
                                    onChange={(e) => setZoom(clampNumber(e.target.value, 1, 3))}
                                />
                            </ZoomRow>

                            {opts.length ? (
                                <RatioRow>
                                    {opts.map((o) => (
                                        <Button
                                            key={String(o.value)}
                                            type="button"
                                            onClick={() => o.onSelect && o.onSelect(o.value)}
                                            disabled={submitting || Number(o.value) === Number(aspect)}
                                        >
                                            {o.label}
                                        </Button>
                                    ))}
                                </RatioRow>
                            ) : null}
                        </Controls>
                    </Body>

                    <Actions>
                        <Button type="button" onClick={onClose} disabled={submitting}>Отмена</Button>
                        <Button type="button" $variant="primary" onClick={submit} disabled={submitting || !cropPixels}>Применить</Button>
                    </Actions>
                </Card>
            </Modal>
        </Overlay>
    );
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  z-index: 60;
`;

const Modal = styled.div`
  width: min(820px, 100%);
`;

const Head = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const Title = styled.h2`
  font-size: 16px;
  font-weight: 900;
`;

const CloseButton = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 12px;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const Body = styled.div`
  margin-top: 12px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
`;

const CropArea = styled.div`
  position: relative;
  width: 100%;
  height: 420px;
  border-radius: 18px;
  overflow: hidden;
  border: 0;
  background: rgba(255, 255, 255, 0.03);
`;

const Controls = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const ZoomRow = styled.div`
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 12px;
  align-items: center;
`;

const ZoomLabel = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
`;

const Zoom = styled.input`
  width: 100%;
`;

const RatioRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`;

const Actions = styled.div`
  margin-top: 14px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
`;
